/**
 * Slash commands for /goal.
 *
 *   /goal <condition>  — set (or replace) a goal, start working
 *   /goal              — show goal status when active; usage info when no goal
 *   /goal clear        — clear the active goal
 *   /goal status       — same as /goal
 *
 * Mirroring Claude Code's /goal, the clear action accepts several aliases:
 * clear, stop, off, reset, none, cancel.
 *
 * The command owns no state of its own: index.ts passes accessor callbacks so
 * the command and the extension's turn-end loop share a single source of truth.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GoalState } from "./persistence";

/** Accessors into the extension's active-goal state, supplied by index.ts. */
export interface GoalSlashAPI {
	get: () => GoalState | null;
	set: (state: GoalState) => void;
	clear: () => void;
}

/** Words that clear an active goal. Mirrors Claude Code's /goal aliases. */
const CLEAR_ALIASES = ["clear", "stop", "off", "reset", "none", "cancel"];

/** Subcommands surfaced in the `/goal <Tab>` argument autocomplete. */
const SUBCOMMAND_COMPLETIONS = [
	{ value: "status", label: "status", description: "Show the active goal's status" },
	{ value: "clear", label: "clear", description: "Clear the active goal" },
	...CLEAR_ALIASES.filter((a) => a !== "clear").map((a) => ({
		value: a,
		label: a,
		description: "Clear the active goal (alias for clear)",
	})),
];

/** True when the argument is one of the clear/stop/off/… reserved words. */
function isClearCommand(arg: string): boolean {
	return CLEAR_ALIASES.includes(arg.toLowerCase());
}

export function registerSlashCommands(pi: ExtensionAPI, api: GoalSlashAPI): void {
	pi.registerCommand("goal", {
		description: "Goal-directed autonomous work loop",
		getArgumentCompletions: (prefix: string) => {
			const p = prefix.trim().toLowerCase();
			const matches = SUBCOMMAND_COMPLETIONS.filter((c) => c.value.startsWith(p));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const goal = api.get();

			if (goal) {
				// ── Goal is active ──────────────────────────────────
				if (isClearCommand(trimmed)) {
					api.clear();
					ctx.ui.notify("Goal cleared.", "info");
					return;
				}
				if (trimmed === "status" || !trimmed) {
					showStatus(goal, ctx);
					return;
				}
				// Additional args on an active goal → replace the condition
				doSetGoal(pi, api, trimmed, ctx);
				return;
			}

			// ── No active goal ──────────────────────────────────────
			if (!trimmed || trimmed === "status") {
				noActiveGoal(ctx);
				return;
			}
			if (isClearCommand(trimmed)) {
				ctx.ui.notify("No active goal to clear.", "warning");
				return;
			}

			// New goal
			doSetGoal(pi, api, trimmed, ctx);
		},
	});
}

/** Set a fresh goal and start the first turn with the condition as the prompt. */
function doSetGoal(
	pi: ExtensionAPI,
	api: GoalSlashAPI,
	condition: string,
	ctx: ExtensionCommandContext,
): void {
	api.set({
		condition,
		startedAt: Date.now(),
		turnCount: 0,
		elapsedMs: 0,
		lastReason: "",
	});
	ctx.ui.notify(
		`Goal set: "${truncate(condition, 60)}"`,
		"info",
	);

	// Kick off the first turn. Send raw (executeSlashCommands defaults to false)
	// so a condition that happens to start with "/" is treated as plain text.
	pi.sendUserMessage(condition);
}

function showStatus(goal: GoalState, ctx: ExtensionCommandContext): void {
	const lines = [
		`Condition: ${goal.condition}`,
		`Running:   ${formatDuration(Date.now() - goal.startedAt)}`,
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

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}…` : s;
}
