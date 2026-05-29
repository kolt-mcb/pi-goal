/**
 * Lightweight goal evaluator.
 *
 * Calls the same configured model with a minimal prompt to determine
 * whether the goal completion condition has been satisfied based on
 * the agent's most recent turn output and file-level evidence.
 */

import { execSync } from "node:child_process";
import { completeSimple } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { GoalState } from "./persistence";

interface EvalResult {
	met: boolean;
	reason: string;
}

function buildEvalPrompt(
	condition: string,
	turnText: string,
	turnCount: number,
	gitStat: string,
): string {
	return [
		`You are judging whether this goal condition is met:`,
		`"${condition}"`,
		`This is turn ${turnCount}.`,
		"",
		"=== FILE CHANGES ===",
		gitStat || "(no changes)",
		"",
		"=== AGENT OUTPUT (last turn) ===",
		"---",
		truncate(turnText, 8000),
		"---",
		"",
		"Reply with exactly one of these two options:",
		"",
		"YES",
		"NO: <reason>",
		"",
		"Use YES only when the evidence clearly shows the condition is satisfied.",
		"Use NO if the condition is not met or you cannot tell.",
	].join("\n");
}

function gitDiffStat(cwd: string): string {
	try {
		return execSync(
			`git -C ${cwd} diff --stat -- .`,
			{ encoding: "utf-8", timeout: 5000 },
		).trim();
	} catch {
		return "";
	}
}

/**
 * Evaluate whether the goal condition is met.
 */
export async function evaluateGoal(
	model: Model<any>,
	state: GoalState,
	turnText: string,
	cwd?: string,
): Promise<EvalResult> {
	const gitStat = cwd ? gitDiffStat(cwd) : "";
	const prompt = buildEvalPrompt(
		state.condition,
		turnText,
		state.turnCount + 1,
		gitStat,
	);

	try {
		const result = await completeSimple(model, {
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			tools: [],
		}, {
			reasoning: "minimal",
		});

		const text = (result.content ?? [])
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text ?? "")
			.join(" ")
			.trim();

		// Strip thinking blocks and get the first line — the model should reply
		// with YES or NO: <reason> on the first line.
		const clean = text.replace(/<thinking>.*?<\/thinking>/gs, "").trim();
		const firstLine = clean.split("\n")[0].trim();

		if (/^YES$/i.test(firstLine)) {
			return { met: true, reason: "Condition satisfied" };
		}

		const noMatch = /^NO:\s*(.*)/i.exec(firstLine);
		return {
			met: false,
			reason: (noMatch?.[1]?.trim() ?? clean.slice(0, 120)) || "Evaluator did not reach a conclusion",
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
 * Build evidence text from a turn end event.
 */
export function buildTurnEvidence(
	event: { message?: unknown; toolResults?: unknown[] },
): string {
	const parts: string[] = [];

	const msg = event.message as { role?: string; content?: unknown[] } | undefined;
	if (msg?.content && Array.isArray(msg.content)) {
		for (const block of msg.content) {
			const b = block as { type?: string; text?: string; name?: string; arguments?: unknown };
			if (b.type === "text" && b.text) {
				parts.push(`--- text ---\n${b.text}`);
			} else if (b.type === "toolCall" || b.type === "tool_use") {
				const name = b.name ?? "unknown";
				const args = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments ?? "");
				parts.push(`--- tool: ${name} ---\n${args}`);
			}
		}
	}

	const toolResults = event.toolResults as Array<{
		toolName?: string;
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	}> | undefined;
	if (toolResults?.length) {
		for (const tr of toolResults) {
			const name = tr.toolName ?? "unknown";
			const text = (tr.content ?? [])
				.filter((c: { type?: string; text?: string }) => c.type === "text")
				.map((c: { type?: string; text?: string }) => c.text ?? "")
				.join("\n");
			if (text) {
				parts.push(`--- ${name}${tr.isError ? " [error]" : ""} ---\n${text}`);
			}
		}
	}

	return parts.join("\n\n");
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + "\n...(truncated)" : s;
}
