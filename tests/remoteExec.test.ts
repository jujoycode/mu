import { describe, expect, test } from "bun:test";
import { HostRegistry } from "../src/remote/hosts.ts";
import { createRemoteExecTool } from "../src/tools/remoteExec.ts";

const hosts = new HostRegistry([{ alias: "api-dev", purpose: "dev", env: "dev" }]);
const tool = createRemoteExecTool(hosts);

describe("remote_exec 툴", () => {
	test("등록된 호스트를 설명에 노출한다 (모델이 별칭을 알 수 있게)", () => {
		expect(tool.description).toContain("api-dev");
		expect(tool.description).toContain("dev");
		expect(tool.name).toBe("remote_exec");
	});

	test("host 누락 → 에러 결과 (throw 아님)", async () => {
		const r = await tool.execute({ command: "ls" });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("host");
	});

	test("command 누락 → 에러 결과", async () => {
		const r = await tool.execute({ host: "api-dev" });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("command");
	});

	test("잘못된 timeout → 에러 결과", async () => {
		const r = await tool.execute({ host: "api-dev", command: "ls", timeout: -1 });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("timeout");
	});

	test("미등록 별칭 → 에러 결과 + 알려진 별칭 안내 (ssh 실행 안 함)", async () => {
		const r = await tool.execute({ host: "ghost", command: "ls" });
		expect(r.isError).toBe(true);
		expect(r.content).toContain("Unknown host alias 'ghost'");
		expect(r.content).toContain("api-dev");
	});

	test("툴 인터페이스 규약 (name/description/inputSchema/execute)", () => {
		expect(typeof tool.execute).toBe("function");
		expect(tool.inputSchema).toMatchObject({ type: "object" });
		expect((tool.inputSchema as { required: string[] }).required).toEqual(["host", "command"]);
	});
});
