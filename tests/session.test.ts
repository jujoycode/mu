import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session.ts";
import type { Message } from "../src/types.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "mu-session-"));
	process.env.MU_SESSION_DIR = dir;
});
afterEach(() => {
	delete process.env.MU_SESSION_DIR;
	rmSync(dir, { recursive: true, force: true });
});

const user = (text: string): Message => ({ role: "user", content: text });

describe("SessionStore", () => {
	test("append and reload round-trip", () => {
		const store = SessionStore.create("/some/project", "test-model");
		store.append(user("hello"));
		store.append({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			stopReason: "stop",
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		});

		const loaded = SessionStore.load(store.filePath);
		expect(loaded.messages).toHaveLength(2);
		expect(loaded.messages[0]).toEqual(user("hello"));
		expect(loaded.messages[1]!.role).toBe("assistant");
	});

	test("loadLatest picks the most recent session for the cwd", async () => {
		const first = SessionStore.create("/proj", "m");
		first.append(user("old"));
		await Bun.sleep(5); // 타임스탬프 파일명 충돌 방지
		const second = SessionStore.create("/proj", "m");
		second.append(user("new"));

		const latest = SessionStore.loadLatest("/proj");
		expect(latest).toBeDefined();
		expect(latest!.messages[0]).toEqual(user("new"));
	});

	test("loadLatest returns undefined for unknown cwd", () => {
		expect(SessionStore.loadLatest("/nowhere")).toBeUndefined();
	});

	test("skips corrupted trailing line (crash safety)", () => {
		const store = SessionStore.create("/proj2", "m");
		store.append(user("ok"));
		appendFileSync(store.filePath, '{"type":"message","message":{"role":"user","cont'); // 잘린 줄
		const loaded = SessionStore.load(store.filePath);
		expect(loaded.messages).toHaveLength(1);
	});

	test("sessions from different cwds are isolated", () => {
		SessionStore.create("/proj-a", "m").append(user("a"));
		SessionStore.create("/proj-b", "m").append(user("b"));
		expect(SessionStore.loadLatest("/proj-a")!.messages[0]).toEqual(user("a"));
		expect(SessionStore.loadLatest("/proj-b")!.messages[0]).toEqual(user("b"));
	});
});
