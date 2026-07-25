import type { Tool } from "../types.ts";
import { createBashTool } from "./bash.ts";
import { createEditTool } from "./edit.ts";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";

export function createCoreTools(cwd: string): Tool[] {
	return [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)];
}
