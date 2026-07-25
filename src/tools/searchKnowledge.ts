// search_knowledge (설계: docs/05) — 스킬 레포의 런북·문서를 grep으로 검색한다.
// 팀 지식(스킬 폴더 안의 .md/.txt)을 정규식으로 훑어 매칭 라인을 반환.
// 외부 grep 의존 없이 JS로 순회 (이식성 + 테스트 용이).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { skillDirs } from "../skills/registry.ts";
import type { Tool, ToolResult } from "../types.ts";

const TEXT_EXT = new Set([".md", ".txt", ".mdx"]);
const MAX_RESULTS = 50;
const MAX_FILE_BYTES = 512 * 1024;

export function createSearchKnowledgeTool(cwd: string): Tool {
	const dirs = skillDirs(cwd);

	return {
		name: "search_knowledge",
		description:
			`Search the team's skill and knowledge repository (runbooks, architecture notes, conventions) ` +
			`by regular expression. Returns matching lines as path:line: text (up to ${MAX_RESULTS} matches). ` +
			`Use this to find documented context before acting.`,
		inputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Regular expression to search for (case-insensitive)" },
			},
			required: ["pattern"],
		},
		execute(args): Promise<ToolResult> {
			const pattern = String(args.pattern ?? "");
			if (!pattern) return Promise.resolve({ content: "Missing search pattern", isError: true });

			let re: RegExp;
			try {
				re = new RegExp(pattern, "i");
			} catch (e) {
				return Promise.resolve({
					content: `Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`,
					isError: true,
				});
			}

			const results: string[] = [];
			let truncated = false;
			outer: for (const base of dirs) {
				for (const file of walk(base)) {
					const rel = relative(base, file);
					let content: string;
					try {
						if (statSync(file).size > MAX_FILE_BYTES) continue;
						content = readFileSync(file, "utf8");
					} catch {
						continue;
					}
					const lines = content.split(/\r?\n/);
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i] ?? "";
						if (re.test(line)) {
							results.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
							if (results.length >= MAX_RESULTS) {
								truncated = true;
								break outer;
							}
						}
					}
				}
			}

			if (results.length === 0) {
				return Promise.resolve({ content: `No matches for /${pattern}/i in the knowledge repository.`, isError: false });
			}
			let output = results.join("\n");
			if (truncated) output += `\n[Stopped at ${MAX_RESULTS} matches — refine the pattern for more]`;
			return Promise.resolve({ content: output, isError: false });
		},
	};
}

/** 텍스트 파일 절대 경로를 순회 (재귀). 존재하지 않는 base는 건너뛴다. */
function* walk(base: string): Generator<string> {
	let entries: string[];
	try {
		entries = readdirSync(base);
	} catch {
		return; // 없거나 접근 불가
	}
	for (const entry of entries) {
		if (entry.startsWith(".")) continue; // .git 등 스킵
		const path = join(base, entry);
		let s: ReturnType<typeof statSync>;
		try {
			s = statSync(path);
		} catch {
			continue;
		}
		if (s.isDirectory()) {
			yield* walk(path);
		} else if (TEXT_EXT.has(extname(entry))) {
			yield path;
		}
	}
}

function extname(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot);
}
