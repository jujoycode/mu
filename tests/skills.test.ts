import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills, parseFrontmatter, SkillRegistry } from "../src/skills/registry.ts";
import { createLoadSkillTool } from "../src/tools/loadSkill.ts";
import { createSearchKnowledgeTool } from "../src/tools/searchKnowledge.ts";

const created: string[] = [];
afterEach(() => {
	delete process.env.MU_SKILLS_DIR;
	for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 팀 스킬 디렉토리를 만들고 MU_SKILLS_DIR로 가리킨다. skills: {name: {frontmatter, body}} */
function withSkills(skills: Record<string, { fm?: string; body: string; extra?: Record<string, string> }>): string {
	const root = mkdtempSync(join(tmpdir(), "mu-skills-"));
	created.push(root);
	for (const [dirName, s] of Object.entries(skills)) {
		const d = join(root, dirName);
		mkdirSync(d, { recursive: true });
		const fm = s.fm !== undefined ? `---\n${s.fm}\n---\n` : "";
		writeFileSync(join(d, "SKILL.md"), `${fm}${s.body}`);
		for (const [f, content] of Object.entries(s.extra ?? {})) writeFileSync(join(d, f), content);
	}
	process.env.MU_SKILLS_DIR = root;
	return root;
}

describe("parseFrontmatter", () => {
	test("name/summary/body 분리", () => {
		const r = parseFrontmatter("---\nname: deploy\nsummary: 배포 절차\n---\n본문 내용");
		expect(r.name).toBe("deploy");
		expect(r.summary).toBe("배포 절차");
		expect(r.body).toBe("본문 내용");
	});

	test("frontmatter 없으면 전체가 body", () => {
		const r = parseFrontmatter("그냥 본문");
		expect(r.name).toBeUndefined();
		expect(r.body).toBe("그냥 본문");
	});

	test("따옴표 값 처리", () => {
		expect(parseFrontmatter('---\nsummary: "따옴표 요약"\n---\nx').summary).toBe("따옴표 요약");
	});
});

describe("loadSkills / registry", () => {
	test("SKILL.md가 있는 폴더를 스킬로 인식", () => {
		withSkills({
			deploy: { fm: "name: deploy\nsummary: API 배포", body: "1. 빌드\n2. 푸시" },
			review: { fm: "name: review\nsummary: 코드 리뷰 체크리스트", body: "..." },
		});
		const reg = loadSkills("/nonexistent-cwd");
		expect(reg.size).toBe(2);
		expect(reg.get("deploy")?.summary).toBe("API 배포");
	});

	test("name 없으면 디렉토리명 사용", () => {
		withSkills({ mytool: { fm: "summary: 요약만", body: "x" } });
		expect(loadSkills("/none").get("mytool")?.name).toBe("mytool");
	});

	test("summaryBlock은 스킬당 한 줄 (lazy)", () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: 배포", body: "긴 본문".repeat(100) } });
		const block = loadSkills("/none").summaryBlock();
		expect(block).toContain("- deploy: 배포");
		expect(block).toContain("load_skill");
		expect(block).not.toContain("긴 본문"); // 본문은 상주하지 않음
	});

	test("스킬 없으면 summaryBlock은 빈 문자열", () => {
		const root = mkdtempSync(join(tmpdir(), "mu-skills-empty-"));
		created.push(root);
		process.env.MU_SKILLS_DIR = root;
		expect(loadSkills("/none").summaryBlock()).toBe("");
	});

	test("SKILL.md 없는 폴더는 무시", () => {
		const root = mkdtempSync(join(tmpdir(), "mu-skills-"));
		created.push(root);
		mkdirSync(join(root, "not-a-skill"));
		writeFileSync(join(root, "not-a-skill", "readme.txt"), "x");
		process.env.MU_SKILLS_DIR = root;
		expect(loadSkills("/none").size).toBe(0);
	});
});

describe("load_skill 툴", () => {
	test("본문을 반환한다", async () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: 배포", body: "실제 배포 절차 본문" } });
		const tool = createLoadSkillTool(loadSkills("/none"));
		const r = await tool.execute({ name: "deploy" });
		expect(r.isError).toBe(false);
		expect(r.content).toBe("실제 배포 절차 본문");
	});

	test("미등록 스킬 → 에러 + 사용 가능 목록", async () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: x", body: "y" } });
		const tool = createLoadSkillTool(loadSkills("/none"));
		const r = await tool.execute({ name: "ghost" });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("Unknown skill 'ghost'");
		expect(r.content).toContain("deploy");
	});

	test("설명에 사용 가능한 스킬 노출", () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: x", body: "y" } });
		expect(createLoadSkillTool(loadSkills("/none")).description).toContain("deploy");
	});
});

describe("search_knowledge 툴", () => {
	test("스킬 레포의 md/txt를 grep해 path:line: text 반환", async () => {
		withSkills({
			deploy: {
				fm: "name: deploy\nsummary: 배포",
				body: "카나리 배포는 10%부터 시작한다",
				extra: { "runbook.md": "롤백은 이전 태그로 되돌린다\nDB 마이그레이션 주의" },
			},
		});
		const tool = createSearchKnowledgeTool("/none");
		const r = await tool.execute({ pattern: "롤백" });
		expect(r.isError).toBe(false);
		expect(r.content).toContain("runbook.md");
		expect(r.content).toContain("롤백은 이전 태그");
	});

	test("매칭 없으면 안내 메시지", async () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: x", body: "내용" } });
		const r = await createSearchKnowledgeTool("/none").execute({ pattern: "존재하지않는패턴xyz" });
		expect(r.isError).toBe(false);
		expect(r.content).toContain("No matches");
	});

	test("잘못된 정규식 → 에러", async () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: x", body: "y" } });
		const r = await createSearchKnowledgeTool("/none").execute({ pattern: "[unclosed" });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("Invalid regular expression");
	});

	test("대소문자 무시", async () => {
		withSkills({ deploy: { fm: "name: deploy\nsummary: x", body: "DEPLOY to Production" } });
		const r = await createSearchKnowledgeTool("/none").execute({ pattern: "production" });
		expect(r.content).toContain("DEPLOY to Production");
	});
});

describe("SkillRegistry 직접", () => {
	test("list는 이름순 정렬", () => {
		const reg = new SkillRegistry([
			{ name: "zebra", summary: "z", dir: "/z", skillMdPath: "/z/SKILL.md" },
			{ name: "alpha", summary: "a", dir: "/a", skillMdPath: "/a/SKILL.md" },
		]);
		expect(reg.list().map((s) => s.name)).toEqual(["alpha", "zebra"]);
	});
});
