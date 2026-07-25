// exact → fuzzy 2단계 매칭 (pi edit-diff.ts 참조).
// 에러 메시지 문구는 모델의 자가수정을 유도하는 프롬프트이므로 pi 문구를 따른다.

import { resolve } from "node:path";
import type { Tool, ToolResult } from "../types.ts";

interface Edit {
	oldText: string;
	newText: string;
}

const ok = (content: string): ToolResult => ({ content, isError: false });
const err = (content: string): ToolResult => ({ content, isError: true });

export function createEditTool(cwd: string): Tool {
	return {
		name: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, " +
			"non-overlapping region of the original file. Each edit is matched against the original file, " +
			"not incrementally. If two changes affect the same block or nearby lines, merge them into one " +
			"edit instead of emitting overlapping edits.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
				edits: {
					type: "array",
					description:
						"One or more targeted replacements. Each oldText must be unique in the original file " +
						"and must not overlap with other edits.",
					items: {
						type: "object",
						properties: {
							oldText: {
								type: "string",
								description:
									"Exact text for one targeted replacement, including all whitespace and newlines. " +
									"Must be unique in the original file.",
							},
							newText: { type: "string", description: "Replacement text for this targeted edit." },
						},
						required: ["oldText", "newText"],
					},
				},
			},
			required: ["path", "edits"],
		},
		async execute(args): Promise<ToolResult> {
			const path = resolve(cwd, String(args.path ?? ""));
			const edits = normalizeEditsArg(args);
			if (!edits || edits.length === 0) return err("No edits provided.");

			const file = Bun.file(path);
			if (!(await file.exists())) return err(`Could not edit file: ${path}. File not found.`);
			const rawContent = await file.text();

			// BOM/EOL 정규화 — 편집은 LF 공간에서, 저장 시 원래 형태 복원
			const hasBom = rawContent.charCodeAt(0) === 0xfeff;
			const noBom = hasBom ? rawContent.slice(1) : rawContent;
			const usesCrlf = noBom.includes("\r\n");
			const content = noBom.replace(/\r\n/g, "\n");

			// 각 edit는 원본 기준으로 매칭 (순차 적용 아님)
			const matches: { start: number; end: number; newText: string; index: number }[] = [];
			for (let i = 0; i < edits.length; i++) {
				const edit = edits[i]!;
				const label = edits.length === 1 ? "the text" : `edits[${i}]`;
				if (edit.oldText.length === 0) {
					return err(edits.length === 1 ? `oldText must not be empty in ${path}.` : `edits[${i}].oldText must not be empty in ${path}.`);
				}
				const found = findText(content, edit.oldText.replace(/\r\n/g, "\n"));
				if (found.count === 0) {
					return err(
						`Could not find ${label} in ${path}. The old text must match exactly including all whitespace and newlines.`,
					);
				}
				if (found.count > 1) {
					return err(
						`Found ${found.count} occurrences of ${label} in ${path}. The text must be unique. ` +
							`Please provide more context to make it unique.`,
					);
				}
				matches.push({ start: found.start, end: found.end, newText: edit.newText.replace(/\r\n/g, "\n"), index: i });
			}

			// overlap 검사
			const sorted = [...matches].sort((a, b) => a.start - b.start);
			for (let i = 1; i < sorted.length; i++) {
				if (sorted[i]!.start < sorted[i - 1]!.end) {
					return err(
						`edits[${sorted[i - 1]!.index}] and edits[${sorted[i]!.index}] overlap in ${path}. ` +
							`Merge them into one edit or target disjoint regions.`,
					);
				}
			}

			// 역순 적용으로 오프셋 안정성 유지
			let result = content;
			for (const m of [...sorted].reverse()) {
				result = result.slice(0, m.start) + m.newText + result.slice(m.end);
			}
			if (result === content) {
				return err(
					`No changes made to ${path}. The replacement produced identical content. This might indicate ` +
						`an issue with special characters or the text not existing as expected.`,
				);
			}

			const restored = (hasBom ? "﻿" : "") + (usesCrlf ? result.replace(/\n/g, "\r\n") : result);
			await Bun.write(path, restored);
			return ok(`Successfully replaced ${edits.length} block(s) in ${path}.`);
		},
	};
}

// 모델 호환 shim: edits가 JSON 문자열로 오거나, 레거시 {oldText, newText} 최상위 형식 대응
function normalizeEditsArg(args: Record<string, unknown>): Edit[] | undefined {
	let edits = args.edits;
	if (typeof edits === "string") {
		try {
			edits = JSON.parse(edits);
		} catch {
			return undefined;
		}
	}
	if (Array.isArray(edits)) {
		const out: Edit[] = [];
		for (const e of edits) {
			if (typeof e?.oldText !== "string" || typeof e?.newText !== "string") return undefined;
			out.push({ oldText: e.oldText, newText: e.newText });
		}
		return out;
	}
	if (typeof args.oldText === "string" && typeof args.newText === "string") {
		return [{ oldText: args.oldText, newText: args.newText }];
	}
	return undefined;
}

// ---- 매칭 --------------------------------------------------------------------

function findText(content: string, oldText: string): { count: number; start: number; end: number } {
	// 1단계: exact
	const exact = countOccurrences(content, oldText);
	if (exact.count > 0) return exact;

	// 2단계: fuzzy — 줄 단위 정규화(trailing whitespace, 스마트 따옴표/대시, 특수 공백, NFKC)
	const contentLines = content.split("\n");
	const normContent = contentLines.map(normalizeLine);
	const normOld = oldText.split("\n").map(normalizeLine);

	let count = 0;
	let matchLine = -1;
	for (let i = 0; i + normOld.length <= normContent.length; i++) {
		let match = true;
		for (let j = 0; j < normOld.length; j++) {
			if (normContent[i + j] !== normOld[j]) {
				match = false;
				break;
			}
		}
		if (match) {
			count++;
			if (matchLine === -1) matchLine = i;
		}
	}
	if (count !== 1) return { count, start: -1, end: -1 };

	// 매칭된 줄 범위를 원본 오프셋으로 환산 (해당 줄 전체를 교체 대상으로)
	let start = 0;
	for (let i = 0; i < matchLine; i++) start += contentLines[i]!.length + 1;
	let end = start;
	for (let j = 0; j < normOld.length; j++) end += contentLines[matchLine + j]!.length + 1;
	end = Math.min(end - 1, content.length); // 마지막 줄바꿈 제외
	return { count: 1, start, end };
}

function countOccurrences(content: string, needle: string): { count: number; start: number; end: number } {
	let count = 0;
	let first = -1;
	let idx = content.indexOf(needle);
	while (idx !== -1) {
		if (first === -1) first = idx;
		count++;
		idx = content.indexOf(needle, idx + needle.length);
	}
	return { count, start: first, end: first === -1 ? -1 : first + needle.length };
}

function normalizeLine(line: string): string {
	return line
		.normalize("NFKC")
		.replace(/[‘’‛]/g, "'")
		.replace(/[“”‟]/g, '"')
		.replace(/[‐-―−]/g, "-")
		.replace(/[  -​  　]/g, " ")
		.trimEnd();
}
