/**
 * pi-goal — Goal-directed autonomous work loops
 *
 * Mirrors Claude Code's /goal interface:
 *   /goal <condition>  — set a goal, starts working immediately
 *   /goal              — show goal status
 *   /goal clear        — clear the active goal
 *
 * After each turn, a lightweight evaluator call checks if the condition
 * is met. If not, a nextTurn message kicks off the next turn automatically.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	TurnEndEvent,
	SessionStartEvent,
	SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import type { GoalState } from "./persistence.ts";
import { saveState, loadState, saveAchieved } from "./persistence.ts";
import { evaluateGoal, buildTurnEvidence } from "./evaluator.ts";
import { registerSlashCommands } from "./slash.ts";

// ── Constants ────────────────────────────────────────────────────────────
const STATUS_KEY   = "goal-status";
const WIDGET_KEY   = "goal-indicator";
const STATE_TYPE   = "pi-goal-state";
const MAX_REMINDER_COUNT = 120; // ~30 minutes at 15 turns—rough cap

// ── Module-level state ───────────────────────────────────────────────────
let activeGoal: GoalState | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let lastUiCtx: ExtensionContext | null = null;

// ── Status display ───────────────────────────────────────────────────────
function statusText(goal: GoalState): string {
	const elapsed = Date.now() - goal.startedAt;
	const totalSec = Math.floor(elapsed / 1000);
	const hrs = Math.floor(totalSec / 3600);
	const mins = Math.floor((totalSec % 3600) / 60);
	const secs = totalSec % 60;
	const t = hrs > 0
		? `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
		: `${mins}m ${secs}s`;
	return `⏱ ${goal.turnCount}t · ${t}`;
}

function updateStatus(ctx: ExtensionContext): void {
	if (!activeGoal) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, statusText(activeGoal));
}

function startStatusTick(ctx: ExtensionContext): void {
	stopStatusTick();
	if (!activeGoal) return;
	updateStatus(ctx);
	statusTimer = setInterval(() => {
		try { updateStatus(ctx); } catch { stopStatusTick(); }
	}, 1000);
}

function stopStatusTick(): void {
	if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
}

// ── turn_end handler ─────────────────────────────────────────────────────
async function handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
	if (!activeGoal) return;
	if (!ctx.model) {
		// No model available — can't evaluate, stop the goal
		ctx.ui.setStatus(STATUS_KEY, "⚠ No model for evaluation");
		activeGoal = null;
		return;
	}

	// Step 1: Build evidence from the turn
	const evidence = buildTurnEvidence(event);
	activeGoal.elapsedMs = Date.now() - activeGoal.startedAt;

	// Step 2: Evaluate
	const evalResult = await evaluateGoal(ctx.model, activeGoal, evidence);

	// Step 3: Record the evaluation
	activeGoal.lastReason = evalResult.reason;

	if (evalResult.met) {
		// ✓ Goal achieved
		saveAchieved(ctx.sessionManager, activeGoal);
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, `✓ Goal achieved in ${activeGoal.turnCount} turns`);
		ctx.ui.notify(`Goal achieved in ${activeGoal.turnCount} turns`, "success");
		activeGoal = null;
		return;
	}

	// Step 4: Goal not met — continue the loop
	activeGoal.turnCount++;
	saveState(ctx.sessionManager, activeGoal);
	updateStatus(ctx);

	// Hard cap to prevent infinite loops
	if (activeGoal.turnCount > MAX_REMINDER_COUNT) {
		ctx.ui.setStatus(STATUS_KEY, `⚠ Goal stopped: turn limit (${MAX_REMINDER_COUNT})`);
		ctx.ui.notify(`Goal stopped after ${MAX_REMINDER_COUNT} turns without meeting the condition.`, "warning");
		activeGoal = null;
		return;
	}

	// Step 5: Inject a continuation message — tells the agent to keep working
	//          The job + reminder keep the LLM focused on the task.
	const reminder = [
		`[GOAL: turn ${activeGoal.turnCount}]`,
		``,
		`The completion condition has not been met yet.`,
		`Last evaluation: ${evalResult.reason}`,
		``,
		`Goal condition: ${activeGoal.condition}`,
		`Continue working toward it.`,
	].join("\n");

	await ctx.sendMessage({
		customType: STATE_TYPE,
		content: reminder,
		display: `Goal: turn ${activeGoal.turnCount} — ${evalResult.reason}`,
		details: activeGoal,
	}, {
		deliverAs: "nextTurn",
		triggerTurn: true,
	});
}

// ── session lifecycle ────────────────────────────────────────────────────
function handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): void {
	lastUiCtx = ctx;

	// Restore any active goal from session entries
	const saved = loadState(ctx.sessionManager);
	if (saved) {
		activeGoal = saved;
		startStatusTick(ctx);
		ctx.ui.notify(`Restored goal: "${saved.condition.slice(0, 60)}${saved.condition.length > 60 ? "…" : ""}" (${saved.turnCount} turns so far)`, "info");
	}
}

function handleSessionShutdown(_event: SessionShutdownEvent): void {
	stopStatusTick();
	activeGoal = null;
}

// ── Extension entry point ────────────────────────────────────────────────
export default function registerGoalExtension(pi: ExtensionAPI): void {
	// Register slash commands
	registerSlashCommands(pi, {
		get: () => activeGoal,
		set: (state) => {
			activeGoal = state;
			if (lastUiCtx) startStatusTick(lastUiCtx);
		},
		clear: () => {
			stopStatusTick();
			activeGoal = null;
			if (lastUiCtx) {
				lastUiCtx.ui.setStatus(STATUS_KEY, undefined);
			}
		},
	});

	// Turn-end evaluator loop
	pi.on("turn_end", handleTurnEnd);

	// Session lifecycle
	pi.on("session_start", handleSessionStart);
	pi.on("session_shutdown", handleSessionShutdown);
}
