// 호스트 레지스트리 (설계: docs/05). 모델은 별칭·용도·환경만 본다 —
// SSH 키/시크릿은 절대 여기 담지 않는다. 실제 인증은 로컬 ssh-agent + ~/.ssh/config.
//
// 포맷은 JSON (`hosts.json`) — policy.json·config.json과 일관, YAML 의존성 회피.
// 기본 = 레포의 hosts.json, 사용자 추가 = ~/.mu/hosts.json (별칭 기준 병합, 사용자 우선).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type HostEnv = "dev" | "staging" | "prod";

export interface Host {
	/** 모델이 참조하는 친숙한 별칭 */
	alias: string;
	/** 사람이 읽는 용도 설명 */
	purpose: string;
	/** 권한 레벨을 결정하는 환경 태그 */
	env: HostEnv;
	/**
	 * 실제 `ssh`에 넘길 호스트 (~/.ssh/config의 Host). 생략 시 alias를 그대로 사용.
	 * 별칭과 ssh 호스트를 분리하고 싶을 때만 설정한다.
	 */
	ssh?: string;
}

const VALID_ENVS: readonly HostEnv[] = ["dev", "staging", "prod"];

export class HostRegistry {
	private byAlias = new Map<string, Host>();

	constructor(hosts: Host[]) {
		for (const h of hosts) this.byAlias.set(h.alias, h);
	}

	get(alias: string): Host | undefined {
		return this.byAlias.get(alias);
	}

	list(): Host[] {
		return [...this.byAlias.values()];
	}

	get size(): number {
		return this.byAlias.size;
	}

	/** ssh에 넘길 실제 호스트 (ssh 필드 우선, 없으면 alias). */
	sshHost(alias: string): string | undefined {
		const h = this.byAlias.get(alias);
		return h ? (h.ssh ?? h.alias) : undefined;
	}
}

/** 레포 hosts.json + ~/.mu/hosts.json 병합 (사용자 항목이 같은 별칭을 덮어쓴다). */
export function loadHosts(): HostRegistry {
	const defaults = readHostsFile(new URL("../../hosts.json", import.meta.url).pathname);
	const userDir = process.env.MU_CONFIG_DIR ?? join(homedir(), ".mu");
	const user = readHostsFile(join(userDir, "hosts.json"));
	// 사용자 항목이 뒤에 오도록 병합 → HostRegistry가 같은 별칭을 덮어쓴다
	return new HostRegistry([...defaults, ...user]);
}

function readHostsFile(path: string): Host[] {
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { hosts?: unknown };
		if (!Array.isArray(parsed.hosts)) return [];
		return parsed.hosts.filter(isValidHost);
	} catch {
		// 깨진 파일은 조용히 무시 — 표시/정책 레이어라 크래시할 이유 없다
		return [];
	}
}

function isValidHost(v: unknown): v is Host {
	if (typeof v !== "object" || v === null) return false;
	const h = v as Record<string, unknown>;
	return (
		typeof h.alias === "string" &&
		h.alias.length > 0 &&
		typeof h.purpose === "string" &&
		typeof h.env === "string" &&
		VALID_ENVS.includes(h.env as HostEnv) &&
		(h.ssh === undefined || typeof h.ssh === "string")
	);
}
