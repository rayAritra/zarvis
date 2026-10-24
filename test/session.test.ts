import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { splitPoint } from "../src/compact.js";

const dirs: string[] = [];
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "zarvis-sessions-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const msgs = (text: string): any[] => [
  { role: "system", content: "s" },
  { role: "user", content: text },
];

describe("Session", () => {
  it("doesn't save a conversation with nothing in it", () => {
    const dir = tempDir();
    Session.create("/project", "m", dir).save([{ role: "system", content: "s" }]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("finds the latest session for the same folder only", async () => {
    const dir = tempDir();
    const old = Session.create("/project", "m", dir);
    old.save(msgs("old"));
    await new Promise((r) => setTimeout(r, 10));
    const newer = Session.create("/project", "m", dir);
    newer.save(msgs("newer"));
    Session.create("/other", "m", dir).save(msgs("other"));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");

    expect(Session.latest("/project", dir)?.data.id).toBe(newer.data.id);
    expect(Session.latest("/nowhere", dir)).toBeNull();
    expect(Session.load(old.data.id, dir).data.messages[1].content).toBe("old");
    expect(() => Session.load("missing", dir)).toThrow("No session called missing");
  });
});

describe("splitPoint", () => {
  const history: any[] = [
    { role: "system", content: "s" },
    { role: "user", content: "x".repeat(4000) },
    { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "bash", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", content: "y".repeat(4000) },
    { role: "assistant", content: "done" },
  ];

  it.each([10, 500, 1200, 5000])("never separates a tool result from its call (keep %i)", (keep) => {
    const i = splitPoint(history, keep);
    expect(i).toBeGreaterThanOrEqual(2);
    expect(history[i].role).not.toBe("tool");
  });

  it("returns -1 when there is nothing before the latest message", () => {
    expect(splitPoint(history.slice(0, 2), 10)).toBe(-1);
  });
});
