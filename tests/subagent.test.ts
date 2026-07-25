import { describe, expect, test } from "bun:test";
import { createSubagentTool, extractReport } from "../src/tools/subagent.ts";
import { emptyUsage, type Message } from "../src/types.ts";

const asst = (text: string): Message => ({
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	stopReason: "stop",
	usage: emptyUsage(),
});

describe("extractReport", () => {
	test("마지막 assistant 텍스트를 뽑는다", () => {
		const msgs: Message[] = [
			{ role: "user", content: "조사해줘" },
			asst("중간 생각"),
			{ role: "toolResult", toolCallId: "t", toolName: "bash", content: "출력", isError: false },
			asst("최종 리포트입니다"),
		];
		expect(extractReport(msgs)).toBe("최종 리포트입니다");
	});

	test("텍스트 없는 마지막 assistant는 건너뛰고 이전 것을 찾는다", () => {
		const msgs: Message[] = [asst("실질 리포트"), asst("")];
		expect(extractReport(msgs)).toBe("실질 리포트");
	});

	test("여러 텍스트 블록은 이어붙인다", () => {
		const msgs: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "A" },
					{ type: "toolCall", id: "1", name: "read", arguments: {} },
					{ type: "text", text: "B" },
				],
				stopReason: "stop",
				usage: emptyUsage(),
			},
		];
		expect(extractReport(msgs)).toBe("AB");
	});

	test("assistant 텍스트가 전혀 없으면 빈 문자열", () => {
		expect(extractReport([{ role: "user", content: "x" }])).toBe("");
	});
});

describe("subagent 툴", () => {
	const tool = createSubagentTool({
		model: "claude-sonnet-5",
		systemPrompt: "test",
		tools: [],
	});

	test("task 누락 → 에러 (Agent 생성 전에 반환, 네트워크 없음)", async () => {
		const r = await tool.execute({});
		expect(r.isError).toBe(true);
		expect(r.content).toContain("task");
	});

	test("툴 인터페이스 규약", () => {
		expect(tool.name).toBe("subagent");
		expect((tool.inputSchema as { required: string[] }).required).toEqual(["task"]);
		// 재귀·쓰기·원격 불가를 설명에 명시
		expect(tool.description).toContain("cannot delegate further");
	});
});
