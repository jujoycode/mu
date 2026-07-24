import { resolve } from "node:path";
import type { Tool, ToolResult } from "../types.ts";
import { MAX_BYTES, MAX_LINES, formatKb, truncateHead } from "./truncate.ts";

const ok = (content: string): ToolResult => ({ content, isError: false });
const err = (content: string): ToolResult => ({ content, isError: true });

export function createReadTool(cwd: string): Tool {
	return {
		name: "read",
		description:
			`Read the contents of a file. Output is truncated to ${MAX_LINES} lines or ${formatKb(MAX_BYTES)} ` +
			`(whichever is hit first). Use offset/limit for large files. When you need the full file, ` +
			`continue with offset until complete.`,
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to read (relative or absolute)" },
				offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
				limit: { type: "number", description: "Maximum number of lines to read" },
			},
			required: ["path"],
		},
		async execute(args): Promise<ToolResult> {
			const path = resolve(cwd, String(args.path ?? ""));
			const offset = args.offset === undefined ? 1 : Math.max(1, Number(args.offset));
			const limit = args.limit === undefined ? undefined : Math.max(1, Number(args.limit));

			const file = Bun.file(path);
			if (!(await file.exists())) return err(`File not found: ${path}`);

			const bytes = new Uint8Array(await file.arrayBuffer());
			if (bytes.subarray(0, 8192).includes(0)) {
				return err(`Cannot read binary file: ${path} (${formatKb(bytes.length)})`);
			}

			const allLines = new TextDecoder().decode(bytes).split("\n");
			if (offset > allLines.length) {
				return err(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
			}

			const window = allLines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit);
			const { text, shownLines, truncated } = truncateHead(window);

			if (shownLines === 0) {
				return err(
					`Line ${offset} is ${formatKb(Buffer.byteLength(window[0] ?? "", "utf-8"))}, exceeds ` +
						`${formatKb(MAX_BYTES)} limit. Use bash: sed -n '${offset}p' ${path} | head -c ${MAX_BYTES}`,
				);
			}

			const lastShown = offset - 1 + shownLines;
			let note = "";
			if (truncated) {
				note = `\n[Showing lines ${offset}-${lastShown} of ${allLines.length}. Use offset=${lastShown + 1} to continue.]`;
			} else if (limit !== undefined && lastShown < allLines.length) {
				note = `\n[${allLines.length - lastShown} more lines in file. Use offset=${lastShown + 1} to continue.]`;
			}
			return ok(text + note);
		},
	};
}
