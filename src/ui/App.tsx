import { useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { Agent, AgentEvents, Answer, ApprovalRequest } from "../loop.js";
import { ApprovalBox, EntryView, Markdown, type Entry } from "./parts.js";

interface Pending {
  req: ApprovalRequest;
  resolve: (a: Answer) => void;
}

type Item = Entry & { id: number };

export function App({ agent, model, intro = [] }: { agent: Agent; model: string; intro?: Entry[] }) {
  const { exit } = useApp();
  const nextId = useRef(0);
  const withId = (e: Entry): Item => ({ ...e, id: nextId.current++ });

  const [items, setItems] = useState<Item[]>(() => [
    withId({ kind: "info", text: `my-agent · ${model} · ${process.cwd()}` }),
    withId({ kind: "info", text: "Enter to send · Esc or Ctrl+C stops a task · Ctrl+C at the prompt quits · /help" }),
    ...intro.map(withId),
  ]);
  const [live, setLive] = useState("");
  const liveRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const turn = useRef<AbortController | null>(null);

  const add = (e: Entry) => setItems((prev) => [...prev, withId(e)]);

  // Moves the streamed text into the permanent log.
  const flush = () => {
    const text = liveRef.current.trim();
    if (text) add({ kind: "assistant", text });
    liveRef.current = "";
    setLive("");
  };

  const events: AgentEvents = {
    onText(delta) {
      liveRef.current += delta;
      setLive(liveRef.current);
    },
    onToolCall(name, args) {
      flush();
      add({ kind: "tool", name, args });
    },
    onToolResult: (name, text) => add({ kind: "result", name, text }),
    onBlocked: (_name, text) => add({ kind: "blocked", text }),
    confirm(req, signal) {
      if (req.preview) add({ kind: "diff", text: req.preview });
      return new Promise((resolve) => {
        const done = (a: Answer) => {
          setPending(null);
          resolve(a);
        };
        signal?.addEventListener("abort", () => done("no"), { once: true });
        setPending({ req, resolve: done });
      });
    },
  };

  async function submit(value: string) {
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text === "exit" || text === "/exit") return exit();
    if (text === "/help") {
      add({ kind: "info", text: "Commands: /clear starts a new conversation, /exit quits. Anything else is sent to the agent." });
      return;
    }
    if (text === "/clear") {
      agent.reset();
      add({ kind: "info", text: "Started a new conversation." });
      return;
    }

    add({ kind: "user", text });
    setBusy(true);
    const ac = new AbortController();
    turn.current = ac;
    try {
      await agent.run(text, events, ac.signal);
      flush();
      if (ac.signal.aborted) add({ kind: "info", text: "Interrupted." });
    } catch (err) {
      flush();
      add({ kind: "error", text: (err as Error).message });
    } finally {
      turn.current = null;
      setBusy(false);
    }
  }

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      if (turn.current) turn.current.abort();
      else exit();
      return;
    }
    if (key.escape && turn.current) {
      turn.current.abort();
      return;
    }
    if (!pending) return;
    const c = ch.toLowerCase();
    if (c === "y") pending.resolve("yes");
    else if (c === "n") pending.resolve("no");
    else if (c === "a" && pending.req.ruleLabel) pending.resolve("always");
  });

  return (
    <>
      <Static items={items}>{(item) => <EntryView key={item.id} entry={item} />}</Static>
      {live && (
        <Box marginTop={1}>
          <Markdown text={live} />
        </Box>
      )}
      {pending ? (
        <ApprovalBox req={pending.req} />
      ) : busy ? (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> working… (esc to stop)</Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
          <Text color="cyan">{"› "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Ask me to do something" />
        </Box>
      )}
    </>
  );
}
