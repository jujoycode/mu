// remote_exec (설계: docs/05) — 등록된 호스트 별칭에서 명령을 실행한다.
// 구현은 시스템 `ssh` 셸아웃: ProxyJump·agent forwarding 등을 ~/.ssh/config에서 공짜로 상속.
// 모델은 별칭만 본다 — 키/시크릿은 툴에 절대 들어오지 않는다.
// 환경(dev/staging/prod)별 권한은 게이트(gate.ts)가 판정한다; 이 툴은 실행만 담당.

import { spawn } from "node:child_process";
import type { HostRegistry } from "../remote/hosts.ts";
import type { Tool, ToolResult } from "../types.ts";
import { formatKb, MAX_BYTES, MAX_LINES, truncateTail } from "./truncate.ts";

const ROLLING_LIMIT = MAX_BYTES * 4;

export function createRemoteExecTool(hosts: HostRegistry): Tool {
	const known = hosts.list();
	const hostList =
		known.length > 0
			? known.map((h) => `${h.alias} (${h.env}) — ${h.purpose}`).join("; ")
			: "(none registered yet)";

	return {
		name: "remote_exec",
		description:
			`Run a shell command on a registered remote host over SSH. ` +
			`You reference hosts by alias only — authentication is handled locally. ` +
			`Available hosts: ${hostList}. ` +
			`Output is truncated to the last ${MAX_LINES} lines or ${formatKb(MAX_BYTES)}. ` +
			`Permission depends on the host environment: dev runs automatically, staging and prod require approval. ` +
			`Do not chain commands on prod based on prior remote output without a fresh request.`,
		inputSchema: {
			type: "object",
			properties: {
				host: { type: "string", description: "Registered host alias (see the list in this tool's description)" },
				command: { type: "string", description: "Shell command to run on the remote host" },
				timeout: { type: "number", description: "Timeout in seconds (optional)" },
			},
			required: ["host", "command"],
		},
		execute(args, signal): Promise<ToolResult> {
			const alias = String(args.host ?? "");
			const command = String(args.command ?? "");
			const timeoutSec = args.timeout === undefined ? undefined : Number(args.timeout);

			if (!alias) return Promise.resolve({ content: "Missing host alias", isError: true });
			if (!command) return Promise.resolve({ content: "Missing command", isError: true });
			if (timeoutSec !== undefined && (!Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
				return Promise.resolve({ content: "Invalid timeout: must be a finite number of seconds", isError: true });
			}

			const sshHost = hosts.sshHost(alias);
			if (!sshHost) {
				const aliases = known.map((h) => h.alias).join(", ") || "(none)";
				return Promise.resolve({
					content: `Unknown host alias '${alias}'. Registered aliases: ${aliases}`,
					isError: true,
				});
			}

			return new Promise((resolvePromise) => {
				// `--`로 옵션 파싱 종료 → sshHost가 플래그로 오인되지 않는다.
				// command는 단일 인자로 넘겨 원격 로그인 셸이 파싱하게 한다.
				const child = spawn("ssh", ["-o", "BatchMode=yes", "--", sshHost, command], {
					stdio: ["ignore", "pipe", "pipe"],
					env: process.env,
				});

				let buffer = "";
				let totalBytes = 0;
				const onData = (chunk: Buffer) => {
					totalBytes += chunk.length;
					buffer += chunk.toString("utf-8");
					if (buffer.length > ROLLING_LIMIT) buffer = buffer.slice(-ROLLING_LIMIT);
				};
				child.stdout.on("data", onData);
				child.stderr.on("data", onData);

				let timedOut = false;
				let aborted = false;
				const timer =
					timeoutSec !== undefined
						? setTimeout(() => {
								timedOut = true;
								child.kill("SIGKILL");
							}, timeoutSec * 1000)
						: undefined;
				const onAbort = () => {
					aborted = true;
					child.kill("SIGKILL");
				};
				signal?.addEventListener("abort", onAbort);

				const finish = (exitCode: number | null) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);

					const { text, totalLines, shownFrom, truncated } = truncateTail(buffer.replace(/\n$/, ""));
					let output = text.length > 0 ? text : "(no output)";
					if (truncated) output += `\n[Showing lines ${shownFrom}-${totalLines} of ${totalLines}]`;
					const where = `[${alias}]`;

					if (aborted) return resolvePromise({ content: `${output}\n\n${where} command aborted`, isError: true });
					if (timedOut) {
						return resolvePromise({ content: `${output}\n\n${where} timed out after ${timeoutSec}s`, isError: true });
					}
					if (exitCode !== 0 && exitCode !== null) {
						return resolvePromise({ content: `${output}\n\n${where} exited with code ${exitCode}`, isError: true });
					}
					resolvePromise({ content: output, isError: false });
				};

				child.on("error", (e) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					resolvePromise({ content: `Failed to run ssh: ${e.message}`, isError: true });
				});
				child.on("close", finish);
			});
		},
	};
}
