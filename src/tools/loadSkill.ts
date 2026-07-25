// load_skill (설계: docs/05) — 스킬 본문을 온디맨드로 로드한다.
// 컨텍스트에는 요약만 상주하고(registry.summaryBlock), 실제 절차·주의사항은
// 이 툴로 필요할 때만 불러온다. 컨텍스트 부풀림 방지가 목적.

import { loadSkillBody, type SkillRegistry } from "../skills/registry.ts";
import type { Tool, ToolResult } from "../types.ts";

export function createLoadSkillTool(skills: SkillRegistry): Tool {
	const names = skills.list().map((s) => s.name);
	const nameList = names.length > 0 ? names.join(", ") : "(none available)";

	return {
		name: "load_skill",
		description:
			`Load the full contents of a team skill by name. ` +
			`Skills are documented procedures, conventions, and runbooks; only their one-line summaries ` +
			`are kept in context, so load a skill before following it. Available skills: ${nameList}.`,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Skill name (see the summaries in the system prompt)" },
			},
			required: ["name"],
		},
		execute(args): Promise<ToolResult> {
			const name = String(args.name ?? "");
			if (!name) return Promise.resolve({ content: "Missing skill name", isError: true });

			const skill = skills.get(name);
			if (!skill) {
				return Promise.resolve({
					content: `Unknown skill '${name}'. Available skills: ${nameList}`,
					isError: true,
				});
			}
			try {
				const body = loadSkillBody(skill);
				return Promise.resolve({ content: body || "(skill body is empty)", isError: false });
			} catch (e) {
				return Promise.resolve({
					content: `Failed to read skill '${name}': ${e instanceof Error ? e.message : String(e)}`,
					isError: true,
				});
			}
		},
	};
}
