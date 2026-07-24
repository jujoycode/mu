// 코어 루프 — mu의 심장. ~150줄 유지 목표.
//
// 종료 조건은 하나: tool call 없는 assistant 응답 = 자연 종료.
// messages 배열이 유일한 상태다 (세션 저장 = 이 배열의 JSON 덤프).

import { streamAssistant } from "./llm.ts";
import type { Message, OnEvent, Tool, ToolCall, ToolResult, ToolResultMessage } from "./types.ts";

export interface AgentOptions {
	model: string;
	systemPrompt: string;
	tools: Tool[];
	maxTokens?: number;
	onEvent?: OnEvent;
	// 권한 게이트 자리 (P1): 실행 전 판정. false를 반환하면 실행하지 않는다.
	beforeToolCall?: (toolCall: ToolCall) => Promise<{ allow: boolean; reason?: string }>;
}

export class Agent {
	readonly messages: Message[] = [];

	constructor(private readonly options: AgentOptions) {}

	async run(userText: string, signal?: AbortSignal): Promise<void> {
		this.messages.push({ role: "user", content: userText });

		while (true) {
			const assistant = await streamAssistant({
				model: this.options.model,
				systemPrompt: this.options.systemPrompt,
				messages: this.messages,
				tools: this.options.tools,
				maxTokens: this.options.maxTokens,
				signal,
				onEvent: this.options.onEvent,
			});
			this.messages.push(assistant);
			this.options.onEvent?.({ type: "assistant_end", message: assistant });

			if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return;

			const toolCalls = assistant.content.filter((c): c is ToolCall => c.type === "toolCall");
			if (toolCalls.length === 0) return;

			for (const toolCall of toolCalls) {
				const result =
					assistant.stopReason === "length"
						? // truncation 방어: 출력이 잘린 턴의 tool call은 인자가 깨졌을 수 있으므로 실행하지 않는다
							{
								content:
									"Tool call arguments may have been truncated because the response hit the output " +
									"token limit. The call was not executed. Please re-issue this tool call.",
								isError: true,
							}
						: await this.executeToolCall(toolCall, signal);
				const message: ToolResultMessage = {
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: result.content,
					isError: result.isError,
				};
				this.messages.push(message);
				this.options.onEvent?.({ type: "tool_end", toolCall, result });
				if (signal?.aborted) return;
			}
		}
	}

	private async executeToolCall(toolCall: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
		this.options.onEvent?.({ type: "tool_start", toolCall });

		const tool = this.options.tools.find((t) => t.name === toolCall.name);
		if (!tool) return { content: `Tool ${toolCall.name} not found`, isError: true };

		if (this.options.beforeToolCall) {
			const verdict = await this.options.beforeToolCall(toolCall);
			if (!verdict.allow) {
				return { content: verdict.reason ?? "Tool execution was blocked", isError: true };
			}
		}

		if (signal?.aborted) return { content: "Operation aborted", isError: true };

		// 방어적 try/catch: 툴의 "throw 금지" 규약이 깨져도 루프는 죽지 않는다.
		// 실패는 크래시가 아니라 정보다 — 에러 문자열이 모델에게 돌아간다.
		try {
			return await tool.execute(toolCall.arguments, signal);
		} catch (e) {
			return { content: e instanceof Error ? e.message : String(e), isError: true };
		}
	}
}
