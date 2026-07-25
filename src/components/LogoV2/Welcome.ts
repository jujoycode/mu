// 웰컴 배너 (설계: docs/09 PART 1) — 마스코트 + 세션 정보.
// greet 애니메이션(붓획으로 원을 긋고 μ가 찍힌다)은 TTY에서만, 반 초 남짓.
// 비대화형·reduced-motion에선 정적 1프레임.

import { getMascot, type Mascot } from "./mascot.ts";
import { ansi, theme } from "../../utils/theme.ts";

export interface WelcomeInfo {
	model: string;
	cwd: string;
	sessionLine: string;
}

/** 마스코트 행 + 우측 정보 행을 나란히 조립 (순수 함수 — 테스트 대상) */
export function composeBanner(mascot: Mascot, pose: string, info: WelcomeInfo): string[] {
	const art = mascot.poses[pose] ?? mascot.poses.default ?? [];
	const rows = Math.max(art.length, 3);
	const infoLines = [
		`${ansi.bold("mu")} ${ansi.dim(`· ${info.model}`)}`,
		ansi.dim(info.cwd),
		ansi.dim(info.sessionLine),
	];
	const lines: string[] = [];
	for (let i = 0; i < rows; i++) {
		const artRow = art[i] ?? " ".repeat(mascot.width);
		lines.push(` ${ansi.fg(theme.subtle, artRow)}  ${infoLines[i] ?? ""}`);
	}
	return lines;
}

const FRAME_MS = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function printWelcome(info: WelcomeInfo): Promise<void> {
	const mascot = getMascot();
	const animate =
		process.stdout.isTTY === true && !process.env.MU_NO_MOTION && !process.env.CI;
	const greet = mascot.animations.greet;

	if (animate && greet && greet.length > 0) {
		let printed = 0;
		for (const frame of greet) {
			const lines = composeBanner(mascot, frame.pose, info);
			if (printed > 0) process.stdout.write(`\x1b[${printed}A`); // 커서 위로 — 제자리 재렌더
			for (const line of lines) process.stdout.write(`\x1b[2K${line}\n`);
			printed = lines.length;
			await sleep(FRAME_MS);
		}
		// 마지막 프레임 = default 포즈가 이미 그려져 있다
		return;
	}

	for (const line of composeBanner(mascot, "default", info)) console.log(line);
}
