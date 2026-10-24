import { z } from "zod";
import type OpenAI from "openai";
import { ToolError, truncate, type Tool } from "./types.js";
import { readFile } from "./readFile.js";
import { listFiles } from "./listFiles.js";
import { grep } from "./grep.js";
import { bash } from "./bash.js";
import { writeFile } from "./writeFile.js";
import { editFile } from "./editFile.js";

export const tools: Tool<any>[] = [readFile, listFiles, grep, bash, writeFile, editFile];
const byName = new Map(tools.map((t) => [t.name, t]));

export const getTool = (name: string) => byName.get(name);

// Converts each zod schema into the JSON Schema format the model needs.
export const toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => {
  const { $schema, ...parameters } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  return { type: "function", function: { name: t.name, description: t.description, parameters } };
});

export function parseArgs(tool: Tool<any>, raw: string) {
  let json: unknown;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    throw new ToolError("Arguments were not valid JSON.");
  }
  const result = tool.schema.safeParse(json);
  if (!result.success) throw new ToolError(`Invalid arguments: ${result.error.message}`);
  return result.data;
}

export async function runTool(tool: Tool<any>, args: unknown): Promise<string> {
  try {
    return truncate(await tool.execute(args));
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
