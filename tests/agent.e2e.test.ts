// 에이전트 루프 E2E — 모의 LLM(streamAssistant)으로 전체 하네스를 검증한다.
// 실 API 키 없이 코어 루프 + 실제 툴(edit/bash) + 게이트 + 세션 저장을 함께 돌려
// "실레포 버그픽스를 무개입으로 완수"(P0 완료 조건)를 재현한다.

import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamParams } from "../src/llm.ts";
import type { AssistantMessage, Message } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

// 스크립트된 어시스턴트 턴 — 실제 SSE 대신 이 시퀀스를 반환한다.
let script: AssistantMessage[] = [];
let turn = 0;
const asst = (content: AssistantMessage["content"], stop: AssistantMessage["stopReason"]): AssistantMessage => ({
	role: "assistant",
	content,
	stopReason: stop,
	usage: { ...emptyUsage(), input: 100, output: 20 },
});

// llm.ts를 모킹 — agent.ts의 `import { streamAssistant } from "./llm.ts"`가 이걸로 대체된다.
mock.module("../src/llm.ts", () => ({
	streamAssistant: async (params: StreamParams): Promise<AssistantMessage> => {
		// onEvent를 실제 루프처럼 발화 (텍스트/툴 스트리밍 관찰자 검증)
		const msg = script[turn] ?? asst([{ type: "text", text: "done" }], "stop");
		turn++;
		for (const c of msg.content) {
			if (c.type === "text") params.onEvent?.({ type: "text_delta", text: c.text });
		}
		return msg;
	},
}));

// 모킹 후 import (모듈 캐시가 모의 llm을 물도록)
const { Agent } = await import("../src/agent.ts");
const { createCoreTools } = await import("../src/tools/index.ts");
const { createGate } = await import("../src/gate.ts");

describe("agent E2E (mock LLM)", () => {
	test("off-by-one 버그를 edit→bash 검증→완료 (무개입)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "mu-e2e-"));
		const file = join(dir, "sum.ts");
		// 버그: i <= n 이면 배열 범위를 벗어난다
		writeFileSync(file, "export const sum = (a: number[], n: number) => {\n  let s = 0;\n  for (let i = 0; i <= n; i++) s += a[i];\n  return s;\n};\n");

		turn = 0;
		script = [
			// 1턴: edit 툴로 <= 를 < 로 수정
			asst([{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "sum.ts", edits: [{ oldText: "i <= n", newText: "i < n" }] } }], "toolUse"),
			// 2턴: bash로 수정 확인
			asst([{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "grep -c 'i < n' sum.ts" } }], "toolUse"),
			// 3턴: 최종 답변 (툴콜 없음 → 자연 종료)
			asst([{ type: "text", text: "off-by-one을 고쳤습니다: i <= n → i < n" }], "stop"),
		];

		const events: string[] = [];
		const saved: Message[] = [];
		const gate = createGate({ policy: { bash: {} }, interactive: false, auditPath: join(dir, "audit.jsonl") });

		const agent = new Agent({
			model: "claude-sonnet-5",
			systemPrompt: "test",
			tools: createCoreTools(dir),
			onEvent: (e) => events.push(e.type),
			onMessage: (m) => saved.push(m),
			beforeToolCall: gate,
		});

		await agent.run("sum.ts의 off-by-one 버그를 고쳐줘");

		// 파일이 실제로 수정됐다
		expect(readFileSync(file, "utf8")).toContain("i < n");
		expect(readFileSync(file, "utf8")).not.toContain("i <= n");
		// 루프가 3턴 돌고, 툴 2회 실행됐다
		expect(turn).toBe(3);
		expect(events.filter((e) => e === "tool_start").length).toBe(2);
		expect(events).toContain("tool_end");
		// 마지막 메시지는 자연 종료 텍스트
		const last = saved[saved.length - 1];
		expect(last?.role).toBe("assistant");
		// 세션에 user + assistant*3 + toolResult*2 = 6 메시지가 쌓였다
		expect(saved.length).toBe(6);

		rmSync(dir, { recursive: true, force: true });
	});

	test("게이트 deny는 툴 실행을 막고 사유를 모델에 반환 (크래시 아님)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "mu-e2e-deny-"));
		writeFileSync(join(dir, "secret"), "x");

		turn = 0;
		script = [
			asst([{ type: "toolCall", id: "d1", name: "bash", arguments: { command: "cat .env" } }], "toolUse"),
			asst([{ type: "text", text: "차단되어 실행하지 않았습니다" }], "stop"),
		];

		let toolResult: Message | undefined;
		const gate = createGate({
			// .env 출력은 deny
			policy: { bash: { deny: ["\\.env\\b"] } },
			interactive: false,
			auditPath: join(dir, "audit.jsonl"),
		});
		const agent = new Agent({
			model: "claude-sonnet-5",
			systemPrompt: "test",
			tools: createCoreTools(dir),
			onMessage: (m) => {
				if (m.role === "toolResult") toolResult = m;
			},
			beforeToolCall: gate,
		});

		await agent.run("read the env file");

		expect(toolResult?.role).toBe("toolResult");
		if (toolResult?.role === "toolResult") {
			expect(toolResult.isError).toBe(true);
			expect(toolResult.content).toContain("Blocked by policy");
		}
		rmSync(dir, { recursive: true, force: true });
	});
});
