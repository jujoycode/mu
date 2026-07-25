#!/usr/bin/env bun
// 진입점 + 최소 REPL (P0~P1). TUI 폴리시는 docs/07 방향에 따라 이후 단계에서.
//
// 사용법:
//   mu                # REPL
//   mu -c             # 최근 세션 이어서 REPL
//   mu -p "task"      # 원샷 (비대화형 — ask 게이트는 자동 차단)

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Agent } from "./agent.ts";
import { askUser } from "./components/permissions/PermissionRequest.tsx";
import { createSpinner, type Spinner } from "./components/Spinner.tsx";
import { printWelcome } from "./components/LogoV2/Welcome.ts";
import { pickVerb } from "./constants/spinnerVerbs.ts";
import { CostTracker, computeCost, formatCost, formatTokens, totalTokens } from "./utils/cost.ts";
import { type AskAnswer, type ConfirmRequest, createGate, loadPolicy } from "./gate.ts";
import { loadHosts } from "./remote/hosts.ts";
import { SessionStore } from "./session.ts";
import { createCoreTools } from "./tools/index.ts";
import { createRemoteExecTool } from "./tools/remoteExec.ts";
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

// 스피너는 "모델 대기" 구간에만 돈다 — 첫 출력이 오면 멈추고, 툴 실행 후 다음
// 턴을 기다릴 때 다시 켠다. 멘트는 대기 구간마다 새로 뽑는다 (docs/09).
function makeSpinnerController(): { begin(): void; end(): void } {
	let spinner: Spinner | undefined;
	return {
		begin() {
			if (spinner) return;
			spinner = createSpinner({ verb: pickVerb() });
			spinner.start();
		},
		end() {
			spinner?.stop();
			spinner = undefined;
		},
	};
}

function makeOnEvent(
	spin: { begin(): void; end(): void },
	cost: CostTracker,
	model: string,
): (event: AgentEvent) => void {
	let inText = false;
	return (event) => {
		switch (event.type) {
			case "text_delta":
				spin.end();
				inText = true;
				process.stdout.write(event.text);
				break;
			case "tool_start":
				spin.end();
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
				spin.begin(); // 다음 모델 턴 대기
				break;
			}
			case "assistant_end": {
				spin.end();
				if (inText) {
					process.stdout.write("\n");
					inText = false;
				}
				const m = event.message;
				if (m.errorMessage) console.error(red(`\nerror: ${m.errorMessage}`));
				// 토큰/비용 추적 (docs/04 P1): 이 턴 usage를 누적하고 세션 총계를 함께 보여준다
				cost.add(model, m.usage);
				const turnTokens = totalTokens(m.usage);
				if (turnTokens > 0) {
					const turn = `${formatTokens(turnTokens)} tok · ${formatCost(computeCost(model, m.usage))}`;
					console.log(dim(`  ⎿ ${turn}  ·  session ${cost.summary()}`));
				}
				break;
			}
		}
	};
}

// ask 프롬프트 — Claude Code 스타일 Ink 다이얼로그 (설계: docs/08 PART 2).
// 게이트가 구조화된 ConfirmRequest를 주면 그대로 다이얼로그로 옮긴다.
function confirmViaDialog(req: ConfirmRequest) {
	return askUser({
		title: req.title,
		subtitle: req.detail,
		pattern: req.pattern,
		focusNo: req.focusNo,
		allowSession: req.allowSession,
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

	// 권한 게이트 — REPL에서만 대화형 confirm이 연결된다.
	// Ink 다이얼로그가 stdin을 잡는 동안 readline을 잠시 멈춘다 (stdin 경합 방지).
	const hosts = loadHosts();
	let confirmImpl: ((req: ConfirmRequest) => Promise<AskAnswer>) | undefined;
	const gate = createGate({
		policy: loadPolicy(),
		interactive: !oneShot,
		hosts,
		confirm: (req) => (confirmImpl ? confirmImpl(req) : Promise.resolve({ decision: "deny" })),
	});

	const spin = makeSpinnerController();
	const cost = new CostTracker();
	const agent = new Agent(
		{
			model: MODEL,
			systemPrompt: loadSystemPrompt(),
			tools: [...createCoreTools(process.cwd()), createRemoteExecTool(hosts)],
			onEvent: makeOnEvent(spin, cost, MODEL),
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

	await printWelcome({
		model: MODEL,
		cwd: process.cwd(),
		sessionLine: `session: ${session.filePath}${resumed ? ` (resumed ${resumed.messages.length} messages)` : ""}`,
	});
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	confirmImpl = async (req) => {
		spin.end();
		rl.pause();
		try {
			return await confirmViaDialog(req);
		} finally {
			rl.resume();
		}
	};
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
			spin.begin(); // 첫 모델 응답 대기
			try {
				await agent.run(input, abortController.signal);
			} finally {
				spin.end();
				abortController = undefined;
			}
			ask();
		});
	};
	rl.on("close", () => {
		if (totalTokens(cost.totalUsage) > 0) console.log(dim(`\n${cost.summary()} this session`));
		process.exit(0);
	});
	ask();
}

main();
