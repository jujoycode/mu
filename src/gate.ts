// 권한 게이트 — allow / ask / deny 3레벨 (설계: docs/05).
// 코어 루프의 beforeToolCall 단일 지점에 꽂힌다. 정책은 코드가 아니라 설정 파일에 산다:
// 기본 정책 = 레포의 policy.json, 사용자 추가 = ~/.mu/policy.json (add-only 병합 —
// 사용자 파일로 기본 deny를 제거할 수는 없다).
// remote_exec는 정책 패턴이 아니라 호스트의 env 태그로 레벨을 정한다 (docs/05).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HostRegistry } from "./remote/hosts.ts";
import type { ToolCall } from "./types.ts";

export interface GatePolicy {
	bash?: { ask?: string[]; deny?: string[] };
}

export type AskDecision = "once" | "session" | "deny";

// Tab 인라인 피드백 (docs/08 2.3): 허용이면 툴 결과에 합쳐지고, 거부면 거부 사유에 실린다
export interface AskAnswer {
	decision: AskDecision;
	feedback?: string;
}

// 게이트가 UI에 넘기는 확인 요청 (docs/08). 문자열 파싱 없이 구조로 전달한다.
export interface ConfirmRequest {
	/** 다이얼로그 제목 — 예: "bash 실행 요청", "원격 실행 · api-prod [prod]" */
	title: string;
	/** 실행하려는 내용 (명령어) */
	detail: string;
	/** 세션 허용의 대상 키 / 매칭된 정책 패턴 */
	pattern: string;
	/** true면 기본 포커스를 '아니오'에 (prod 등 위험 대상) */
	focusNo?: boolean;
	/** false면 '세션 동안 묻지 않기' 옵션을 숨긴다 (prod = 매번 명시 승인) */
	allowSession?: boolean;
}

export interface GateOptions {
	policy: GatePolicy;
	// 비대화형(-p 원샷 등)에서는 ask = 자동 차단 (docs/07)
	interactive: boolean;
	confirm?: (req: ConfirmRequest) => Promise<AskDecision | AskAnswer>;
	auditPath?: string; // 기본 ~/.mu/audit.jsonl
	hosts?: HostRegistry; // remote_exec 판정용 호스트 레지스트리
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

export type GateVerdict = { allow: boolean; reason?: string; feedback?: string };

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

	// ask 판정을 사용자에게 묻고 결과를 정규화한다 (bash·remote 공용).
	const askUser = async (
		req: ConfirmRequest,
		auditBase: Record<string, unknown>,
		sessionKey: string | undefined,
	): Promise<GateVerdict> => {
		if (!options.interactive || !options.confirm) {
			audit({ ...auditBase, verdict: "ask", decision: "auto-deny (non-interactive)" });
			return {
				allow: false,
				reason: "Blocked: this command requires user approval, but mu is running non-interactively.",
			};
		}
		const answer = await options.confirm(req);
		const { decision, feedback } = typeof answer === "string" ? { decision: answer, feedback: undefined } : answer;
		audit({ ...auditBase, verdict: "ask", decision, ...(feedback ? { feedback } : {}) });
		if (decision === "deny") {
			return { allow: false, reason: `User declined to run this command.${feedback ? ` User feedback: ${feedback}` : ""}` };
		}
		// prod처럼 세션 캐시가 없는 경우 sessionKey=undefined
		if (decision === "session" && sessionKey) sessionAllowed.add(sessionKey);
		return { allow: true, feedback };
	};

	return async (toolCall: ToolCall): Promise<GateVerdict> => {
		if (toolCall.name === "bash") return judgeBash(toolCall);
		if (toolCall.name === "remote_exec") return judgeRemote(toolCall);
		return { allow: true };
	};

	async function judgeBash(toolCall: ToolCall): Promise<GateVerdict> {
		const command = String(toolCall.arguments.command ?? "");

		const denied = firstMatch(options.policy.bash?.deny, command);
		if (denied) {
			audit({ tool: "bash", command, verdict: "deny", pattern: denied });
			return { allow: false, reason: `Blocked by policy (pattern: ${denied}). This command is not allowed.` };
		}

		const asked = firstMatch(options.policy.bash?.ask, command);
		if (!asked) return { allow: true };
		if (sessionAllowed.has(asked)) return { allow: true };

		return askUser(
			{ title: "bash 실행 요청", detail: command, pattern: asked, allowSession: true },
			{ tool: "bash", command, pattern: asked },
			asked,
		);
	}

	async function judgeRemote(toolCall: ToolCall): Promise<GateVerdict> {
		const alias = String(toolCall.arguments.host ?? "");
		const command = String(toolCall.arguments.command ?? "");
		const host = options.hosts?.get(alias);

		if (!host) {
			const known = options.hosts?.list().map((h) => h.alias).join(", ") || "(none)";
			audit({ tool: "remote_exec", host: alias, command, verdict: "deny", reason: "unknown-host" });
			return { allow: false, reason: `Unknown host alias '${alias}'. Registered aliases: ${known}` };
		}

		const auditBase = { tool: "remote_exec", host: alias, env: host.env, command };

		// dev = 자동 실행
		if (host.env === "dev") {
			audit({ ...auditBase, verdict: "allow" });
			return { allow: true };
		}

		// staging = ask (세션 캐시 허용, 호스트별). prod = 매번 명시 승인 (캐시 없음).
		const isProd = host.env === "prod";
		const sessionKey = isProd ? undefined : `remote:${host.env}:${alias}`;
		if (sessionKey && sessionAllowed.has(sessionKey)) return { allow: true };

		return askUser(
			{
				title: `원격 실행 · ${alias} [${host.env}]`,
				detail: command,
				pattern: sessionKey ?? `remote:${host.env}`,
				focusNo: isProd,
				allowSession: !isProd,
			},
			auditBase,
			sessionKey,
		);
	}
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
