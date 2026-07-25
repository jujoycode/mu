import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { AskApp } from "../src/components/permissions/PermissionRequest.tsx";
import type { AskRequest, AskResult } from "../src/components/permissions/PermissionRequest.tsx";

const req: AskRequest = { title: "bash 실행 요청", subtitle: "rm -rf ./build", pattern: "\\brm\\s+-[a-z]*r" };

// stdin.write 후 Ink가 입력을 처리할 틈을 준다
const tick = () => new Promise((r) => setTimeout(r, 20));

function renderAsk() {
	let result: AskResult | undefined;
	const app = render(
		createElement(AskApp, { request: req, onDone: (r: AskResult) => { result = r; } }),
	);
	return { app, get: () => result };
}

describe("AskApp", () => {
	test("제목·부제목·질문·옵션을 렌더한다", () => {
		const { app } = renderAsk();
		const out = app.lastFrame() ?? "";
		expect(out).toContain("bash 실행 요청");
		expect(out).toContain("rm -rf ./build");
		expect(out).toContain("계속할까요?");
		expect(out).toContain("예");
		expect(out).toContain("아니오");
		app.unmount();
	});

	test("⏎ 즉시 = 예(once)", async () => {
		const { app, get } = renderAsk();
		app.stdin.write("\r");
		await tick();
		expect(get()).toEqual({ decision: "once", feedback: undefined });
		app.unmount();
	});

	test("esc = 거부", async () => {
		const { app, get } = renderAsk();
		app.stdin.write("\x1b");
		await tick();
		expect(get()?.decision).toBe("deny");
		app.unmount();
	});

	test("↓ 한 번 → ⏎ = 세션 허용", async () => {
		const { app, get } = renderAsk();
		app.stdin.write("\x1b[B"); // down
		await tick();
		app.stdin.write("\r");
		await tick();
		expect(get()?.decision).toBe("session");
		app.unmount();
	});

	test("Tab으로 예를 피드백 입력으로 확장 → 타이핑 → ⏎", async () => {
		const { app, get } = renderAsk();
		app.stdin.write("\t"); // 예에서 tab → 입력 모드
		await tick();
		for (const ch of "먼저테스트") app.stdin.write(ch);
		await tick();
		app.stdin.write("\r");
		await tick();
		expect(get()).toEqual({ decision: "once", feedback: "먼저테스트" });
		app.unmount();
	});

	test("focusNo=true면 기본 포커스가 아니오 → ⏎ 즉시 거부", async () => {
		let result: AskResult | undefined;
		const app = render(
			createElement(AskApp, {
				request: { ...req, focusNo: true },
				onDone: (r: AskResult) => { result = r; },
			}),
		);
		app.stdin.write("\r");
		await tick();
		expect(result?.decision).toBe("deny");
		app.unmount();
	});
});
