// 스피너 (설계: docs/09 PART 2) — ✻ 계열 6프레임 왕복 + 랜덤 멘트 한 줄.
// REPL이 아직 readline 기반이라 Ink가 아닌 경량 ANSI 라인으로 구현한다
// (Ink 풀 REPL 전환 시 컴포넌트로 교체). 재생 80ms, 3초 경과부터 초 표시.

import { ansi } from "../utils/theme.ts";

const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];
export const SPINNER_FRAMES = [...GLYPHS, ...[...GLYPHS].reverse()];

const FRAME_MS = 80;
const SHOW_ELAPSED_AFTER_MS = 3_000;
const REDUCED_MOTION_CYCLE_MS = 2_000;

export interface SpinnerOptions {
	/** 한 턴 동안 고정될 멘트 */
	verb: string;
	stream?: NodeJS.WriteStream;
	/** 깜빡이는 점 하나로 대체 (접근성) */
	reducedMotion?: boolean;
}

export interface Spinner {
	start(): void;
	/** 라인을 지우고 멈춘다. 다른 출력 전에 반드시 호출 (idempotent) */
	stop(): void;
}

/** 프레임 문자열 생성 — 렌더와 분리된 순수 함수 (테스트 대상) */
export function spinnerLine(verb: string, elapsedMs: number, reducedMotion = false): string {
	const glyph = reducedMotion
		? Math.floor(elapsedMs / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 0
			? "●"
			: " "
		: (SPINNER_FRAMES[Math.floor(elapsedMs / FRAME_MS) % SPINNER_FRAMES.length] ?? "·");
	const elapsed =
		elapsedMs >= SHOW_ELAPSED_AFTER_MS ? ` (${Math.floor(elapsedMs / 1000)}s)` : "";
	return `${glyph} ${verb}…${elapsed}`;
}

export function createSpinner(options: SpinnerOptions): Spinner {
	const stream = options.stream ?? process.stdout;
	const enabled = stream.isTTY === true;
	let timer: ReturnType<typeof setInterval> | undefined;
	let startedAt = 0;

	const draw = () => {
		const line = spinnerLine(options.verb, Date.now() - startedAt, options.reducedMotion);
		stream.write(`\r\x1b[2K${ansi.dim(line)}`);
	};

	return {
		start() {
			if (!enabled || timer) return;
			startedAt = Date.now();
			draw();
			timer = setInterval(draw, options.reducedMotion ? 250 : FRAME_MS);
		},
		stop() {
			if (!timer) return;
			clearInterval(timer);
			timer = undefined;
			stream.write("\r\x1b[2K");
		},
	};
}
