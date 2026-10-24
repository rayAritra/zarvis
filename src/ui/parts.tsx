import { Box, Text } from "ink";
import type { ApprovalRequest } from "../loop.js";
import type { Todo } from "../tools/todo.js";
import { describeArgs, describeResult } from "../format.js";

export type Entry =
  | { kind: "user" | "assistant" | "info" | "error"; text: string }
  | { kind: "tool"; name: string; args: any }
  | { kind: "result"; name: string; text: string }
  | { kind: "progress"; text: string }
  | { kind: "blocked"; text: string }
  | { kind: "diff"; text: string };

export function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {todos.map((t, i) =>
        t.status === "completed" ? (
          <Text key={i} color="green" dimColor strikethrough>{"☑ " + t.content}</Text>
        ) : t.status === "in_progress" ? (
          <Text key={i} color="yellow" bold>{"◐ " + t.content}</Text>
        ) : (
          <Text key={i}>{"☐ " + t.content}</Text>
        ),
      )}
    </Box>
  );
}

// Renders **bold** and `code` inside one line.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <Text key={i} bold>{p.slice(2, -2)}</Text>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <Text key={i} color="cyan">{p.slice(1, -1)}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

// Just enough Markdown for model answers: headings, bullets, code blocks, bold and inline code.
export function Markdown({ text }: { text: string }) {
  let inCode = false;
  return (
    <Box flexDirection="column">
      {text.split("\n").map((line, i) => {
        if (line.trimStart().startsWith("```")) {
          inCode = !inCode;
          return null;
        }
        if (inCode) return <Text key={i} color="yellow">{"  " + line}</Text>;
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return <Text key={i} bold underline>{heading[1].replace(/\*\*/g, "")}</Text>;
        const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
        if (bullet) return <Box key={i}><Text>{bullet[1] + "• "}</Text><Inline text={bullet[2]} /></Box>;
        return <Inline key={i} text={line || " "} />;
      })}
    </Box>
  );
}

export function Diff({ text, max = 60 }: { text: string; max?: number }) {
  // Drop the "Index:", "====", "---" and "+++" header lines; the tool line above already names the file.
  const lines = text.trimEnd().split("\n").filter((l) => !/^(Index:|={5,}|--- |\+\+\+ )/.test(l) && l !== "\\ No newline at end of file");
  const shown = lines.slice(0, max);
  return (
    <Box flexDirection="column" marginLeft={2}>
      {shown.map((l, i) => (
        <Text key={i} color={l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : l.startsWith("@@") ? "cyan" : undefined} dimColor={l.startsWith(" ")}>
          {l || " "}
        </Text>
      ))}
      {lines.length > max && <Text dimColor>… {lines.length - max} more lines</Text>}
    </Box>
  );
}

export function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>{"› "}</Text>
          <Text bold>{entry.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Markdown text={entry.text} />
        </Box>
      );
    case "tool":
      if (entry.name === "todo_write" && Array.isArray(entry.args.todos)) {
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color="yellow">{"● "}</Text>
              <Text bold>Plan</Text>
            </Text>
            <TodoList todos={entry.args.todos} />
          </Box>
        );
      }
      return (
        <Box marginTop={1}>
          <Text color="yellow">{"● "}</Text>
          <Text bold>{entry.name}</Text>
          <Text dimColor> {describeArgs(entry.name, entry.args)}</Text>
        </Box>
      );
    case "result":
      return (
        <Text color={entry.text.startsWith("Error:") ? "red" : undefined} dimColor={!entry.text.startsWith("Error:")}>
          {"  ⎿ "}
          {describeResult(entry.name, entry.text)}
        </Text>
      );
    case "progress":
      return <Text dimColor>{"    ↳ " + entry.text}</Text>;
    case "blocked":
      return <Text color="red">{"  ✗ blocked: "}{entry.text}</Text>;
    case "diff":
      return <Diff text={entry.text} />;
    case "info":
      return <Text dimColor>{entry.text}</Text>;
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">Error: {entry.text}</Text>
        </Box>
      );
  }
}

export function ApprovalBox({ req }: { req: ApprovalRequest }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text>
        Allow <Text bold>{req.tool}</Text>
        {req.tool === "bash" && <Text color="yellow"> {req.args.command}</Text>}?
      </Text>
      <Text>
        <Text color="green">y</Text> yes  <Text color="red">n</Text> no
        {req.ruleLabel && (
          <Text>
            {"  "}
            <Text color="cyan">a</Text> always allow {req.ruleLabel}
          </Text>
        )}
        <Text dimColor>  (esc to stop)</Text>
      </Text>
    </Box>
  );
}
