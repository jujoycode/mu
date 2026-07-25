import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolResult } from "../types.ts";
import { MAX_BYTES, MAX_LINES, formatKb, truncateTail } from "./truncate.ts";

// 메모리 상한: 이 이상은 temp 파일로 흘리고 tail만 유지
const ROLLING_LIMIT = MAX_BYTES * 4;

export function createBashTool(cwd: string): Tool {
	return {
		name: "bash",
		description:
			`Execute a bash command in the current working directory. Returns stdout and stderr. ` +
			`Output is truncated to last ${MAX_LINES} lines or ${formatKb(MAX_BYTES)} (whichever is hit first). ` +
			`If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. ` +
			`Use bash for ls, grep, find, git, running tests, etc.`,
		inputSchema: {
			type: "object",
			properties: {
				command: { type: "string", description: "Bash command to execute" },
				timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
			},
			required: ["command"],
		},
		execute(args, signal): Promise<ToolResult> {
			const command = String(args.command ?? "");
			const timeoutSec = args.timeout === undefined ? undefined : Number(args.timeout);
			if (timeoutSec !== undefined && (!Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
				return Promise.resolve({ content: "Invalid timeout: must be a finite number of seconds", isError: true });
			}

			return new Promise((resolvePromise) => {
				const child = spawn("bash", ["-c", command], {
					cwd,
					detached: process.platform !== "win32", // 프로세스 트리 kill용
					stdio: ["ignore", "pipe", "pipe"],
					env: process.env,
				});

				let buffer = "";
				let overflowFile: string | undefined;
				let totalBytes = 0;
				const onData = (chunk: Buffer) => {
					const text = chunk.toString("utf-8");
					totalBytes += chunk.length;
					buffer += text;
					if (buffer.length > ROLLING_LIMIT) {
						// 전체 출력은 temp 파일에 보존, 메모리에는 tail만 유지
						if (!overflowFile) {
							overflowFile = join(tmpdir(), `mu-bash-${Math.random().toString(16).slice(2, 10)}.log`);
							appendFileSync(overflowFile, buffer);
						} else {
							appendFileSync(overflowFile, text);
						}
						buffer = buffer.slice(-ROLLING_LIMIT / 2);
					} else if (overflowFile) {
						appendFileSync(overflowFile, text);
					}
				};
				child.stdout.on("data", onData);
				child.stderr.on("data", onData);

				let timedOut = false;
				let aborted = false;
				const timer =
					timeoutSec !== undefined
						? setTimeout(() => {
								timedOut = true;
								killTree(child.pid);
							}, timeoutSec * 1000)
						: undefined;
				const onAbort = () => {
					aborted = true;
					killTree(child.pid);
				};
				signal?.addEventListener("abort", onAbort);

				const finish = (exitCode: number | null) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);

					const { text, totalLines, shownFrom, truncated } = truncateTail(buffer.replace(/\n$/, ""));
					let output = text.length > 0 ? text : "(no output)";
					if (truncated || overflowFile) {
						output += `\n[Showing lines ${shownFrom}-${totalLines} of ${totalLines}${overflowFile ? `. Full output: ${overflowFile}` : ""}]`;
					}

					if (aborted) return resolvePromise({ content: `${output}\n\nCommand aborted`, isError: true });
					if (timedOut) {
						return resolvePromise({ content: `${output}\n\nCommand timed out after ${timeoutSec} seconds`, isError: true });
					}
					if (exitCode !== 0 && exitCode !== null) {
						return resolvePromise({ content: `${output}\n\nCommand exited with code ${exitCode}`, isError: true });
					}
					resolvePromise({ content: output, isError: false });
				};

				child.on("error", (e) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					resolvePromise({ content: `Failed to spawn command: ${e.message}`, isError: true });
				});
				child.on("close", finish);
			});
		},
	};
}

function killTree(pid: number | undefined): void {
	if (pid === undefined) return;
	try {
		if (process.platform === "win32") {
			process.kill(pid, "SIGKILL");
		} else {
			process.kill(-pid, "SIGKILL"); // detached 그룹 전체
		}
	} catch {
		// 이미 종료됨
	}
}
