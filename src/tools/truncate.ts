// 공통 truncation 정책: 2000줄 / 50KB 중 먼저 걸리는 쪽 (pi와 동일).

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

const byteLength = (s: string): number => Buffer.byteLength(s, "utf-8");

export function formatKb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)}KB`;
}

// head 유지 (read용): 앞에서부터 제한까지. 잘렸으면 어디까지 보여줬는지 반환.
export function truncateHead(lines: string[]): { text: string; shownLines: number; truncated: boolean } {
	const kept: string[] = [];
	let bytes = 0;
	for (const line of lines) {
		if (kept.length >= MAX_LINES) break;
		const lineBytes = byteLength(line) + 1;
		if (bytes + lineBytes > MAX_BYTES && kept.length > 0) break;
		kept.push(line);
		bytes += lineBytes;
	}
	return { text: kept.join("\n"), shownLines: kept.length, truncated: kept.length < lines.length };
}

// tail 유지 (bash용): 에러/최종 결과는 끝에 있으므로 마지막 N줄/바이트를 유지.
export function truncateTail(text: string): { text: string; totalLines: number; shownFrom: number; truncated: boolean } {
	const lines = text.split("\n");
	const kept: string[] = [];
	let bytes = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		if (kept.length >= MAX_LINES) break;
		const lineBytes = byteLength(line) + 1;
		if (bytes + lineBytes > MAX_BYTES) {
			// 마지막 줄 하나가 제한을 넘는 경우엔 부분 줄 허용
			if (kept.length === 0) kept.unshift(line.slice(-MAX_BYTES));
			break;
		}
		kept.unshift(line);
		bytes += lineBytes;
	}
	return {
		text: kept.join("\n"),
		totalLines: lines.length,
		shownFrom: lines.length - kept.length + 1,
		truncated: kept.length < lines.length,
	};
}
