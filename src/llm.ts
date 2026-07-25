// Anthropic 스트리밍 래퍼 (단일 프로바이더).
//
// pi 방식을 따른다: SDK 스트리밍 헬퍼의 내장 재시도가 AbortSignal을 무시하므로
// maxRetries: 0 + raw Response + 자체 SSE 파싱 + abortable 재시도로 구현한다.
// 계약: 이 함수는 절대 throw하지 않는다 — 실패는 stopReason: "error" | "aborted"로
// 인코딩된 AssistantMessage로 반환된다 (실패는 크래시가 아니라 정보다).

import Anthropic from "@anthropic-ai/sdk";
import {
	type AssistantContent,
	type AssistantMessage,
	type Message,
	type OnEvent,
	type StopReason,
	type Tool,
	type Usage,
	emptyUsage,
} from "./types.ts";

export interface StreamParams {
	model: string;
	systemPrompt: string;
	messages: Message[];
	tools: Tool[];
	maxTokens?: number;
	signal?: AbortSignal;
	onEvent?: OnEvent;
}

const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30_000;

export async function streamAssistant(params: StreamParams): Promise<AssistantMessage> {
	const { signal, onEvent } = params;
	for (let attempt = 0; ; attempt++) {
		if (signal?.aborted) return errorMessage("aborted", "Request aborted");
		const result = await attemptStream(params);
		if (result.ok) return result.message;
		const retryable = result.retryable && !result.emitted && attempt < MAX_RETRIES;
		if (!retryable) {
			return errorMessage(signal?.aborted ? "aborted" : "error", result.error);
		}
		await abortableSleep(retryDelayMs(attempt, result.retryAfterMs), signal);
	}
}

type Attempt =
	| { ok: true; message: AssistantMessage }
	| { ok: false; error: string; retryable: boolean; retryAfterMs?: number; emitted: boolean };

async function attemptStream(params: StreamParams): Promise<Attempt> {
	const { model, systemPrompt, messages, tools, maxTokens, signal, onEvent } = params;
	const client = new Anthropic({ maxRetries: 0 });
	let emitted = false;
	try {
		const response = await client.messages
			.create(
				{
					model,
					max_tokens: maxTokens ?? 16384,
					stream: true,
					system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
					messages: convertMessages(messages),
					tools: tools.map((t) => ({
						name: t.name,
						description: t.description,
						input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
					})),
				},
				{ signal },
			)
			.asResponse();

		if (!response.ok || !response.body) {
			const body = await response.text().catch(() => "");
			return {
				ok: false,
				error: `API error ${response.status}: ${truncateError(body)}`,
				retryable: isRetryableStatus(response.status, response.headers),
				retryAfterMs: retryAfterFromHeaders(response.headers),
				emitted: false,
			};
		}

		const content: AssistantContent[] = [];
		const partialJson: Map<number, { block: Extract<AssistantContent, { type: "toolCall" }>; json: string }> = new Map();
		const usage = emptyUsage();
		let stopReason: StopReason = "stop";
		let sawStart = false;
		let sawStop = false;

		for await (const event of iterateSseEvents(response.body, signal)) {
			switch (event.type) {
				case "message_start": {
					sawStart = true;
					captureUsage(usage, event.message?.usage);
					break;
				}
				case "content_block_start": {
					const block = event.content_block;
					if (block?.type === "text") {
						content.push({ type: "text", text: block.text ?? "" });
					} else if (block?.type === "tool_use") {
						const toolCall = {
							type: "toolCall" as const,
							id: block.id as string,
							name: block.name as string,
							arguments: (block.input as Record<string, unknown>) ?? {},
						};
						content.push(toolCall);
						partialJson.set(event.index as number, { block: toolCall, json: "" });
					}
					break;
				}
				case "content_block_delta": {
					const delta = event.delta;
					const last = content[content.length - 1];
					if (delta?.type === "text_delta" && last?.type === "text") {
						last.text += delta.text;
						emitted = true;
						onEvent?.({ type: "text_delta", text: delta.text });
					} else if (delta?.type === "input_json_delta") {
						const entry = partialJson.get(event.index as number);
						if (entry) entry.json += delta.partial_json;
						emitted = true;
					}
					break;
				}
				case "content_block_stop": {
					const entry = partialJson.get(event.index as number);
					if (entry && entry.json.trim()) {
						try {
							entry.block.arguments = JSON.parse(entry.json);
						} catch {
							// 파싱 불가 인자는 빈 객체로 남는다 — 루프의 truncation 방어가 처리
						}
					}
					break;
				}
				case "message_delta": {
					stopReason = mapStopReason(event.delta?.stop_reason);
					captureUsage(usage, event.usage);
					break;
				}
				case "message_stop":
					sawStop = true;
					break;
				case "error":
					return {
						ok: false,
						error: `Stream error: ${event.error?.message ?? "unknown"}`,
						retryable: event.error?.type === "overloaded_error",
						emitted,
					};
			}
		}

		if (sawStart && !sawStop) {
			return { ok: false, error: "Stream truncated (no message_stop)", retryable: true, emitted };
		}
		return { ok: true, message: { role: "assistant", content, stopReason, usage } };
	} catch (err) {
		if (signal?.aborted) return { ok: false, error: "Request aborted", retryable: false, emitted };
		const status = (err as { status?: number }).status;
		const headers = (err as { headers?: Headers }).headers;
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			retryable: status === undefined || isRetryableStatus(status, headers),
			retryAfterMs: headers ? retryAfterFromHeaders(headers) : undefined,
			emitted,
		};
	}
}

// ---- SSE 파싱 ----------------------------------------------------------------

interface SseEvent {
	type: string;
	[key: string]: any;
}

async function* iterateSseEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		if (signal?.aborted) throw new Error("Request aborted");
		buffer += decoder.decode(chunk, { stream: true });
		let boundary: number;
		while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
			const raw = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
			const data = raw
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("");
			if (!data) continue;
			let parsed: SseEvent;
			try {
				parsed = JSON.parse(data);
			} catch {
				continue; // 손상된 이벤트는 건너뛴다 — 잘린 스트림은 message_stop 부재로 감지
			}
			yield parsed;
		}
	}
}

// ---- 메시지 변환 (내부 3-role → Anthropic API) --------------------------------

function convertMessages(messages: Message[]): Anthropic.MessageParam[] {
	const out: Anthropic.MessageParam[] = [];
	for (const msg of messages) {
		if (msg.role === "user") {
			out.push({ role: "user", content: msg.content });
		} else if (msg.role === "assistant") {
			const blocks: Anthropic.ContentBlockParam[] = msg.content.map((c) =>
				c.type === "text"
					? { type: "text", text: c.text }
					: { type: "tool_use", id: c.id, name: c.name, input: c.arguments },
			);
			if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
		} else {
			// toolResult → user role의 tool_result 블록. 연속된 결과는 하나의 user 메시지로 병합.
			const block: Anthropic.ToolResultBlockParam = {
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: msg.content,
				is_error: msg.isError,
			};
			const prev = out[out.length - 1];
			if (prev?.role === "user" && Array.isArray(prev.content) && prev.content[0]?.type === "tool_result") {
				(prev.content as Anthropic.ToolResultBlockParam[]).push(block);
			} else {
				out.push({ role: "user", content: [block] });
			}
		}
	}
	// 대화 히스토리 캐싱: 마지막 메시지에 cache_control
	const last = out[out.length - 1];
	if (last && Array.isArray(last.content)) {
		const lastBlock = last.content[last.content.length - 1];
		if (lastBlock && typeof lastBlock === "object") {
			(lastBlock as { cache_control?: unknown }).cache_control = { type: "ephemeral" };
		}
	} else if (last && typeof last.content === "string") {
		last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
	}
	return out;
}

// ---- 유틸 --------------------------------------------------------------------

function mapStopReason(reason: string | null | undefined): StopReason {
	switch (reason) {
		case "end_turn":
		case "stop_sequence":
		case "pause_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		default:
			return "stop";
	}
}

function captureUsage(usage: Usage, raw: Record<string, unknown> | null | undefined): void {
	if (!raw) return;
	if (typeof raw.input_tokens === "number") usage.input = raw.input_tokens;
	if (typeof raw.output_tokens === "number") usage.output = raw.output_tokens;
	if (typeof raw.cache_read_input_tokens === "number") usage.cacheRead = raw.cache_read_input_tokens;
	if (typeof raw.cache_creation_input_tokens === "number") usage.cacheWrite = raw.cache_creation_input_tokens;
}

function isRetryableStatus(status: number, headers?: Headers): boolean {
	const shouldRetry = headers?.get("x-should-retry");
	if (shouldRetry === "true") return true;
	if (shouldRetry === "false") return false;
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
	const ms = headers.get("retry-after-ms");
	if (ms) return Number.parseFloat(ms);
	const sec = headers.get("retry-after");
	if (sec) return Number.parseFloat(sec) * 1000;
	return undefined;
}

function retryDelayMs(attempt: number, retryAfterMs?: number): number {
	if (retryAfterMs !== undefined && retryAfterMs <= MAX_RETRY_DELAY_MS) return retryAfterMs;
	const base = Math.min(500 * 2 ** attempt, 8000);
	return base * (0.75 + Math.random() * 0.25);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done);
	});
}

function truncateError(text: string): string {
	return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function errorMessage(stopReason: "error" | "aborted", error: string): AssistantMessage {
	return { role: "assistant", content: [], stopReason, usage: emptyUsage(), errorMessage: error };
}
