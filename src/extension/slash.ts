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

export interface GoalSlashAPI {
	get: () => GoalState | null;
	set: (state: GoalState) => void;
	clear: () => void;
}

const CLEAR_ALIASES = ["clear", "stop", "off", "reset", "none", "cancel"];

const SUBCOMMAND_COMPLETIONS = [
	{ value: "status", label: "status", description: "Show the active goal's status" },
	{ value: "clear", label: "clear", description: "Clear the active goal" },
	...CLEAR_ALIASES.filter((a) => a !== "clear").map((a) => ({
		value: a,
		label: a,
		description: "Clear the active goal (alias for clear)",
	})),
];

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
				if (isClearCommand(trimmed)) {
					api.clear();
					ctx.ui.notify("Goal cleared.", "info");
					return;
				}
				if (trimmed === "status" || !trimmed) {
					showStatus(goal, ctx);
					return;
				}
				doSetGoal(pi, api, trimmed, ctx);
				return;
			}

			if (!trimmed || trimmed === "status") {
				noActiveGoal(ctx);
				return;
			}
			if (isClearCommand(trimmed)) {
				ctx.ui.notify("No active goal to clear.", "warning");
				return;
			}

			doSetGoal(pi, api, trimmed, ctx);
		},
	});
}

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

	// Warn on clearly vague conditions.
	const vague = /^(complete\s+(the\s+)?list|fix\s+(the\s+)?(things?|bugs)|make\s+it\s+work|finish|do\s+it)/i;
	if (vague.test(condition.trim())) {
		setTimeout(() => {
			ctx.ui.notify(
				"Vague goal condition — the evaluator may struggle. " +
				"Use a measurable target like 'all items in X.md are [x]'.",
				"warning",
			);
		}, 1500);
	}

	ctx.ui.notify(`Goal set: "${truncate(condition, 60)}"`, "info");

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
