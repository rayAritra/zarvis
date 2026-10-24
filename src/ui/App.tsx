import { useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { Agent, AgentEvents, Answer, ApprovalRequest } from "../loop.js";
import type { Session } from "../session.js";
import type { Todo } from "../tools/todo.js";
import { ApprovalBox, EntryView, Markdown, TodoList, type Entry } from "./parts.js";

interface Pending {
  req: ApprovalRequest;
  resolve: (a: Answer) => void;
}

type Item = Entry & { id: number };

interface Props {
  agent: Agent;
  model: string;
  session?: Session;
  intro?: Entry[];
}

export function App({ agent, model, session, intro = [] }: Props) {
  const { exit } = useApp();
  const nextId = useRef(0);
  const withId = (e: Entry): Item => ({ ...e, id: nextId.current++ });

  const [items, setItems] = useState<Item[]>(() => [
    withId({ kind: "info", text: `zarvis · ${model} · ${process.cwd()}` }),
    withId({ kind: "info", text: "Enter to send · Esc or Ctrl+C stops a task · Ctrl+C at the prompt quits · /help" }),
    ...intro.map(withId),
  ]);
  const [live, setLive] = useState("");
  const liveRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
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
      if (name === "todo_write") setTodos(args.todos);
    },
    // The plan draws itself, so its result line would only repeat it.
    onToolResult: (name, text) => (name !== "todo_write" || text.startsWith("Error:")) && add({ kind: "result", name, text }),
    onToolProgress: (_name, text) => add({ kind: "progress", text }),
    onBlocked: (_name, text) => add({ kind: "blocked", text }),
    onCompact(before, after) {
      flush();
      add({ kind: "info", text: `Compacted the conversation: ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens.` });
    },
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
      add({
        kind: "info",
        text: "Commands: /clear starts a new conversation, /compact summarizes older messages, /exit quits. Anything else is sent to the agent.",
      });
      return;
    }
    if (text === "/clear") {
      agent.reset();
      setTodos([]);
      add({ kind: "info", text: "Started a new conversation." });
      return;
    }

    if (text === "/compact") {
      await runBusy(async (signal) => {
        if (!(await agent.compact(events, signal))) add({ kind: "info", text: "Nothing to compact yet." });
      });
      return;
    }

    add({ kind: "user", text });
    await runBusy(async (signal) => {
      await agent.run(text, events, signal);
      flush();
      if (signal.aborted) add({ kind: "info", text: "Interrupted." });
    });
  }

  // Runs one task with the spinner showing, then saves the session.
  async function runBusy(task: (signal: AbortSignal) => Promise<void>) {
    setBusy(true);
    const ac = new AbortController();
    turn.current = ac;
    try {
      await task(ac.signal);
    } catch (err) {
      flush();
      add({ kind: ac.signal.aborted ? "info" : "error", text: ac.signal.aborted ? "Interrupted." : (err as Error).message });
    } finally {
      turn.current = null;
      setBusy(false);
      try {
        session?.save(agent.messages);
      } catch (err) {
        add({ kind: "error", text: `Couldn't save the session: ${(err as Error).message}` });
      }
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
        <Box flexDirection="column" marginTop={1}>
          {todos.some((t) => t.status !== "completed") && <TodoList todos={todos} />}
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text dimColor> working… (esc to stop)</Text>
          </Box>
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
