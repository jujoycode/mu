// 스킬 시스템 (설계: docs/05) — 팀 git 레포의 폴더가 스킬 하나.
// 각 스킬 = SKILL.md(frontmatter: name/summary + 본문) + 선택적 스크립트.
//
// Lazy loading (pi의 lazy skills): 컨텍스트에는 스킬당 **요약 한 줄**만 상주하고
// (registry.summaryBlock), 본문은 load_skill 툴로 필요할 때만 로드한다.
//
// 탐색 위치: 프로젝트 `.mu/skills/` (cwd) + 팀 레포 `~/.mu/skills/`
// (MU_SKILLS_DIR로 오버라이드 가능). 같은 이름은 프로젝트 것이 우선.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Skill {
	/** 스킬 이름 (frontmatter name, 없으면 디렉토리명) */
	name: string;
	/** 한 줄 요약 — 이 줄만 상시 컨텍스트에 올라간다 */
	summary: string;
	/** 스킬 폴더 절대 경로 */
	dir: string;
	/** SKILL.md 절대 경로 */
	skillMdPath: string;
}

export interface Frontmatter {
	name?: string;
	summary?: string;
	body: string;
}

/** 최소 frontmatter 파서 — `---\nkey: value\n---\n본문`. YAML 의존성 없이 key: value 라인만. */
export function parseFrontmatter(content: string): Frontmatter {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { body: content };
	const [, fm, body] = match;
	const out: Frontmatter = { body: body ?? "" };
	for (const line of (fm ?? "").split(/\r?\n/)) {
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1];
		const value = (kv[2] ?? "").replace(/^["']|["']$/g, "").trim();
		if (key === "name") out.name = value;
		else if (key === "summary") out.summary = value;
	}
	return out;
}

export class SkillRegistry {
	private byName = new Map<string, Skill>();

	constructor(skills: Skill[]) {
		for (const s of skills) this.byName.set(s.name, s);
	}

	get(name: string): Skill | undefined {
		return this.byName.get(name);
	}

	list(): Skill[] {
		return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	get size(): number {
		return this.byName.size;
	}

	/** 시스템 프롬프트에 주입할 lazy 요약 블록 (스킬당 한 줄). 없으면 빈 문자열. */
	summaryBlock(): string {
		if (this.byName.size === 0) return "";
		const lines = this.list().map((s) => `- ${s.name}: ${s.summary}`);
		return `## Available skills\n\nLoad a skill with the load_skill tool when its summary matches the task.\n\n${lines.join("\n")}`;
	}
}

/** 스킬 본문 로드 (frontmatter 제외한 본문). 읽기 실패는 호출자가 처리. */
export function loadSkillBody(skill: Skill): string {
	const content = readFileSync(skill.skillMdPath, "utf8");
	return parseFrontmatter(content).body.trim();
}

/** 탐색 대상 디렉토리 목록 (존재 여부 무관). 프로젝트 우선, 그다음 팀 레포. */
export function skillDirs(cwd: string): string[] {
	const teamDir = process.env.MU_SKILLS_DIR ?? join(homedir(), ".mu", "skills");
	return [join(cwd, ".mu", "skills"), teamDir];
}

export function loadSkills(cwd: string): SkillRegistry {
	const skills: Skill[] = [];
	const seen = new Set<string>();
	// 프로젝트 → 팀 순서. 먼저 등록된 이름이 우선하도록 seen으로 가드.
	for (const base of skillDirs(cwd)) {
		if (!existsSync(base)) continue;
		let entries: string[];
		try {
			entries = readdirSync(base);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const dir = join(base, entry);
			const skillMdPath = join(dir, "SKILL.md");
			if (!isDir(dir) || !existsSync(skillMdPath)) continue;
			let fm: Frontmatter;
			try {
				fm = parseFrontmatter(readFileSync(skillMdPath, "utf8"));
			} catch {
				continue;
			}
			const name = fm.name || entry;
			if (seen.has(name)) continue; // 프로젝트 것이 이미 등록됨
			seen.add(name);
			skills.push({ name, summary: fm.summary || "(no summary)", dir, skillMdPath });
		}
	}
	return new SkillRegistry(skills);
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
