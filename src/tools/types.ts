import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type Risk = "read" | "write" | "exec";

export interface ToolContext {
  signal?: AbortSignal;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  risk: Risk;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<string>;
  preview?: (args: z.infer<S>) => Promise<string>;
}

export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

export class ToolError extends Error {}

export const ROOT = process.cwd();
export const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

// Blocks the agent from touching files outside your project.
export function resolvePath(p: string): string {
  const full = path.resolve(ROOT, p);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new ToolError(`${p} is outside the project folder.`);
  }
  return full;
}

// Keeps the start and end of huge outputs, cuts the middle.
export function truncate(text: string, max = 30000): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n[... ${text.length - max} characters cut ...]\n\n` + text.slice(-half);
}

// Remembers when each file was read, so the agent can't overwrite changes it never saw.
export const readTimes = new Map<string, number>();

export async function checkFresh(full: string, p: string) {
  const seen = readTimes.get(full);
  if (seen === undefined) throw new ToolError(`Read ${p} with read_file before changing it.`);
  const now = (await fs.stat(full)).mtimeMs;
  if (now !== seen) throw new ToolError(`${p} changed since you last read it. Read it again first.`);
}
