import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Tool } from "../src/tools/types.js";

// The tools work relative to the current folder, so run them in a throwaway one.
const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-tools-")));
process.chdir(dir);
const { readFile } = await import("../src/tools/readFile.js");
const { writeFile } = await import("../src/tools/writeFile.js");
const { editFile } = await import("../src/tools/editFile.js");
const { listFiles } = await import("../src/tools/listFiles.js");
const { grep } = await import("../src/tools/grep.js");
const { bash } = await import("../src/tools/bash.js");

const run = (tool: Tool<any>, args: object, signal?: AbortSignal) => tool.execute(tool.schema.parse(args), { signal });
const put = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const get = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");

describe("read_file", () => {
  it("numbers lines and pages with offset and limit", async () => {
    put("a.txt", "one\ntwo\nthree\nfour");
    expect(await run(readFile, { path: "a.txt" })).toBe("    1  one\n    2  two\n    3  three\n    4  four");
    expect(await run(readFile, { path: "a.txt", offset: 2, limit: 2 })).toBe("    2  two\n    3  three\n[Showing lines 2-3 of 4]");
  });

  it("reports missing files and paths outside the project", async () => {
    await expect(run(readFile, { path: "nope.txt" })).rejects.toThrow("File not found");
    await expect(run(readFile, { path: "../outside.txt" })).rejects.toThrow("outside the project");
  });
});

describe("edit_file", () => {
  it("refuses to edit a file it hasn't read", async () => {
    put("unread.ts", "const a = 1;\n");
    await expect(run(editFile, { path: "unread.ts", old_str: "1", new_str: "2" })).rejects.toThrow("Read unread.ts with read_file");
  });

  it("replaces a unique match", async () => {
    put("e.ts", "const a = 1;\nconst b = 2;\n");
    await run(readFile, { path: "e.ts" });
    await run(editFile, { path: "e.ts", old_str: "const b = 2;", new_str: "const b = 3;" });
    expect(get("e.ts")).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("rejects ambiguous and missing matches, and replaces all when asked", async () => {
    put("dup.ts", "x();\nx();\n");
    await run(readFile, { path: "dup.ts" });
    await expect(run(editFile, { path: "dup.ts", old_str: "x();", new_str: "y();" })).rejects.toThrow("appears 2 times");
    await expect(run(editFile, { path: "dup.ts", old_str: "z();", new_str: "y();" })).rejects.toThrow("not found");
    expect(await run(editFile, { path: "dup.ts", old_str: "x();", new_str: "y();", replace_all: true })).toContain("2 replacements");
    expect(get("dup.ts")).toBe("y();\ny();\n");
  });

  it("keeps Windows line endings", async () => {
    put("crlf.ts", "line one\r\nline two\r\n");
    await run(readFile, { path: "crlf.ts" });
    await run(editFile, { path: "crlf.ts", old_str: "line one\nline two", new_str: "first\nsecond" });
    expect(get("crlf.ts")).toBe("first\r\nsecond\r\n");
  });

  it("refuses to overwrite changes made since the last read", async () => {
    put("stale.ts", "v1");
    await run(readFile, { path: "stale.ts" });
    put("stale.ts", "v2 from someone else");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, "stale.ts"), later, later);
    await expect(run(editFile, { path: "stale.ts", old_str: "v2", new_str: "v3" })).rejects.toThrow("changed since you last read it");
  });

  it("shows a diff preview without changing the file", async () => {
    put("p.ts", "old\n");
    const diff = await editFile.preview!(editFile.schema.parse({ path: "p.ts", old_str: "old", new_str: "new" }));
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
    expect(get("p.ts")).toBe("old\n");
  });
});

describe("write_file", () => {
  it("creates new files and folders without a read", async () => {
    await run(writeFile, { path: "deep/new/file.ts", content: "hi\n" });
    expect(get("deep/new/file.ts")).toBe("hi\n");
  });

  it("won't overwrite an existing file it hasn't read", async () => {
    put("exists.ts", "keep me");
    await expect(run(writeFile, { path: "exists.ts", content: "gone" })).rejects.toThrow("Read exists.ts");
    expect(get("exists.ts")).toBe("keep me");
  });
});

describe("list_files and grep", () => {
  it("skip node_modules", async () => {
    put("src/main.ts", "export function findMe() {}\n");
    put("node_modules/pkg/index.ts", "export function findMe() {}\n");
    expect(await run(listFiles, { pattern: "**/*.ts" })).not.toContain("node_modules");
    const hits = await run(grep, { pattern: "function findMe", glob: "**/*.ts" });
    expect(hits).toBe("src/main.ts:1: export function findMe() {}");
  });

  it("report bad regexes", async () => {
    await expect(run(grep, { pattern: "(" })).rejects.toThrow("Invalid regex");
  });
});

describe("bash", () => {
  it("returns output and exit codes", async () => {
    expect(await run(bash, { command: "echo hello" })).toBe("exit code: 0\nhello\n");
    expect(await run(bash, { command: "exit 3" })).toMatch(/^exit code: 3/);
  });

  it("stops when the signal fires", async () => {
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 300);
    expect(await run(bash, { command: "sleep 20" }, ac.signal)).toMatch(/^exit code: interrupted by user/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
