// 세션 저장 — messages 배열이 유일한 상태이므로, 저장은 그 배열의 선형 JSONL append다.
// (docs/06 결정 4: 매 메시지 한 줄 append → 크래시 시 진행분 보존, 전체 재직렬화 없음)
//
// 포맷: 첫 줄 = 헤더 {type:"session", version:1, ...}, 이후 한 줄 = 한 메시지.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "./types.ts";

const SESSION_VERSION = 1;

interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	cwd: string;
	model: string;
	timestamp: string;
}

export function sessionsRoot(): string {
	return process.env.MU_SESSION_DIR ?? join(homedir(), ".mu", "sessions");
}

function encodeCwd(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export class SessionStore {
	private constructor(
		readonly filePath: string,
		readonly messages: Message[],
	) {}

	// 새 세션 파일 생성
	static create(cwd: string, model: string): SessionStore {
		const dir = join(sessionsRoot(), encodeCwd(cwd));
		mkdirSync(dir, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const id = Math.random().toString(16).slice(2, 10);
		const filePath = join(dir, `${timestamp}_${id}.jsonl`);
		const header: SessionHeader = { type: "session", version: SESSION_VERSION, id, cwd, model, timestamp };
		appendFileSync(filePath, `${JSON.stringify(header)}\n`);
		return new SessionStore(filePath, []);
	}

	// 해당 cwd의 가장 최근 세션 로드 (없으면 undefined)
	static loadLatest(cwd: string): SessionStore | undefined {
		const dir = join(sessionsRoot(), encodeCwd(cwd));
		if (!existsSync(dir)) return undefined;
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort(); // 타임스탬프 prefix라 사전순 = 시간순
		const latest = files[files.length - 1];
		return latest ? SessionStore.load(join(dir, latest)) : undefined;
	}

	static load(filePath: string): SessionStore {
		const messages: Message[] = [];
		const lines = readFileSync(filePath, "utf-8").split("\n");
		for (const line of lines) {
			if (!line.trim()) continue;
			let entry: { type?: string; message?: Message };
			try {
				entry = JSON.parse(line);
			} catch {
				continue; // 크래시로 잘린 마지막 줄 등은 건너뛴다
			}
			if (entry.type === "message" && entry.message) messages.push(entry.message);
		}
		return new SessionStore(filePath, messages);
	}

	append(message: Message): void {
		this.messages.push(message);
		appendFileSync(this.filePath, `${JSON.stringify({ type: "message", message })}\n`);
	}
}
