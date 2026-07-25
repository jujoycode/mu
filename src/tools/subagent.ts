// subagent (설계: docs/07) — 격리된 컨텍스트로 조사·분석 서브태스크를 위임한다.
// **코어 비침습**: 이 툴은 내부에서 Agent 인스턴스를 새로 만들 뿐, 코어 루프(agent.ts)는
// 건드리지 않는다. 서브에이전트에는 subagent 툴을 주지 않아 재귀를 막는다.
//
// 반환값은 서브에이전트의 최종 텍스트 리포트. 프롬프트는 메인과 동일한 시스템 프롬프트를
// 재사용하고(하드코딩 금지), 역할·범위는 호출 측이 task 문자열로 준다.

import { Agent } from "../agent.ts";
import type { AgentEvent, Message, Tool, ToolCall, ToolResult, Usage } from "../types.ts";

export interface SubagentConfig {
	model: string;
	/** 메인과 동일한 시스템 프롬프트 재사용 (프롬프트 하드코딩 회피) */
	systemPrompt: string;
	/** 서브에이전트 툴셋 — subagent 툴을 포함하면 안 된다 (재귀 방지) */
	tools: Tool[];
	/** 게이트 — 서브에이전트는 비대화형이므로 ask는 자동 차단되게 구성한다 */
	beforeToolCall?: (toolCall: ToolCall) => Promise<{ allow: boolean; reason?: string; feedback?: string }>;
	/** 진행 표시 (들여쓰기된 한 줄) */
	onProgress?: (line: string) => void;
	/** 비용 누적 — 서브에이전트 토큰도 세션 총계에 반영 */
	onUsage?: (model: string, usage: Usage) => void;
}

export function createSubagentTool(config: SubagentConfig): Tool {
	return {
		name: "subagent",
		description:
			`Delegate a focused, self-contained investigation or analysis subtask to a fresh sub-agent ` +
			`that has its own isolated context. Use it to explore the codebase or gather information ` +
			`without cluttering your main context — the sub-agent returns a text report. ` +
			`Give it everything it needs in the task: it does not see your conversation. ` +
			`It cannot delegate further, write files, or run remote commands — scope it to reading and analysis.`,
		inputSchema: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: "The self-contained subtask, including all context the sub-agent needs to work independently",
				},
			},
			required: ["task"],
		},
		async execute(args, signal): Promise<ToolResult> {
			const task = String(args.task ?? "");
			if (!task) return { content: "Missing task", isError: true };

			const onEvent = (e: AgentEvent) => {
				if (e.type === "tool_start") config.onProgress?.(`↳ ${summarizeToolCall(e.toolCall)}`);
				else if (e.type === "assistant_end") config.onUsage?.(config.model, e.message.usage);
			};

			const sub = new Agent({
				model: config.model,
				systemPrompt: config.systemPrompt,
				tools: config.tools,
				beforeToolCall: config.beforeToolCall,
				onEvent,
			});

			try {
				await sub.run(task, signal);
			} catch (e) {
				return { content: `Sub-agent failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
			}

			const last = sub.messages[sub.messages.length - 1];
			if (last?.role === "assistant" && last.errorMessage) {
				return { content: `Sub-agent error: ${last.errorMessage}`, isError: true };
			}
			const report = extractReport(sub.messages);
			return { content: report || "(sub-agent returned no text)", isError: false };
		},
	};
}

/** 서브에이전트 메시지에서 최종 리포트(마지막 assistant 턴의 텍스트)를 뽑는다. */
export function extractReport(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === "assistant") {
			const text = m.content
				.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
				.map((c) => c.text)
				.join("")
				.trim();
			if (text) return text;
		}
	}
	return "";
}

function summarizeToolCall(toolCall: ToolCall): string {
	const a = toolCall.arguments as Record<string, unknown>;
	const detail = toolCall.name === "bash" ? String(a.command ?? "") : String(a.path ?? a.pattern ?? a.name ?? "");
	const oneLine = detail.replace(/\s+/g, " ").trim();
	return `${toolCall.name}(${oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine})`;
}
