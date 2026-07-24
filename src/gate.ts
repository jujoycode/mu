// 권한 게이트 — allow / ask / deny 3레벨 (설계: docs/05).
// 코어 루프의 beforeToolCall 단일 지점에 꽂힌다. 정책은 코드가 아니라 설정 파일에 산다:
// 기본 정책 = 레포의 policy.json, 사용자 추가 = ~/.mu/policy.json (add-only 병합 —
// 사용자 파일로 기본 deny를 제거할 수는 없다).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolCall } from "./types.ts";

export interface GatePolicy {
	bash?: { ask?: string[]; deny?: string[] };
}

export type AskDecision = "once" | "session" | "deny";

export interface GateOptions {
	policy: GatePolicy;
	// 비대화형(-p 원샷 등)에서는 ask = 자동 차단 (docs/07)
	interactive: boolean;
	confirm?: (summary: string, matchedPattern: string) => Promise<AskDecision>;
	auditPath?: string; // 기본 ~/.mu/audit.jsonl
}

export function loadPolicy(): GatePolicy {
	const defaults = readPolicyFile(new URL("../policy.json", import.meta.url).pathname);
	const user = readPolicyFile(join(homedir(), ".mu", "policy.json"));
	return {
		bash: {
			ask: [...(defaults.bash?.ask ?? []), ...(user.bash?.ask ?? [])],
			deny: [...(defaults.bash?.deny ?? []), ...(user.bash?.deny ?? [])],
		},
	};
}

function readPolicyFile(path: string): GatePolicy {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return {};
	}
}

export function createGate(options: GateOptions) {
	const sessionAllowed = new Set<string>();
	const auditPath = options.auditPath ?? join(homedir(), ".mu", "audit.jsonl");

	const audit = (entry: Record<string, unknown>) => {
		try {
			mkdirSync(dirname(auditPath), { recursive: true });
			appendFileSync(auditPath, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
		} catch {
			// 감사 로그 실패가 실행을 막지는 않는다
		}
	};

	return async (toolCall: ToolCall): Promise<{ allow: boolean; reason?: string }> => {
		if (toolCall.name !== "bash") return { allow: true }; // remote_exec 게이트는 P1 후반에 추가
		const command = String(toolCall.arguments.command ?? "");

		const denied = firstMatch(options.policy.bash?.deny, command);
		if (denied) {
			audit({ tool: "bash", command, verdict: "deny", pattern: denied });
			return { allow: false, reason: `Blocked by policy (pattern: ${denied}). This command is not allowed.` };
		}

		const asked = firstMatch(options.policy.bash?.ask, command);
		if (!asked) return { allow: true };
		if (sessionAllowed.has(asked)) return { allow: true };

		if (!options.interactive || !options.confirm) {
			audit({ tool: "bash", command, verdict: "ask", decision: "auto-deny (non-interactive)", pattern: asked });
			return {
				allow: false,
				reason: "Blocked: this command requires user approval, but mu is running non-interactively.",
			};
		}

		const decision = await options.confirm(`bash: ${command}`, asked);
		audit({ tool: "bash", command, verdict: "ask", decision, pattern: asked });
		if (decision === "deny") {
			return { allow: false, reason: "User declined to run this command." };
		}
		if (decision === "session") sessionAllowed.add(asked);
		return { allow: true };
	};
}

function firstMatch(patterns: string[] | undefined, command: string): string | undefined {
	for (const pattern of patterns ?? []) {
		try {
			if (new RegExp(pattern).test(command)) return pattern;
		} catch {
			// 잘못된 정규식은 무시
		}
	}
	return undefined;
}
