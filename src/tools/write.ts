import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Tool, ToolResult } from "../types.ts";

export function createWriteTool(cwd: string): Tool {
	return {
		name: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
			"Automatically creates parent directories. Use write only for new files or complete rewrites; " +
			"prefer edit for modifying existing files.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to write (relative or absolute)" },
				content: { type: "string", description: "Content to write to the file" },
			},
			required: ["path", "content"],
		},
		async execute(args): Promise<ToolResult> {
			const path = resolve(cwd, String(args.path ?? ""));
			const content = String(args.content ?? "");
			try {
				await mkdir(dirname(path), { recursive: true });
				await Bun.write(path, content);
				return { content: `Successfully wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${path}`, isError: false };
			} catch (e) {
				return { content: `Could not write file: ${path}. ${e instanceof Error ? e.message : String(e)}`, isError: true };
			}
		},
	};
}
