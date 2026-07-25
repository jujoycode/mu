// 마스코트 정의 + 레지스트리 (설계: docs/09 PART 1)
// 순수 데이터 모듈 — 렌더러(Ink, P1 TUI)는 여기서 Mascot을 받아 그리기만 한다.
// 새 마스코트 추가 = MASCOTS에 항목 하나. 전환 = ~/.mu/config.json {"mascot":"dot"}

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MascotFrame = {
	pose: string;
	/** 세로 오프셋(행) — 점프 연출용. 렌더러가 marginTop으로 해석 */
	offset: number;
};

export type Mascot = {
	/** 레지스트리 키이자 config 값 */
	name: string;
	/** 모든 포즈가 공유하는 고정 크기 (모든 행은 width 칸, 포즈는 height 행) */
	width: number;
	height: number;
	/** "default" 포즈 필수. 행 문자열 배열 */
	poses: Record<string, string[]>;
	/** 프레임 시퀀스. 재생 간격은 렌더러 몫 (docs/09: 60ms) */
	animations: Record<string, MascotFrame[]>;
};

function hold(pose: string, offset: number, frames: number): MascotFrame[] {
	return Array.from({ length: frames }, () => ({ pose, offset }));
}

// ── 엔소(円相) — 기본 마스코트 ──────────────────────────────
// 열린 원(우상단 개구) 안에 μ 서명. void 포즈는 비움(無).
const enso: Mascot = {
	name: "enso",
	width: 5,
	height: 3,
	poses: {
		default: ["╭──╴ ", "│ μ ╷", "╰───╯"],
		blink: ["╭──╴ ", "│ ‿ ╷", "╰───╯"],
		void: ["╭──╴ ", "│   ╷", "╰───╯"],
		"stroke-1": ["     ", "     ", "╰───╯"],
		"stroke-2": ["     ", "│   ╷", "╰───╯"],
	},
	animations: {
		// 눈 깜빡임 수준의 idle 호흡
		blink: [...hold("default", 0, 25), ...hold("blink", 0, 2)],
		// 잠깐 비웠다가(無) 돌아온다
		breathe: [...hold("default", 0, 20), ...hold("void", 0, 4), ...hold("default", 0, 1)],
		// 웰컴: 한 획으로 원을 긋고 마지막에 μ가 찍힌다
		greet: [
			...hold("stroke-1", 0, 3),
			...hold("stroke-2", 0, 3),
			...hold("void", 0, 2),
			...hold("default", 0, 1),
		],
	},
};

// ── 점(点) — 극단적 미니멀 대안 ─────────────────────────────
const dot: Mascot = {
	name: "dot",
	width: 1,
	height: 1,
	poses: {
		default: ["·"],
		void: [" "],
	},
	animations: {
		breathe: [...hold("default", 0, 25), ...hold("void", 0, 3), ...hold("default", 0, 1)],
	},
};

export const MASCOTS: Record<string, Mascot> = { enso, dot };
export const DEFAULT_MASCOT = "enso";

/**
 * 마스코트 선택: 인자 > ~/.mu/config.json {"mascot": ...} > 기본(enso).
 * 알 수 없는 이름·깨진 설정은 조용히 기본값으로 (표시 레이어라 에러를 낼 이유 없음).
 */
export function getMascot(name?: string): Mascot {
	const wanted = name ?? readConfiguredMascotName();
	return (wanted && MASCOTS[wanted]) || MASCOTS[DEFAULT_MASCOT]!;
}

function readConfiguredMascotName(): string | undefined {
	const dir = process.env.MU_CONFIG_DIR ?? join(homedir(), ".mu");
	try {
		const parsed = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
			mascot?: unknown;
		};
		return typeof parsed.mascot === "string" ? parsed.mascot : undefined;
	} catch {
		return undefined;
	}
}
