import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRegistry, loadHosts } from "../src/remote/hosts.ts";

afterEach(() => {
	delete process.env.MU_CONFIG_DIR;
});

describe("HostRegistry", () => {
	const reg = new HostRegistry([
		{ alias: "api-dev", purpose: "dev server", env: "dev" },
		{ alias: "api-prod", purpose: "prod", env: "prod", ssh: "prod.example.internal" },
	]);

	test("별칭으로 조회", () => {
		expect(reg.get("api-dev")?.env).toBe("dev");
		expect(reg.get("nope")).toBeUndefined();
	});

	test("sshHost는 ssh 필드 우선, 없으면 alias", () => {
		expect(reg.sshHost("api-dev")).toBe("api-dev");
		expect(reg.sshHost("api-prod")).toBe("prod.example.internal");
		expect(reg.sshHost("nope")).toBeUndefined();
	});

	test("list / size", () => {
		expect(reg.size).toBe(2);
		expect(reg.list().map((h) => h.alias).sort()).toEqual(["api-dev", "api-prod"]);
	});
});

describe("loadHosts (파일 병합)", () => {
	function withHostsFile(content: string): void {
		const dir = mkdtempSync(join(tmpdir(), "mu-hosts-"));
		writeFileSync(join(dir, "hosts.json"), content);
		process.env.MU_CONFIG_DIR = dir;
	}

	test("사용자 hosts.json을 읽는다", () => {
		withHostsFile(JSON.stringify({ hosts: [{ alias: "my-box", purpose: "personal", env: "dev" }] }));
		const reg = loadHosts();
		expect(reg.get("my-box")?.env).toBe("dev");
	});

	test("유효하지 않은 항목은 걸러진다", () => {
		withHostsFile(
			JSON.stringify({
				hosts: [
					{ alias: "ok", purpose: "fine", env: "dev" },
					{ alias: "bad-env", purpose: "x", env: "production" }, // 잘못된 env
					{ purpose: "no-alias", env: "dev" }, // alias 없음
					"not an object",
				],
			}),
		);
		const reg = loadHosts();
		expect(reg.get("ok")).toBeDefined();
		expect(reg.get("bad-env")).toBeUndefined();
		expect(reg.size).toBe(1);
	});

	test("깨진 JSON은 조용히 빈 레지스트리", () => {
		withHostsFile("{not json");
		// 레포 기본 hosts.json은 빈 배열 → 전체 0
		expect(loadHosts().size).toBe(0);
	});

	test("파일 없으면 레포 기본값만 (빈 배열)", () => {
		const dir = mkdtempSync(join(tmpdir(), "mu-hosts-empty-"));
		process.env.MU_CONFIG_DIR = dir;
		expect(loadHosts().size).toBe(0);
	});
});
