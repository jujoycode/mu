import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashTool } from "../src/tools/bash.ts";
import { createEditTool } from "../src/tools/edit.ts";
import { createReadTool } from "../src/tools/read.ts";
import { createWriteTool } from "../src/tools/write.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "mu-test-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("read", () => {
	test("reads a file with relative path", async () => {
		writeFileSync(join(dir, "a.txt"), "hello\nworld");
		const result = await createReadTool(dir).execute({ path: "a.txt" });
		expect(result.isError).toBe(false);
		expect(result.content).toBe("hello\nworld");
	});

	test("returns error string for missing file", async () => {
		const result = await createReadTool(dir).execute({ path: "nope.txt" });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("File not found");
	});

	test("offset beyond end of file", async () => {
		writeFileSync(join(dir, "a.txt"), "one\ntwo");
		const result = await createReadTool(dir).execute({ path: "a.txt", offset: 10 });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("beyond end of file");
	});

	test("truncates long files with continuation hint", async () => {
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`);
		writeFileSync(join(dir, "big.txt"), lines.join("\n"));
		const result = await createReadTool(dir).execute({ path: "big.txt" });
		expect(result.isError).toBe(false);
		expect(result.content).toContain("line 2000");
		expect(result.content).not.toContain("line 2001\n");
		expect(result.content).toContain("Use offset=2001 to continue");
	});

	test("offset/limit window", async () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		writeFileSync(join(dir, "a.txt"), lines.join("\n"));
		const result = await createReadTool(dir).execute({ path: "a.txt", offset: 10, limit: 2 });
		expect(result.content).toContain("line 10");
		expect(result.content).toContain("line 11");
		expect(result.content).toContain("Use offset=12 to continue");
	});

	test("rejects binary files", async () => {
		writeFileSync(join(dir, "bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
		const result = await createReadTool(dir).execute({ path: "bin" });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("binary");
	});
});

describe("write", () => {
	test("creates parent directories", async () => {
		const result = await createWriteTool(dir).execute({ path: "deep/nested/f.txt", content: "hi" });
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "deep/nested/f.txt"), "utf-8")).toBe("hi");
		expect(result.content).toContain("2 bytes");
	});
});

describe("edit", () => {
	test("exact replacement", async () => {
		writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: [{ oldText: "const y = 2;", newText: "const y = 3;" }],
		});
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "a.ts"), "utf-8")).toBe("const x = 1;\nconst y = 3;\n");
	});

	test("not found returns pi-style error", async () => {
		writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: [{ oldText: "const z = 9;", newText: "const z = 8;" }],
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain("must match exactly including all whitespace");
	});

	test("duplicate occurrences rejected", async () => {
		writeFileSync(join(dir, "a.ts"), "foo();\nfoo();\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: [{ oldText: "foo();", newText: "bar();" }],
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain("2 occurrences");
		expect(result.content).toContain("more context");
	});

	test("multiple edits matched against original, applied in order", async () => {
		writeFileSync(join(dir, "a.ts"), "alpha\nbeta\ngamma\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: [
				{ oldText: "gamma", newText: "GAMMA" },
				{ oldText: "alpha", newText: "ALPHA" },
			],
		});
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "a.ts"), "utf-8")).toBe("ALPHA\nbeta\nGAMMA\n");
	});

	test("overlapping edits rejected", async () => {
		writeFileSync(join(dir, "a.ts"), "one two three\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: [
				{ oldText: "one two", newText: "1 2" },
				{ oldText: "two three", newText: "2 3" },
			],
		});
		expect(result.isError).toBe(true);
		expect(result.content).toContain("overlap");
	});

	test("fuzzy match: smart quotes and trailing whitespace", async () => {
		writeFileSync(join(dir, "a.md"), "say “hello” now   \nbye\n");
		const result = await createEditTool(dir).execute({
			path: "a.md",
			edits: [{ oldText: 'say "hello" now', newText: 'say "hi" now' }],
		});
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "a.md"), "utf-8")).toContain('say "hi" now');
	});

	test("preserves CRLF line endings", async () => {
		writeFileSync(join(dir, "a.txt"), "one\r\ntwo\r\n");
		const result = await createEditTool(dir).execute({
			path: "a.txt",
			edits: [{ oldText: "two", newText: "TWO" }],
		});
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("one\r\nTWO\r\n");
	});

	test("legacy top-level oldText/newText shim", async () => {
		writeFileSync(join(dir, "a.ts"), "let a = 1;\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			oldText: "let a = 1;",
			newText: "let a = 2;",
		});
		expect(result.isError).toBe(false);
		expect(readFileSync(join(dir, "a.ts"), "utf-8")).toBe("let a = 2;\n");
	});

	test("edits as JSON string shim", async () => {
		writeFileSync(join(dir, "a.ts"), "let a = 1;\n");
		const result = await createEditTool(dir).execute({
			path: "a.ts",
			edits: JSON.stringify([{ oldText: "let a = 1;", newText: "let a = 2;" }]),
		});
		expect(result.isError).toBe(false);
	});
});

describe("bash", () => {
	test("returns stdout", async () => {
		const result = await createBashTool(dir).execute({ command: "echo hello" });
		expect(result.isError).toBe(false);
		expect(result.content).toBe("hello");
	});

	test("merges stderr and reports exit code as error", async () => {
		const result = await createBashTool(dir).execute({ command: "echo oops >&2; exit 3" });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("oops");
		expect(result.content).toContain("Command exited with code 3");
	});

	test("runs in the given cwd", async () => {
		writeFileSync(join(dir, "marker.txt"), "x");
		const result = await createBashTool(dir).execute({ command: "ls" });
		expect(result.content).toContain("marker.txt");
	});

	test("timeout kills the command", async () => {
		const start = Date.now();
		const result = await createBashTool(dir).execute({ command: "sleep 30", timeout: 1 });
		expect(Date.now() - start).toBeLessThan(5000);
		expect(result.isError).toBe(true);
		expect(result.content).toContain("timed out after 1 seconds");
	});

	test("no output placeholder", async () => {
		const result = await createBashTool(dir).execute({ command: "true" });
		expect(result.content).toBe("(no output)");
	});

	test("tail truncation keeps the end", async () => {
		const result = await createBashTool(dir).execute({ command: "seq 1 5000" });
		expect(result.isError).toBe(false);
		expect(result.content).toContain("5000");
		expect(result.content).not.toMatch(/^1\n/);
		expect(result.content).toContain("[Showing lines");
	});
});
