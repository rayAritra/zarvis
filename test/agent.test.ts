import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent, type AgentEvents, type Answer } from "../src/loop.js";
import { defineTool } from "../src/tools/types.js";
import { bash } from "../src/tools/bash.js";
import { fakeClient, type Reply } from "./fakeClient.js";

function events(answer: Answer = "yes"): AgentEvents & { text: string } {
  const ev = {
    text: "",
    onText: (d: string) => void (ev.text += d),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onBlocked: vi.fn(),
    onCompact: vi.fn(),
    confirm: vi.fn(async () => answer),
  };
  return ev;
}

// Test tools that record what ran instead of touching the disk.
function testTools() {
  const ran: string[] = [];
  const look = defineTool({
    name: "look",
    description: "read something",
    risk: "read",
    schema: z.object({ what: z.string() }),
    execute: async ({ what }) => (ran.push(`look:${what}`), `saw ${what}`),
  });
  const change = defineTool({
    name: "change",
    description: "change something",
    risk: "write",
    schema: z.object({ what: z.string() }),
    execute: async ({ what }) => (ran.push(`change:${what}`), `changed ${what}`),
  });
  const wait = defineTool({
    name: "wait",
    description: "wait until stopped",
    risk: "read",
    schema: z.object({}),
    execute: (_args, { signal }) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve("stopped"))),
  });
  return { ran, tools: [look, change, wait, bash] };
}

function setup(replies: Reply[], opts: { delayMs?: number; contextTokens?: number; maxSteps?: number } = {}) {
  const { client, requests } = fakeClient(replies, { delayMs: opts.delayMs });
  const { ran, tools } = testTools();
  const agent = new Agent({ client, model: "fake", system: "SYSTEM", tools, contextTokens: opts.contextTokens, maxSteps: opts.maxSteps });
  return { agent, requests, ran };
}

// Every tool call in a request must be followed by a result, or real APIs reject it.
function expectValidHistory(messages: any[]) {
  const open = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool") open.delete(m.tool_call_id);
    else {
      expect([...open]).toEqual([]);
      for (const c of m.tool_calls ?? []) open.add(c.id);
    }
  }
  expect([...open]).toEqual([]);
}

describe("Agent", () => {
  it("runs tools and sends the results back until the model answers", async () => {
    const { agent, requests, ran } = setup([[{ tool: "look", args: { what: "a" } }, { tool: "look", args: { what: "b" } }], "All done."]);
    const ev = events();
    expect(await agent.run("go", ev)).toBe("All done.");
    expect(ran).toEqual(["look:a", "look:b"]);
    expect(ev.confirm).not.toHaveBeenCalled();
    expect(requests[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content)).toEqual(["saw a", "saw b"]);
    expect(ev.text).toBe("All done.");
  });

  it("asks before writes and respects a no", async () => {
    const { agent, requests, ran } = setup([[{ tool: "change", args: { what: "x" } }], "ok"]);
    const ev = events("no");
    await agent.run("go", ev);
    expect(ev.confirm).toHaveBeenCalledOnce();
    expect(ran).toEqual([]);
    expect(requests[1].messages.at(-1).content).toContain("The user denied this action");
  });

  it("stops asking after 'always'", async () => {
    const { agent, ran } = setup([[{ tool: "change", args: { what: "1" } }], [{ tool: "change", args: { what: "2" } }], "ok"]);
    const ev = events("always");
    await agent.run("go", ev);
    expect(ev.confirm).toHaveBeenCalledOnce();
    expect(ran).toEqual(["change:1", "change:2"]);
  });

  it("blocks dangerous commands without asking", async () => {
    const { agent, requests } = setup([[{ tool: "bash", args: { command: "sudo rm -rf /var" } }], "ok"]);
    const ev = events();
    await agent.run("go", ev);
    expect(ev.confirm).not.toHaveBeenCalled();
    expect(ev.onBlocked).toHaveBeenCalledWith("bash", "sudo is not allowed");
    expect(requests[1].messages.at(-1).content).toContain("blocked by the user's safety rules");
  });

  it("turns bad tool calls into errors the model can see", async () => {
    const { agent, requests } = setup([
      [
        { tool: "nope", args: {} },
        { tool: "look", args: "{not json" },
        { tool: "look", args: { wrong: 1 } },
      ],
      "ok",
    ]);
    await agent.run("go", events());
    const results = requests[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
    expect(results[0]).toBe('Error: unknown tool "nope".');
    expect(results[1]).toBe("Error: Arguments were not valid JSON.");
    expect(results[2]).toMatch(/^Error: Invalid arguments/);
  });

  it("stops after maxSteps", async () => {
    const loop: Reply = [{ tool: "look", args: { what: "again" } }];
    const { agent } = setup([loop, loop, loop, loop], { maxSteps: 3 });
    expect(await agent.run("go", events())).toBe("Stopped after 3 steps.");
  });

  it("can be interrupted while streaming, and keeps going afterwards", async () => {
    const { agent, requests } = setup(["one two three four five six seven eight", "second answer"], { delayMs: 30 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await agent.run("talk", events(), ac.signal);
    expect(agent.messages.at(-1)).toMatchObject({ role: "assistant" });
    expect(agent.messages.at(-1)!.content).toContain("[interrupted by the user]");
    expect(await agent.run("again", events())).toBe("second answer");
    expectValidHistory(requests[1].messages);
  });

  it("can be interrupted while a tool runs, and fills in every tool result", async () => {
    const { agent, requests } = setup([
      [
        { tool: "wait", args: {} },
        { tool: "look", args: { what: "never" } },
      ],
      "after",
    ]);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await agent.run("go", events(), ac.signal);
    await agent.run("next", events());
    const results = requests[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
    expect(results).toEqual(["stopped", "Interrupted by the user before this ran."]);
    expectValidHistory(requests[1].messages);
  });

  it("compacts older messages when the context fills up", async () => {
    const long = (tag: string) => `${tag} ` + "lorem ipsum ".repeat(250);
    const { agent, requests } = setup([long("answer1"), long("answer2"), "final"], { contextTokens: 2000 });
    const ev = events();
    await agent.run(long("question1"), ev);
    await agent.run(long("question2"), ev);
    await agent.run("question3", ev);
    expect(ev.onCompact).toHaveBeenCalled();
    const summaryRequest = requests.find((r) => !r.stream);
    expect(summaryRequest.messages[1].content).toContain("question1");
    const last = requests.at(-1);
    expect(last.messages[1].content).toMatch(/^\[Summary of the earlier conversation/);
    expect(JSON.stringify(last.messages)).not.toContain("question1");
    expect(last.messages.at(-1).content).toBe("question3");
  });

  it("reset and load keep a fresh system prompt", () => {
    const { agent } = setup([]);
    agent.load([{ role: "system", content: "OLD" }, { role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);
    expect(agent.messages.map((m) => m.content)).toEqual(["SYSTEM", "hi", "hello"]);
    agent.reset();
    expect(agent.messages).toHaveLength(1);
  });
});
