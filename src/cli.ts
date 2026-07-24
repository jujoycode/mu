#!/usr/bin/env bun
// 진입점 + 최소 REPL (P0). TUI 폴리시는 docs/07 방향에 따라 이후 단계에서.

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Agent } from "./agent.ts";
import { createCoreTools } from "./tools/index.ts";
import type { AgentEvent, ToolCall } from "./types.ts";

const MODEL = process.env.MU_MODEL ?? "claude-sonnet-5";

function loadSystemPrompt(): string {
	// MU.md — mu 런타임이 소비하는 시스템 프롬프트 (개발용 CLAUDE.md와 다른 파일)
	const path = new URL("../MU.md", import.meta.url).pathname;
	if (!existsSync(path)) {
		console.error(`mu: MU.md not found at ${path} — the system prompt lives outside the code.`);
		process.exit(1);
	}
	const base = readFileSync(path, "utf-8").trim();
	return `${base}\n\nCurrent working directory: ${process.cwd()}\nPlatform: ${process.platform}`;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function summarizeToolCall(toolCall: ToolCall): string {
	const a = toolCall.arguments as Record<string, unknown>;
	const detail =
		toolCall.name === "bash" ? String(a.command ?? "") : String(a.path ?? JSON.stringify(a));
	const oneLine = detail.replace(/\s+/g, " ").trim();
	return `${toolCall.name}(${oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine})`;
}

function makeOnEvent(): (event: AgentEvent) => void {
	let inText = false;
	return (event) => {
		switch (event.type) {
			case "text_delta":
				inText = true;
				process.stdout.write(event.text);
				break;
			case "tool_start":
				if (inText) {
					process.stdout.write("\n");
					inText = false;
				}
				console.log(`${bold("⏺")} ${summarizeToolCall(event.toolCall)}`);
				break;
			case "tool_end": {
				const firstLine = event.result.content.split("\n")[0] ?? "";
				const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
				console.log(dim(`  ⎿ ${event.result.isError ? red(preview) : preview}`));
				break;
			}
			case "assistant_end": {
				if (inText) {
					process.stdout.write("\n");
					inText = false;
				}
				const m = event.message;
				if (m.errorMessage) console.error(red(`\nerror: ${m.errorMessage}`));
				break;
			}
		}
	};
}

async function main(): Promise<void> {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("mu: ANTHROPIC_API_KEY is not set");
		process.exit(1);
	}

	const agent = new Agent({
		model: MODEL,
		systemPrompt: loadSystemPrompt(),
		tools: createCoreTools(process.cwd()),
		onEvent: makeOnEvent(),
	});

	// 원샷 모드: mu -p "task"
	const pIndex = process.argv.indexOf("-p");
	if (pIndex !== -1) {
		const prompt = process.argv.slice(pIndex + 1).join(" ");
		if (!prompt) {
			console.error('mu: usage: mu -p "task"');
			process.exit(1);
		}
		await agent.run(prompt);
		return;
	}

	// REPL 모드
	console.log(dim(`mu · ${MODEL} · ${process.cwd()}`));
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let abortController: AbortController | undefined;

	process.on("SIGINT", () => {
		if (abortController) {
			abortController.abort();
			abortController = undefined;
			console.log(dim("\n(interrupted)"));
		} else {
			rl.close();
		}
	});

	const ask = (): void => {
		rl.question(`\n${bold("mu>")} `, async (line) => {
			const input = line.trim();
			if (input === "" ) return ask();
			if (input === "/quit" || input === "exit") return rl.close();
			abortController = new AbortController();
			try {
				await agent.run(input, abortController.signal);
			} finally {
				abortController = undefined;
			}
			ask();
		});
	};
	rl.on("close", () => process.exit(0));
	ask();
}

main();
