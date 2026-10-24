import { afterEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Agent } from "../src/loop.js";
import { App } from "../src/ui/App.js";
import { historyEntries } from "../src/ui/history.js";
import { fakeClient, type Reply } from "./fakeClient.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ui: ReturnType<typeof render> | undefined;
afterEach(() => ui?.unmount());

function start(replies: Reply[], intro = [] as any[]) {
  const { client } = fakeClient(replies, { delayMs: 20 });
  const agent = new Agent({ client, model: "fake-model", system: "test" });
  ui = render(<App agent={agent} model="fake-model" intro={intro} />);
  const frame = () => ui!.lastFrame() ?? "";
  return {
    agent,
    frame,
    async waitFor(text: string) {
      for (let i = 0; i < 100 && !frame().includes(text); i++) await wait(30);
      expect(frame()).toContain(text);
    },
    async type(s: string) {
      ui!.stdin.write(s);
      await wait(40);
    },
  };
}

describe("App", () => {
  it("shows the approval box and the result after a yes", async () => {
    const t = start([[{ tool: "bash", args: { command: "node -e \"console.log('approved-run')\"" } }], "Finished **ok**."]);
    await t.waitFor("Ask me");
    await t.type("say something");
    await t.type("\r");
    await t.waitFor("Allow bash");
    expect(t.frame()).toContain('always allow "node" commands');
    await t.type("y");
    await t.waitFor("Finished ok.");
    expect(t.frame()).toContain("⎿ exit code: 0, 1 lines of output");
  });

  it("shows a colored diff and handles a no", async () => {
    const t = start([[{ tool: "write_file", args: { path: "test/_never_written.ts", content: "export const a = 1;\n" } }], "Okay, I won't."]);
    await t.waitFor("Ask me");
    await t.type("make a file");
    await t.type("\r");
    await t.waitFor("Allow write_file");
    expect(t.frame()).toContain("+export const a = 1;");
    await t.type("n");
    await t.waitFor("Okay, I won't.");
    expect(t.frame()).toContain("Ask me");
  });

  it("renders Markdown and stops a streaming answer with Esc", async () => {
    const t = start(["## Title\n- **bold** item with `code`\n" + "and more words ".repeat(30)]);
    await t.waitFor("Ask me");
    await t.type("talk");
    await t.type("\r");
    await t.waitFor("and more");
    await t.type("\u001b");
    await t.waitFor("Interrupted.");
    expect(t.frame()).toContain("• bold item with code");
    expect(t.frame()).not.toContain("**");
  });

  it("handles /help and shows resumed history", async () => {
    const intro = historyEntries([
      { role: "system", content: "s" },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ]);
    const t = start([], intro);
    await t.waitFor("earlier answer");
    await t.type("/help");
    await t.type("\r");
    await t.waitFor("/compact summarizes");
  });
});
