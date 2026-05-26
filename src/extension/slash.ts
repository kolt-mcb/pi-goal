/**
 * Slash commands for /goal.
 *
 *   /goal <condition>  — set (or replace) a goal, start working
 *   /goal              — show goal status when active; usage info when no goal
 *   /goal clear        — clear the active goal
 *   /goal status       — same as /goal
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GoalState } from "./persistence.ts";

interface GoalSlashAPI {
	get: () => GoalState | null;
	set: (state: GoalState) => void;
	clear: () => void;
}

export function registerSlashCommands(pi: ExtensionAPI, api: GoalSlashAPI): void {
	pi.registerCommand("goal", {
		description: "Goal-directed autonomous work loop",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const goal = api.get();

			if (goal) {
				// ── Goal is active ──────────────────────────────────
				if (trimmed === "clear" || trimmed === "stop") {
					api.clear();
					ctx.ui.setStatus("goal-status", undefined);
					ctx.ui.notify("Goal cleared.", "info");
					return;
				}
				if (trimmed === "status" || !trimmed) {
					await showStatus(goal, ctx);
					return;
				}
				// Additional args on active goal → replace condition
				await doSetGoal(pi, api, trimmed, ctx);
				return;
			}

			// ── No active goal ──────────────────────────────────────
			if (!trimmed) {
				noActiveGoal(ctx);
				return;
			}

			if (trimmed === "clear" || trimmed === "stop") {
				ctx.ui.notify("No active goal to clear.", "warning");
				return;
			}

			if (trimmed === "status") {
				noActiveGoal(ctx);
				return;
			}

			// New goal
			await doSetGoal(pi, api, trimmed, ctx);
		},
	});
}

/** Clear handler is called from the active branch above. */
async function handleActiveGoal(args: string, api: GoalSlashAPI, ctx: ExtensionCommandContext, goal: GoalState): Promise<boolean> {
	if (args === "clear" || args === "stop") {
		api.clear();
		ctx.ui.setStatus("goal-status", undefined);
		ctx.ui.notify("Goal cleared.", "info");
		return true;
	}
	if (args === "status") {
		await showStatus(goal, ctx);
		return true;
	}
	return false;
}

/** Set a fresh goal and start the first turn. */
async function doSetGoal(
	_pi: ExtensionAPI,
	api: GoalSlashAPI,
	condition: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state: GoalState = {
		condition,
		startedAt: Date.now(),
		turnCount: 0,
		elapsedMs: 0,
		lastReason: "",
	};
	api.set(state);
	ctx.ui.setStatus("goal-status", `⏱ 0t · 0m 0s · ${condition.slice(0, 40)}`);
	ctx.ui.notify(`Goal set: "${condition.slice(0, 60)}${condition.length > 60 ? "…" : ""}"`, "info");

	// Start the first turn with the condition as the user prompt
	_pi.sendUserMessage(condition, { executeSlashCommands: false });
}

async function showStatus(goal: GoalState, ctx: ExtensionCommandContext): Promise<void> {
	const elapsed = formatDuration(Date.now() - goal.startedAt);

	const lines = [
		`Condition: ${goal.condition}`,
		`Running:   ${elapsed}`,
		`Turns:     ${goal.turnCount}`,
	];
	if (goal.lastReason) {
		lines.push(`Last reason: ${goal.lastReason}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

function noActiveGoal(ctx: ExtensionCommandContext): void {
	ctx.ui.notify("No active goal. Use `/goal <condition>` to set one.", "info");
}

function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const hrs = Math.floor(totalSec / 3600);
	const mins = Math.floor((totalSec % 3600) / 60);
	const secs = totalSec % 60;
	if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
	return `${mins}m ${secs}s`;
}
