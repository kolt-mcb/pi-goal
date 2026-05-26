/**
 * Lightweight goal evaluator.
 *
 * Calls the same configured model with a minimal prompt to determine
 * whether the goal completion condition has been satisfied based on
 * the agent's most recent turn output.
 */

import { completeSimple } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { GoalState } from "./persistence.ts";

interface EvalResult {
	met: boolean;
	reason: string;
	usage?: { input: number; output: number };
}

/**
 * Build the evaluator prompt from the goal condition and turn evidence.
 */
function buildEvalPrompt(condition: string, turnText: string, turnCount: number): string {
	return [
		`CONDITION: ${condition}`,
		`TURN: ${turnCount}`,
		`AGENT OUTPUT SUMMARY (text + tool results from last turn):`,
		"---",
		truncate(turnText, 6000),
		"---",
		"",
		"Has the condition been met? Reply with exactly one of:",
		'  YES  — if the agent output demonstrates the condition is satisfied.',
		'  NO: <brief reason>  — if not, what is still needed.',
	].join("\n");
}

/**
 * Evaluate whether the goal condition is met.
 */
export async function evaluateGoal(
	model: Model<any>,
	state: GoalState,
	turnText: string,
): Promise<EvalResult> {
	const prompt = buildEvalPrompt(state.condition, turnText, state.turnCount + 1);

	try {
		const result = await completeSimple(model, {
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			tools: [],
		}, {
			reasoning: "off",
		});

		const text = (result.content ?? [])
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text ?? "")
			.join(" ")
			.trim();

		if (/^YES$/i.test(text)) {
			return { met: true, reason: "Condition satisfied" };
		}

		const match = /^NO:\s*(.*)/i.exec(text);
		return {
			met: false,
			reason: match?.[1]?.trim() ?? "Evaluator did not reach a conclusion",
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			met: false,
			reason: `Evaluator error: ${msg.slice(0, 120)}`,
		};
	}
}

/**
 * Evaluate with explicit turn text and context messages.
 * The turnText should contain the assistant's text + tool result evidence
 * from the most recent turn.
 */
export function buildTurnEvidence(
	event: { message?: unknown; toolResults?: unknown[] },
): string {
	const parts: string[] = [];

	// Assistant message text
	const msg = event.message as { role?: string; content?: unknown[] } | undefined;
	if (msg?.content && Array.isArray(msg.content)) {
		for (const block of msg.content) {
			const b = block as { type?: string; text?: string; name?: string; arguments?: unknown };
			if (b.type === "text" && b.text) {
				parts.push(`--- text output ---\n${b.text}`);
			} else if (b.type === "toolCall" || b.type === "tool_use") {
				const toolName = b.name ?? "unknown";
				const args = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments ?? "");
				parts.push(`--- tool use: ${toolName} ---\n${args}`);
			}
		}
	}

	// Tool results
	const toolResults = event.toolResults as Array<{
		toolName?: string;
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	}> | undefined;
	if (toolResults?.length) {
		for (const tr of toolResults) {
			const name = tr.toolName ?? "unknown";
			const isError = tr.isError ? " [error]" : "";
			const text = (tr.content ?? [])
				.filter((c: { type?: string; text?: string }) => c.type === "text")
				.map((c: { type?: string; text?: string }) => c.text ?? "")
				.join("\n");
			if (text) {
				parts.push(`--- tool result: ${name}${isError} ---\n${text}`);
			}
		}
	}

	return parts.join("\n\n");
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + "\n...(truncated)";
}
