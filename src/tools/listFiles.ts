import fg from "fast-glob";
import { z } from "zod";
import { defineTool, ROOT, IGNORE } from "./types.js";

export const listFiles = defineTool({
  name: "list_files",
  description: "Find files by glob pattern, e.g. 'src/**/*.ts'. Ignores node_modules, .git and dist.",
  risk: "read",
  schema: z.object({
    pattern: z.string().default("**/*").describe("Glob pattern"),
  }),
  async execute({ pattern }) {
    const files = (await fg(pattern, { cwd: ROOT, ignore: IGNORE, dot: true, onlyFiles: true })).sort();
    if (!files.length) return "No files found.";
    const shown = files.slice(0, 300).join("\n");
    return files.length > 300 ? `${shown}\n[${files.length - 300} more not shown]` : shown;
  },
});
