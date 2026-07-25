import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MASCOT, getMascot, MASCOTS } from "../src/tui/mascot";

afterEach(() => {
	delete process.env.MU_CONFIG_DIR;
});

describe("registry", () => {
	test("기본은 enso", () => {
		expect(getMascot().name).toBe("enso");
		expect(DEFAULT_MASCOT).toBe("enso");
	});

	test("이름으로 다른 마스코트 선택", () => {
		expect(getMascot("dot").name).toBe("dot");
	});

	test("알 수 없는 이름은 기본값으로 폴백", () => {
		expect(getMascot("no-such-mascot").name).toBe("enso");
	});
});

describe("config.json 전환", () => {
	function withConfig(content: string): void {
		const dir = mkdtempSync(join(tmpdir(), "mu-mascot-"));
		writeFileSync(join(dir, "config.json"), content);
		process.env.MU_CONFIG_DIR = dir;
	}

	test('{"mascot":"dot"}이면 dot', () => {
		withConfig(JSON.stringify({ mascot: "dot" }));
		expect(getMascot().name).toBe("dot");
	});

	test("깨진 JSON은 조용히 기본값", () => {
		withConfig("{not json");
		expect(getMascot().name).toBe("enso");
	});

	test("mascot 필드가 없으면 기본값", () => {
		withConfig(JSON.stringify({ other: 1 }));
		expect(getMascot().name).toBe("enso");
	});

	test("config 없는 디렉토리도 기본값", () => {
		const dir = mkdtempSync(join(tmpdir(), "mu-mascot-empty-"));
		process.env.MU_CONFIG_DIR = dir;
		expect(getMascot().name).toBe("enso");
		rmSync(dir, { recursive: true, force: true });
	});

	test("명시적 인자가 config보다 우선", () => {
		withConfig(JSON.stringify({ mascot: "dot" }));
		expect(getMascot("enso").name).toBe("enso");
	});
});

describe("모든 마스코트의 기하학적 불변식", () => {
	for (const [name, m] of Object.entries(MASCOTS)) {
		test(`${name}: 레지스트리 키 = name`, () => {
			expect(m.name).toBe(name);
		});

		test(`${name}: default 포즈 존재`, () => {
			expect(m.poses.default).toBeDefined();
		});

		test(`${name}: 모든 포즈가 height×width 고정 크기`, () => {
			for (const [pose, rows] of Object.entries(m.poses)) {
				expect(rows.length).toBe(m.height);
				for (const row of rows) {
					// 코드포인트 기준 폭 (박스 문자·μ는 전부 1칸)
					expect([...row].length).toBe(m.width);
				}
			}
		});

		test(`${name}: 애니메이션 프레임은 존재하는 포즈만 참조`, () => {
			for (const frames of Object.values(m.animations)) {
				expect(frames.length).toBeGreaterThan(0);
				for (const f of frames) {
					expect(m.poses[f.pose]).toBeDefined();
					expect(f.offset).toBeGreaterThanOrEqual(0);
				}
			}
		});
	}
});
