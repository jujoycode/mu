import { describe, expect, test } from "bun:test";
import { MASCOTS } from "../src/components/LogoV2/mascot";
import { composeBanner } from "../src/components/LogoV2/Welcome";

// biome-ignore lint: 색 코드 제거해 내용만 검사
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const info = { model: "claude-sonnet-5", cwd: "/home/user/mu", sessionLine: "session: x" };

describe("composeBanner", () => {
	test("마스코트 아트와 정보 행을 나란히 배치", () => {
		const lines = composeBanner(MASCOTS.enso!, "default", info).map(strip);
		expect(lines.length).toBeGreaterThanOrEqual(3);
		expect(lines.join("\n")).toContain("μ"); // 엔소 서명
		expect(lines.join("\n")).toContain("claude-sonnet-5");
		expect(lines.join("\n")).toContain("/home/user/mu");
	});

	test("알 수 없는 포즈는 default로 폴백", () => {
		const a = composeBanner(MASCOTS.enso!, "no-such", info).map(strip);
		const b = composeBanner(MASCOTS.enso!, "default", info).map(strip);
		expect(a).toEqual(b);
	});

	test("점 마스코트처럼 짧아도 최소 3행(정보) 유지", () => {
		const lines = composeBanner(MASCOTS.dot!, "default", info);
		expect(lines.length).toBe(3);
	});
});
