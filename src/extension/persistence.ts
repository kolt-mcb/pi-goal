/**
 * Goal state persistence via session entries.
 *
 * Goal metadata is stored as custom session entries so an in-progress goal
 * survives session resume. Writes go through `pi.appendEntry` (ExtensionAPI);
 * reads walk the entries exposed by the read-only session manager.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ReadonlySessionManager isn't exported from the package root; derive it from
// the context shape so loadState accepts exactly what event handlers receive.
type ReadonlySessionManager = ExtensionContext["sessionManager"];

/** customType for an active-goal snapshot entry. */
const STATE_TYPE = "pi-goal-state";
/** customType for a marker written when a goal is achieved. */
const ACHIEVED_TYPE = "pi-goal-achieved";

export interface GoalState {
	condition: string;
	startedAt: number;
	turnCount: number;
	elapsedMs: number;
	lastReason: string;
}

// Re-exported so the extension can tag continuation messages consistently.
export { STATE_TYPE as GOAL_STATE_TYPE };

/**
 * Save the current goal state as a custom session entry.
 * The latest such entry wins on resume (see loadState).
 */
export function saveState(pi: ExtensionAPI, state: GoalState): void {
	pi.appendEntry(STATE_TYPE, { timestamp: Date.now(), ...state });
}

/**
 * Load the most recent goal state from the session.
 *
 * Walks entries newest-first. `pi.appendEntry` stores a CustomEntry whose
 * `type` is always "custom" and whose `customType` carries our tag, so we
 * match on `customType` — not `type`. A more recent "achieved" marker means
 * the last goal finished, so there is no active goal to restore.
 */
export function loadState(
	sessionManager: ReadonlySessionManager,
): GoalState | null {
	const entries = sessionManager.getEntries() ?? [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as {
			type?: string;
			customType?: string;
			data?: unknown;
		};
		if (entry.type !== "custom") continue;
		if (entry.customType === STATE_TYPE && entry.data) {
			return entry.data as GoalState;
		}
		if (entry.customType === ACHIEVED_TYPE) {
			return null; // most recent goal was completed — nothing active
		}
	}
	return null;
}

/**
 * Mark a goal as achieved. Appends a marker entry so loadState knows the
 * goal was completed rather than still active.
 */
export function saveAchieved(pi: ExtensionAPI, state: GoalState): void {
	pi.appendEntry(ACHIEVED_TYPE, { timestamp: Date.now(), ...state });
}
