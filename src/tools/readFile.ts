import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, resolvePath, readTimes, ToolError } from "./types.js";

export const readFile = defineTool({
  name: "read_file",
  description: "Read a text file. Returns contents with line numbers. Use offset and limit for large files.",
  risk: "read",
  schema: z.object({
    path: z.string().describe("Path relative to the project root"),
    offset: z.number().int().min(1).optional().describe("First line to read (1-based)"),
    limit: z.number().int().min(1).optional().describe("Max lines to read, default 2000"),
  }),
  async execute({ path, offset = 1, limit = 2000 }) {
    const full = resolvePath(path);
    const raw = await fs.readFile(full, "utf8").catch(() => {
      throw new ToolError(`File not found: ${path}`);
    });
    readTimes.set(full, (await fs.stat(full)).mtimeMs);

    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    let out = slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join("\n");
    if (offset - 1 + slice.length < lines.length) {
      out += `\n[Showing lines ${offset}-${offset - 1 + slice.length} of ${lines.length}]`;
    }
    return out || "(empty file)";
  },
});
