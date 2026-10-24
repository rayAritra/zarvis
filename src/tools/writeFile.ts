import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { defineTool, resolvePath, readTimes, checkFresh } from "./types.js";

export const writeFile = defineTool({
  name: "write_file",
  description: "Create a new file or fully overwrite one. Prefer edit_file for changing existing files.",
  risk: "write",
  schema: z.object({
    path: z.string().describe("Path relative to the project root"),
    content: z.string().describe("Full file contents"),
  }),
  async preview({ path, content }) {
    const old = await fs.readFile(resolvePath(path), "utf8").catch(() => "");
    return createTwoFilesPatch(path, path, old, content);
  },
  async execute({ path, content }) {
    const full = resolvePath(path);
    if (existsSync(full)) await checkFresh(full, path);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    readTimes.set(full, (await fs.stat(full)).mtimeMs);
    return `Wrote ${content.split("\n").length} lines to ${path}.`;
  },
});
