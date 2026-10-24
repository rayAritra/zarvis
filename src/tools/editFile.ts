import fs from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { defineTool, resolvePath, readTimes, checkFresh, ToolError } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path relative to the project root"),
  old_str: z.string().describe("Exact text to replace, including indentation"),
  new_str: z.string().describe("Text to put in its place"),
  replace_all: z.boolean().default(false).describe("Replace every occurrence"),
});

async function applyEdit({ path, old_str, new_str, replace_all }: z.infer<typeof schema>) {
  const raw = await fs.readFile(resolvePath(path), "utf8").catch(() => {
    throw new ToolError(`File not found: ${path}. Use write_file to create it.`);
  });
  const crlf = raw.includes("\r\n");
  const before = raw.replace(/\r\n/g, "\n");
  const oldS = old_str.replace(/\r\n/g, "\n");
  const newS = new_str.replace(/\r\n/g, "\n");

  if (!oldS) throw new ToolError("old_str is empty.");
  if (oldS === newS) throw new ToolError("old_str and new_str are identical.");

  const count = before.split(oldS).length - 1;
  if (count === 0) {
    throw new ToolError("old_str not found. It must match exactly, including whitespace. Read the file again and copy the text exactly.");
  }
  if (count > 1 && !replace_all) {
    throw new ToolError(`old_str appears ${count} times. Include more surrounding lines to make it unique, or set replace_all.`);
  }

  const after = replace_all ? before.split(oldS).join(newS) : before.replace(oldS, () => newS);
  return { before, after, crlf, count: replace_all ? count : 1 };
}

export const editFile = defineTool({
  name: "edit_file",
  description:
    "Replace an exact piece of text in a file. old_str must match exactly (including indentation) and be unique; include surrounding lines if needed. Always read the file first.",
  risk: "write",
  schema,
  async preview(args) {
    const { before, after } = await applyEdit(args);
    return createTwoFilesPatch(args.path, args.path, before, after);
  },
  async execute(args) {
    const full = resolvePath(args.path);
    await checkFresh(full, args.path);
    const { after, crlf, count } = await applyEdit(args);
    await fs.writeFile(full, crlf ? after.replace(/\n/g, "\r\n") : after, "utf8");
    readTimes.set(full, (await fs.stat(full)).mtimeMs);
    return `Edited ${args.path} (${count} replacement${count > 1 ? "s" : ""}).`;
  },
});
