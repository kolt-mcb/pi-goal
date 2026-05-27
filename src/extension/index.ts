/**
 * pi-goal — Goal-directed autonomous work loops
 *
 * Mirrors Claude Code's /goal interface:
 *   /goal <condition>  — set a goal, starts working immediately
 *   /goal              — show goal status
 *   /goal clear        — clear the active goal
 *
 * After each turn, a lightweight evaluator call checks whether the condition
 * is met. If not, a nextTurn message kicks off the next turn automatically,
 * so the agent keeps working until the goal is satisfied or cleared.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	TurnEndEvent,
	SessionStartEvent,
	SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import type { GoalState } from "./persistence";
import { GOAL_STATE_TYPE, saveState, loadState, saveAchieved } from "./persistence";
import { evaluateGoal, buildTurnEvidence } from "./evaluator";
import { registerSlashCommands } from "./slash";

// ── Constants ────────────────────────────────────────────────────────────
const STATUS_KEY = "goal-status";
// Hard cap on continuation turns, so a goal that never resolves can't loop forever.
const MAX_TURNS = 120;

// ── Module-level state ───────────────────────────────────────────────────
let activeGoal: GoalState | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let lastUiCtx: ExtensionContext | null = null;
let extensionApi: ExtensionAPI | null = null;

// ── Status display ───────────────────────────────────────────────────────
function statusText(goal: GoalState): string {
	const totalSec = Math.floor((Date.now() - goal.startedAt) / 1000);
	const hrs = Math.floor(totalSec / 3600);
	const mins = Math.floor((totalSec % 3600) / 60);
	const secs = totalSec % 60;
	const t = hrs > 0
		? `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
		: `${mins}m ${secs}s`;
	return `⏱ ${goal.turnCount}t · ${t}`;
}

function updateStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, activeGoal ? statusText(activeGoal) : undefined);
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
	if (!activeGoal || !extensionApi) return;
	if (!ctx.model) {
		// No model available — can't evaluate, so stop the goal cleanly.
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, "⚠ No model for evaluation");
		activeGoal = null;
		return;
	}

	// Build evidence from this turn and ask the evaluator if the goal is met.
	const evidence = buildTurnEvidence(event);
	activeGoal.elapsedMs = Date.now() - activeGoal.startedAt;
	const evalResult = await evaluateGoal(ctx.model, activeGoal, evidence);
	activeGoal.lastReason = evalResult.reason;

	if (evalResult.met) {
		// ✓ Goal achieved
		saveAchieved(extensionApi, activeGoal);
		const turns = activeGoal.turnCount;
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, `✓ Goal achieved in ${turns} turns`);
		ctx.ui.notify(`Goal achieved in ${turns} turns`, "info");
		activeGoal = null;
		return;
	}

	// Goal not met — record progress and continue the loop.
	activeGoal.turnCount++;
	saveState(extensionApi, activeGoal);
	updateStatus(ctx);

	if (activeGoal.turnCount > MAX_TURNS) {
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, `⚠ Goal stopped: turn limit (${MAX_TURNS})`);
		ctx.ui.notify(`Goal stopped after ${MAX_TURNS} turns without meeting the condition.`, "warning");
		activeGoal = null;
		return;
	}

	// Inject a continuation message to keep the agent focused on the goal.
	const reminder = [
		`[GOAL: turn ${activeGoal.turnCount}]`,
		``,
		`The completion condition has not been met yet.`,
		`Last evaluation: ${evalResult.reason}`,
		``,
		`Goal condition: ${activeGoal.condition}`,
		`Continue working toward it.`,
	].join("\n");

	extensionApi.sendMessage({
		customType: GOAL_STATE_TYPE,
		content: reminder,
		// Hidden from the TUI (the footer timer shows progress); still steers the model.
		display: false,
		details: activeGoal,
	}, {
		deliverAs: "nextTurn",
		triggerTurn: true,
	});
}

// ── session lifecycle ────────────────────────────────────────────────────
function handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): void {
	lastUiCtx = ctx;

	// Restore an in-progress goal from a previous session, if any.
	const saved = loadState(ctx.sessionManager);
	if (saved) {
		activeGoal = saved;
		startStatusTick(ctx);
		const label = saved.condition.length > 60 ? `${saved.condition.slice(0, 60)}…` : saved.condition;
		ctx.ui.notify(`Restored goal: "${label}" (${saved.turnCount} turns so far)`, "info");
	}
}

function handleSessionShutdown(_event: SessionShutdownEvent): void {
	stopStatusTick();
	activeGoal = null;
}

// ── Extension entry point ────────────────────────────────────────────────
export default function registerGoalExtension(pi: ExtensionAPI): void {
	extensionApi = pi;

	registerSlashCommands(pi, {
		get: () => activeGoal,
		set: (state) => {
			activeGoal = state;
			if (lastUiCtx) startStatusTick(lastUiCtx);
		},
		clear: () => {
			stopStatusTick();
			activeGoal = null;
			if (lastUiCtx) lastUiCtx.ui.setStatus(STATUS_KEY, undefined);
		},
	});

	pi.on("turn_end", handleTurnEnd);
	pi.on("session_start", handleSessionStart);
	pi.on("session_shutdown", handleSessionShutdown);
}
