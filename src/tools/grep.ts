import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { defineTool, ROOT, IGNORE, ToolError } from "./types.js";

export const grep = defineTool({
  name: "grep",
  description: "Search file contents with a regular expression. Returns file:line: text.",
  risk: "read",
  schema: z.object({
    pattern: z.string().describe("Regular expression to search for"),
    glob: z.string().default("**/*").describe("Which files to search, e.g. '**/*.ts'"),
  }),
  async execute({ pattern, glob }) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      throw new ToolError(`Invalid regex: ${(e as Error).message}`);
    }

    const files = await fg(glob, { cwd: ROOT, ignore: IGNORE, onlyFiles: true });
    const hits: string[] = [];
    for (const f of files) {
      const text = await fs.readFile(path.join(ROOT, f), "utf8").catch(() => "");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && hits.length < 200; i++) {
        if (re.test(lines[i])) hits.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
      if (hits.length >= 200) break;
    }
    return hits.length ? hits.join("\n") : "No matches.";
  },
});
