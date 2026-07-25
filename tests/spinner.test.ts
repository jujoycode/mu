import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPINNER_FRAMES, spinnerLine } from "../src/components/Spinner";
import { getSpinnerVerbs, pickVerb, SPINNER_VERBS } from "../src/constants/spinnerVerbs";

afterEach(() => {
	delete process.env.MU_CONFIG_DIR;
});

describe("spinnerLine", () => {
	test("멘트를 담고 프레임을 순환한다", () => {
		const a = spinnerLine("생각하는 중", 0);
		expect(a).toContain("생각하는 중…");
		expect(a.startsWith(SPINNER_FRAMES[0]!)).toBe(true);
	});

	test("3초 전엔 경과시간 없음, 이후 초 표시", () => {
		expect(spinnerLine("x", 2999)).not.toContain("s)");
		expect(spinnerLine("x", 3000)).toContain("(3s)");
		expect(spinnerLine("x", 12_500)).toContain("(12s)");
	});

	test("프레임이 시간에 따라 바뀐다(왕복)", () => {
		const frames = new Set<string>();
		for (let t = 0; t < 80 * SPINNER_FRAMES.length; t += 80) {
			frames.add(spinnerLine("x", t).split(" ")[0]!);
		}
		expect(frames.size).toBe(new Set(SPINNER_FRAMES).size);
	});

	test("reduced-motion은 점 하나로 깜빡인다", () => {
		expect(spinnerLine("x", 0, true).startsWith("●")).toBe(true);
		expect(spinnerLine("x", 1000, true).startsWith(" ")).toBe(true);
	});
});

describe("spinner verbs", () => {
	test("기본 목록은 비어있지 않고 pickVerb가 그 중 하나", () => {
		expect(SPINNER_VERBS.length).toBeGreaterThan(20);
		expect(getSpinnerVerbs()).toContain(pickVerb(SPINNER_VERBS as unknown as string[]));
	});

	function withConfig(content: string): void {
		const dir = mkdtempSync(join(tmpdir(), "mu-verbs-"));
		writeFileSync(join(dir, "config.json"), content);
		process.env.MU_CONFIG_DIR = dir;
	}

	test("append 모드는 기본 뒤에 사용자 멘트를 붙인다", () => {
		withConfig(JSON.stringify({ spinnerVerbs: { mode: "append", verbs: ["팀조크"] } }));
		const verbs = getSpinnerVerbs();
		expect(verbs).toContain("팀조크");
		expect(verbs.length).toBe(SPINNER_VERBS.length + 1);
	});

	test("replace 모드는 사용자 멘트만", () => {
		withConfig(JSON.stringify({ spinnerVerbs: { mode: "replace", verbs: ["오직이것"] } }));
		expect(getSpinnerVerbs()).toEqual(["오직이것"]);
	});

	test("replace인데 빈 목록이면 기본 유지", () => {
		withConfig(JSON.stringify({ spinnerVerbs: { mode: "replace", verbs: [] } }));
		expect(getSpinnerVerbs().length).toBe(SPINNER_VERBS.length);
	});

	test("깨진 설정은 조용히 기본값", () => {
		withConfig("{nope");
		expect(getSpinnerVerbs().length).toBe(SPINNER_VERBS.length);
	});
});
