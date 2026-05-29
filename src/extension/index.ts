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

const STATUS_KEY = "goal-status";
const MAX_TURNS = 120;

let activeGoal: GoalState | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let lastUiCtx: ExtensionContext | null = null;
let extensionApi: ExtensionAPI | null = null;

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

async function handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
	if (!activeGoal || !extensionApi) return;
	if (!ctx.model) {
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, "⚠ No model for evaluation");
		activeGoal = null;
		return;
	}

	const evidence = buildTurnEvidence(event);
	activeGoal.elapsedMs = Date.now() - activeGoal.startedAt;
	const evalResult = await evaluateGoal(ctx.model, activeGoal, evidence, ctx.cwd);
	activeGoal.lastReason = evalResult.reason;

	if (evalResult.met) {
		saveAchieved(extensionApi, activeGoal);
		const turns = activeGoal.turnCount;
		stopStatusTick();
		ctx.ui.setStatus(STATUS_KEY, `✓ Goal achieved in ${turns} turns`);
		ctx.ui.notify(`Goal achieved in ${turns} turns`, "info");
		activeGoal = null;
		return;
	}

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

	const reminder = [
		`[GOAL: turn ${activeGoal.turnCount}]`,
		`Condition not met yet. Last evaluation: ${evalResult.reason}`,
		`Goal: ${activeGoal.condition}`,
		`Continue working.`,
	].join("\n");

	extensionApi.sendMessage({
		customType: GOAL_STATE_TYPE,
		content: reminder,
		display: false,
		details: activeGoal,
	}, {
		deliverAs: "nextTurn",
		triggerTurn: true,
	});
}

function handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): void {
	lastUiCtx = ctx;

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
