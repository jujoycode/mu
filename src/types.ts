// messages 배열이 유일한 상태다. 이 파일의 타입이 곧 세션 포맷이다.

export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export type AssistantContent = TextContent | ToolCall;

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export type StopReason = "stop" | "toolUse" | "length" | "error" | "aborted";

export interface UserMessage {
	role: "user";
	content: string;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContent[];
	stopReason: StopReason;
	usage: Usage;
	errorMessage?: string;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: string;
	isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// 툴 실패는 throw가 아니라 isError로 표현한다. execute는 절대 throw하지 않는 것이
// 규약이지만, 루프는 규약 위반에 대비해 방어적 try/catch를 유지한다.
export interface ToolResult {
	content: string;
	isError: boolean;
}

export interface Tool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>; // JSON Schema
	execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

// 관찰 전용 이벤트 — 루프 동작에 영향을 주지 않는다 (UI/로그용).
export type AgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "tool_start"; toolCall: ToolCall }
	| { type: "tool_end"; toolCall: ToolCall; result: ToolResult }
	| { type: "assistant_end"; message: AssistantMessage };

export type OnEvent = (event: AgentEvent) => void;
