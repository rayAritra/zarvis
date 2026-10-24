import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../src/loop.js";
import { Session } from "../src/session.js";
import { runHeadless } from "../src/headless.js";
import { tools } from "../src/tools/index.js";
import { todoWrite } from "../src/tools/todo.js";
import { taskTool } from "../src/tools/task.js";
import { defineTool } from "../src/tools/types.js";
import { fakeClient } from "./fakeClient.js";

const quietEvents = () => ({
  onText() {},
  onToolCall: vi.fn(),
  onToolResult: vi.fn(),
  onToolProgress: vi.fn(),
  onBlocked: vi.fn(),
  confirm: vi.fn(async () => "yes" as const),
});

describe("todo_write", () => {
  it("formats the list and counts what's done", async () => {
    const out = await todoWrite.execute(
      todoWrite.schema.parse({
        todos: [
          { content: "Read the code", status: "completed" },
          { content: "Fix the bug", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
      {},
    );
    expect(out).toBe("Todo list updated (1/3 done):\n[x] Read the code\n[>] Fix the bug\n[ ] Run tests");
  });

  it("allows only one item in progress", async () => {
    const args = todoWrite.schema.parse({ todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] });
    await expect(todoWrite.execute(args, {})).rejects.toThrow("Only one item");
  });

  it("is one of the default tools", () => {
    expect(tools.map((t) => t.name)).toContain("todo_write");
  });
});

describe("task (subagents)", () => {
  it("runs a separate read-only agent and returns its report", async () => {
    // Request 1: the main agent starts a subagent. 2-3: the subagent works. 4: the main agent answers.
    const { client, requests } = fakeClient([
      [{ tool: "task", args: { description: "find the entry point", prompt: "Where does the CLI start?" } }],
      [
        { tool: "list_files", args: { pattern: "src/*.tsx" } },
        { tool: "write_file", args: { path: "x.ts", content: "nope" } },
      ],
      "The CLI starts in src/cli.tsx:1.",
      "Found it: src/cli.tsx.",
    ]);
    const agent = new Agent({ client, model: "fake", system: "MAIN", tools: [...tools, taskTool(client, "fake")] });
    const ev = quietEvents();

    expect(await agent.run("where does it start?", ev)).toBe("Found it: src/cli.tsx.");

    const subRequest = requests[1];
    expect(subRequest.messages[0].content).toContain("research subagent");
    expect(subRequest.messages.map((m: any) => m.content)).not.toContain("where does it start?");
    expect(subRequest.tools.map((t: any) => t.function.name)).toEqual(["read_file", "list_files", "grep", "bash"]);
    expect(requests[2].messages.filter((m: any) => m.role === "tool")[1].content).toBe('Error: unknown tool "write_file".');
    expect(ev.onToolProgress).toHaveBeenCalledWith("task", "list_files src/*.tsx");
    expect(ev.confirm).not.toHaveBeenCalled();
    expect(requests[3].messages.at(-1)).toMatchObject({ role: "tool", content: "The CLI starts in src/cli.tsx:1." });
  });
});

describe("headless mode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  function setup(yes: boolean) {
    const ran: string[] = [];
    const change = defineTool({
      name: "change",
      description: "change something",
      risk: "write",
      schema: z.object({}),
      execute: async () => (ran.push("change"), "changed"),
    });
    const { client } = fakeClient([[{ tool: "change", args: {} }], "All done."]);
    const agent = new Agent({ client, model: "fake", system: "s", tools: [change] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-headless-"));
    dirs.push(dir);
    const session = Session.create(process.cwd(), "fake", dir);
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s: any) => (out.push(String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s: any) => (err.push(String(s)), true));
    return { run: () => runHeadless(agent, "do it", { yes, session }), ran, out, err, dir };
  }

  it("prints the answer to stdout and refuses actions without --yes", async () => {
    const t = setup(false);
    expect(await t.run()).toBe(0);
    expect(t.ran).toEqual([]);
    expect(t.out.join("")).toBe("All done.\n");
    expect(t.err.join("")).toContain("change needs approval, so it was skipped");
    expect(fs.readdirSync(t.dir)).toHaveLength(1); // session saved
  });

  it("approves actions with --yes", async () => {
    const t = setup(true);
    expect(await t.run()).toBe(0);
    expect(t.ran).toEqual(["change"]);
  });
});
