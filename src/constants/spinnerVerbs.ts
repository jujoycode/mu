// 스피너 랜덤 멘트 (설계: docs/09 PART 2) — mu 오리지널 목록.
// 원칙: 禪·無·미니멀 유머 한 스푼, 한/영 혼용 (내부 팀 도구).
// 개인 추가는 ~/.mu/config.json: {"spinnerVerbs": {"mode": "append", "verbs": [...]}}

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SPINNER_VERBS = [
	// 禪 / 無
	"무위하는 중",
	"비우는 중",
	"공안을 곱씹는 중",
	"먹을 가는 중",
	"한 획을 긋는 중",
	"숨을 고르는 중",
	"참선하는 중",
	"덜어내는 중",
	// 사색
	"궁리하는 중",
	"헤아리는 중",
	"곱씹는 중",
	"되새기는 중",
	"가늠하는 중",
	"골몰하는 중",
	"음미하는 중",
	"묵상하는 중",
	// 부엌
	"뭉근히 끓이는 중",
	"숙성시키는 중",
	"간을 보는 중",
	"반죽을 치대는 중",
	"뜸을 들이는 중",
	"우려내는 중",
	"발효시키는 중",
	"고명을 얹는 중",
	// 작업장
	"벼리는 중",
	"깎아내는 중",
	"짜맞추는 중",
	"담금질하는 중",
	"결을 다듬는 중",
	"먹줄을 튕기는 중",
	"사포질하는 중",
	// 자연
	"움트는 중",
	"스며드는 중",
	"여물어가는 중",
	"물길을 트는 중",
	"바람을 읽는 중",
	"뿌리내리는 중",
	// 유희
	"어슬렁거리는 중",
	"꼼지락거리는 중",
	"두리번거리는 중",
	"딴청부리는 중 (농담)",
	"기지개를 켜는 중",
	// 영어 한 줌 (팀 인사이드 조크 자리)
	"Muing",
	"Subtracting",
	"Distilling",
	"Unasking",
	"Vibing",
] as const;

interface SpinnerVerbsConfig {
	mode?: "replace" | "append";
	verbs?: unknown[];
}

/** 기본 목록 + ~/.mu/config.json 병합 (replace | append). 깨진 설정은 조용히 기본값. */
export function getSpinnerVerbs(): string[] {
	const dir = process.env.MU_CONFIG_DIR ?? join(homedir(), ".mu");
	let config: SpinnerVerbsConfig | undefined;
	try {
		const parsed = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
			spinnerVerbs?: SpinnerVerbsConfig;
		};
		config = parsed.spinnerVerbs;
	} catch {
		// 설정 없음/깨짐 = 기본
	}
	const custom = (config?.verbs ?? []).filter((v): v is string => typeof v === "string");
	if (config?.mode === "replace" && custom.length > 0) return custom;
	return [...SPINNER_VERBS, ...custom];
}

export function pickVerb(verbs: string[] = getSpinnerVerbs()): string {
	return verbs[Math.floor(Math.random() * verbs.length)] ?? "생각하는 중";
}
