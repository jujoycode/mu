#!/usr/bin/env bun
// 진입점 + 최소 REPL (P0~P1). TUI 폴리시는 docs/07 방향에 따라 이후 단계에서.
//
// 사용법:
//   mu                # REPL
//   mu -c             # 최근 세션 이어서 REPL
//   mu -p "task"      # 원샷 (비대화형 — ask 게이트는 자동 차단)

import { existsSync, readFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { Agent } from "./agent.ts";
import { type AskDecision, createGate, loadPolicy } from "./gate.ts";
import { SessionStore } from "./session.ts";
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
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

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

// ask 프롬프트 (P1 임시 — TUI 셀렉터는 docs/07대로 이후 교체)
function makeConfirm(rl: Interface): (summary: string, pattern: string) => Promise<AskDecision> {
	return (summary, pattern) =>
		new Promise((resolve) => {
			console.log(`\n${yellow("⚠ Permission required")}`);
			console.log(`  ${summary}`);
			console.log(dim(`  matches policy pattern: ${pattern}`));
			rl.question("  [y] allow once  [a] allow for this session  [N] deny > ", (answer) => {
				const a = answer.trim().toLowerCase();
				resolve(a === "y" ? "once" : a === "a" ? "session" : "deny");
			});
		});
}

async function main(): Promise<void> {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("mu: ANTHROPIC_API_KEY is not set");
		process.exit(1);
	}

	const argv = process.argv.filter((a) => a !== "-c" && a !== "--continue");
	const continueSession = argv.length !== process.argv.length;
	const pIndex = argv.indexOf("-p");
	const oneShot = pIndex !== -1;

	// 세션: 항상 저장. -c면 이 cwd의 최근 세션에 이어서.
	const resumed = continueSession ? SessionStore.loadLatest(process.cwd()) : undefined;
	const session = resumed ?? SessionStore.create(process.cwd(), MODEL);

	// 권한 게이트 — REPL에서만 대화형 confirm이 연결된다
	let confirmImpl: ((summary: string, pattern: string) => Promise<AskDecision>) | undefined;
	const gate = createGate({
		policy: loadPolicy(),
		interactive: !oneShot,
		confirm: (summary, pattern) => (confirmImpl ? confirmImpl(summary, pattern) : Promise.resolve("deny")),
	});

	const agent = new Agent(
		{
			model: MODEL,
			systemPrompt: loadSystemPrompt(),
			tools: createCoreTools(process.cwd()),
			onEvent: makeOnEvent(),
			onMessage: (message) => session.append(message),
			beforeToolCall: gate,
		},
		resumed ? [...resumed.messages] : [],
	);

	if (oneShot) {
		const prompt = argv.slice(pIndex + 1).join(" ");
		if (!prompt) {
			console.error('mu: usage: mu [-c] [-p "task"]');
			process.exit(1);
		}
		await agent.run(prompt);
		return;
	}

	console.log(dim(`mu · ${MODEL} · ${process.cwd()}`));
	console.log(dim(`session: ${session.filePath}${resumed ? ` (resumed ${resumed.messages.length} messages)` : ""}`));
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	confirmImpl = makeConfirm(rl);
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
			if (input === "") return ask();
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
