/**
 * Goal state persistence via session entries.
 * Saves/loads goal metadata so it survives session resume.
 */

import * as path from "node:path";
import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "pi-goal-state";
const ACHIEVED_TYPE = "pi-goal-achieved";

export interface GoalState {
	condition: string;
	startedAt: number;
	turnCount: number;
	elapsedMs: number;
	lastReason: string;
}

/**
 * Save the current goal state as a session entry.
 * Overwrites the previous state entry for atomic reads.
 */
export function saveState(
	sessionManager: ReadonlySessionManager,
	state: GoalState,
): void {
	sessionManager.appendEntry?.(STATE_TYPE, {
		timestamp: Date.now(),
		...state,
	});
}

/**
 * Load the most recent goal state entry from the session.
 * Returns null if no active goal was saved.
 */
export function loadState(
	sessionManager: ReadonlySessionManager,
): GoalState | null {
	const entries = sessionManager.getEntries?.() ?? [];
	// Walk backwards — the last state entry is the current goal
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; data?: unknown };
		if (entry.type === STATE_TYPE && entry.data) {
			return entry.data as GoalState;
		}
		if (entry.type === ACHIEVED_TYPE && entry.data) {
			return null; // reached an achieved state — no active goal
		}
	}
	return null;
}

/**
 * Mark a goal as achieved.  Appends a marker entry so loadState
 * knows the goal was completed (not still active).
 */
export function saveAchieved(
	sessionManager: ReadonlySessionManager,
	state: GoalState,
): void {
	sessionManager.appendEntry?.(ACHIEVED_TYPE, {
		timestamp: Date.now(),
		...state,
	});
}

/**
 * Check if there was a previously achieved goal in this session.
 * Used by `/goal` status display to show the last achieved result.
 */
export function loadAchieved(
	sessionManager: ReadonlySessionManager,
): GoalState | null {
	const entries = sessionManager.getEntries?.() ?? [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; data?: unknown };
		if (entry.type === ACHIEVED_TYPE && entry.data) {
			return entry.data as GoalState;
		}
		if (entry.type === STATE_TYPE) {
			return null; // active state takes precedence, no achieved
		}
	}
	return null;
}
