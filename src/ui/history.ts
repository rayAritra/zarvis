import type { Msg } from "../loop.js";
import { SUMMARY_MARKER } from "../compact.js";
import type { Entry } from "./parts.js";

// Turns saved messages back into log entries, so a resumed session shows where it left off.
export function historyEntries(messages: Msg[], max = 30): Entry[] {
  const entries: Entry[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      if (m.content.startsWith(SUMMARY_MARKER)) entries.push({ kind: "info", text: "(earlier messages were summarized)" });
      else entries.push({ kind: "user", text: m.content });
    } else if (m.role === "assistant") {
      if (typeof m.content === "string" && m.content.trim()) entries.push({ kind: "assistant", text: m.content.trim() });
      for (const c of m.tool_calls ?? []) {
        if (c.type !== "function") continue;
        let args: any = {};
        try {
          args = JSON.parse(c.function.arguments);
        } catch {}
        entries.push({ kind: "tool", name: c.function.name, args });
      }
    }
  }
  if (entries.length <= max) return entries;
  return [{ kind: "info", text: `… ${entries.length - max} earlier entries not shown` }, ...entries.slice(-max)];
}
