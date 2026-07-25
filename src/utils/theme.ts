// 색 토큰 (설계: docs/08 2.4) — 구조는 Claude Code 계층, 값은 mu 브랜딩.
// Ink 컴포넌트와 ANSI 직접 출력(스피너·웰컴)이 같은 토큰을 쓴다.

export const theme = {
	/** 승인 UI 보더·제목 (파랑 계열 관례 유지) */
	permission: "#5769f7",
	/** 포커스 행·포인터 — 당분간 permission과 동일 계열 */
	accent: "#5769f7",
	/** 확정 ✓ */
	success: "#2c7a39",
	/** description·비활성 */
	muted: "#666666",
	/** 보조 텍스트 */
	subtle: "#afafaf",
	/** 위험(거부 포커스, prod 경고) */
	danger: "#c44536",
} as const;

export type ThemeToken = keyof typeof theme;

// ANSI 직접 출력용 헬퍼 (Ink 밖: 스피너 한 줄, 웰컴 배너)
const ESC = "\x1b[";
export const ansi = {
	dim: (s: string) => `${ESC}2m${s}${ESC}0m`,
	bold: (s: string) => `${ESC}1m${s}${ESC}0m`,
	fg: (hex: string, s: string) => {
		const n = Number.parseInt(hex.slice(1), 16);
		// biome-ignore format: rgb 분해
		const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
		return `${ESC}38;2;${r};${g};${b}m${s}${ESC}0m`;
	},
};
