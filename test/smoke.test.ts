/**
 * Runtime smoke test for the pi-goal extension.
 *
 * Exercises the real extension modules through a mock ExtensionAPI to prove the
 * pieces are actually wired together:
 *   1. /goal <condition> sets state AND starts the first turn (sendUserMessage)
 *   2. the slash command and the turn-end loop share one source of truth
 *   3. /goal status reflects the live state; /goal clear resets it
 *   4. persistence round-trips through appendEntry → loadState (the customType bug)
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import registerGoalExtension from "../src/extension/index.ts";
import { saveState, loadState, saveAchieved, type GoalState } from "../src/extension/persistence.ts";

let failures = 0;
function check(name: string, fn: () => void) {
	try {
		fn();
		console.log(`  ✓ ${name}`);
	} catch (err) {
		failures++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${(err as Error).message}`);
	}
}

// ── A minimal session-entry store shared by the mock pi + session manager ──
interface Entry { type: "custom"; customType: string; data?: unknown }
const entries: Entry[] = [];

const notifications: Array<{ msg: string; type?: string }> = [];
const statuses: Record<string, string | undefined> = {};
const userMessages: string[] = [];
const sentMessages: Array<{ customType: string; display: boolean }> = [];
const handlers: Record<string, Function> = {};
let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
let getArgumentCompletions: ((prefix: string) => any[] | null) | undefined;

// appendEntry mirrors pi: stores a CustomEntry with type "custom" + customType.
const pi: any = {
	registerCommand: (_name: string, opts: any) => {
		commandHandler = opts.handler;
		getArgumentCompletions = opts.getArgumentCompletions;
	},
	on: (event: string, handler: Function) => { handlers[event] = handler; },
	sendUserMessage: (content: string) => { userMessages.push(content); },
	sendMessage: (m: any) => { sentMessages.push({ customType: m.customType, display: m.display }); },
	appendEntry: (customType: string, data?: unknown) => { entries.push({ type: "custom", customType, data }); },
};

const sessionManager = { getEntries: () => entries };
const ui = {
	notify: (msg: string, type?: string) => notifications.push({ msg, type }),
	setStatus: (key: string, text: string | undefined) => { statuses[key] = text; },
};
const ctx: any = { ui, sessionManager, model: undefined };

// ── Tests ──────────────────────────────────────────────────────────────────
console.log("pi-goal smoke test\n");

registerGoalExtension(pi);

check("registers the /goal command and lifecycle handlers", () => {
	assert.ok(commandHandler, "command handler registered");
	assert.ok(handlers["turn_end"], "turn_end handler registered");
	assert.ok(handlers["session_start"], "session_start handler registered");
});

// session_start binds lastUiCtx (needed for status ticking) with no saved goal.
check("session_start with no saved goal leaves state empty", () => {
	handlers["session_start"]({ type: "session_start", reason: "startup" }, ctx);
	assert.equal(statuses["goal-status"], undefined);
});

check("/goal <condition> starts the first turn", async () => {
	await commandHandler!("ship the feature", ctx);
	assert.equal(userMessages.length, 1, "exactly one turn kicked off");
	assert.equal(userMessages[0], "ship the feature");
	assert.ok(
		notifications.some((n) => n.msg.includes("Goal set")),
		"user notified the goal was set",
	);
});

// This is the regression that was broken: the command must mutate the SAME
// state the loop reads. /goal status with no extra args must show the goal.
check("/goal status reflects the live goal (shared state)", async () => {
	notifications.length = 0;
	await commandHandler!("", ctx);
	const status = notifications.find((n) => n.msg.includes("Condition:"));
	assert.ok(status, "status was shown instead of 'no active goal'");
	assert.ok(status!.msg.includes("ship the feature"), "shows the live condition");
});

check("/goal clear resets the shared state", async () => {
	notifications.length = 0;
	await commandHandler!("clear", ctx);
	assert.ok(notifications.some((n) => n.msg === "Goal cleared."));
	assert.equal(statuses["goal-status"], undefined, "status cleared");

	// After clearing, status must report no active goal again.
	notifications.length = 0;
	await commandHandler!("", ctx);
	assert.ok(notifications.some((n) => n.msg.includes("No active goal")));
});

// A clear alias (e.g. "cancel") must clear an active goal, not replace it.
check("/goal <alias> clears an active goal", async () => {
	await commandHandler!("ship it", ctx); // re-arm a goal
	notifications.length = 0;
	userMessages.length = 0;
	await commandHandler!("cancel", ctx);
	assert.ok(notifications.some((n) => n.msg === "Goal cleared."), "alias cleared the goal");
	assert.equal(userMessages.length, 0, "alias did not start a new turn");
	assert.equal(statuses["goal-status"], undefined, "status cleared");
});

// getArgumentCompletions powers the `/goal <Tab>` autocomplete.
check("argument autocomplete offers the subcommands and filters by prefix", () => {
	assert.ok(getArgumentCompletions, "getArgumentCompletions registered");
	const all = getArgumentCompletions!("") ?? [];
	const values = all.map((c) => c.value);
	for (const expected of ["status", "clear", "stop", "off", "reset", "none", "cancel"]) {
		assert.ok(values.includes(expected), `autocomplete includes "${expected}"`);
	}
	const st = getArgumentCompletions!("st") ?? [];
	assert.deepEqual(st.map((c) => c.value).sort(), ["status", "stop"], "prefix 'st' narrows the list");
	assert.equal(getArgumentCompletions!("zzz"), null, "no matches returns null");
});

// ── Persistence round-trip (the entry.type vs entry.customType bug) ──────────
check("saveState → loadState round-trips an active goal", () => {
	entries.length = 0;
	const state: GoalState = {
		condition: "all tests pass", startedAt: 1000, turnCount: 3, elapsedMs: 5000, lastReason: "two failures left",
	};
	saveState(pi, state);
	const loaded = loadState(sessionManager as any);
	assert.ok(loaded, "a goal was loaded back");
	assert.equal(loaded!.condition, "all tests pass");
	assert.equal(loaded!.turnCount, 3);
});

check("a later 'achieved' marker means no active goal on resume", () => {
	saveAchieved(pi, { condition: "all tests pass", startedAt: 1000, turnCount: 4, elapsedMs: 6000, lastReason: "done" });
	assert.equal(loadState(sessionManager as any), null, "completed goal is not restored");
});

check("loadState returns null on a fresh session", () => {
	assert.equal(loadState({ getEntries: () => [] } as any), null);
});

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
