import type { Tool } from "./tools/types.js";

export type Decision = "allow" | "ask" | "deny";

export interface Verdict {
  decision: Decision;
  reason?: string;
  // What "always allow" would remember for this call. Missing means it can't be remembered.
  rule?: string;
  ruleLabel?: string;
}

// Read-only commands that run without asking. Each must match a whole command segment.
const SAFE: RegExp[] = [
  /^(ls|pwd|whoami|date|which|type|file|stat|wc|tree|du)(\s|$)/,
  /^(cat|head|tail)\s/,
  /^echo(\s|$)/,
  /^(grep|egrep|fgrep|rg)\s/,
  /^find\s(?!.*\s-(exec|execdir|delete|ok|okdir|fprint|fprintf|fls)\b)/,
  /^git\s+(status|diff|log|show|blame|rev-parse|ls-files)(\s|$)/,
  /^git\s+branch(\s+(-a|-r|-v|-vv|--list|--show-current))*$/,
  /^git\s+remote(\s+-v)?$/,
  /^(node|npm|npx|python|python3|git|tsc)\s+(--version|-v)$/,
  /^npm\s+(test|t|ls|run\s+(test|typecheck|lint))(\s|$)/,
  /^npx\s+(tsc\s+--noEmit|vitest\s+run)(\s|$)/,
];

// Commands that are always refused, no matter what the user answered before.
const BLOCKED: [RegExp, string][] = [
  [/(^|[\s;&|(])sudo(\s|$)/, "sudo is not allowed"],
  [/\bgit\s+push\b.*\s(--force(?!-with-lease)|-f)(\s|$)/, "force-pushing is not allowed"],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, "piping a download into a shell is not allowed"],
  [/\bmkfs(\.\w+)?\s/, "formatting disks is not allowed"],
  [/\bdd\s.*\bof=\/dev\//, "writing to raw devices is not allowed"],
  [/(^|[\s;&|])(shutdown|reboot|halt|poweroff)(\s|$)/, "shutting down the machine is not allowed"],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bombs are not allowed"],
  [/\bformat\s+[a-z]:/i, "formatting drives is not allowed"],
];

// Tools whose second word is part of the command, so "always allow" remembers e.g. "npm install".
const TWO_WORD = new Set(["git", "npm", "npx", "pnpm", "yarn", "bun", "cargo", "go", "docker", "pip", "uv", "dotnet"]);

// Destructive enough that they are asked about every time, never remembered.
const NEVER_REMEMBER = new Set(["rm", "rmdir", "mv", "git push", "git reset", "git clean", "git checkout", "git rebase"]);

function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Redirects, subshells and backgrounding can turn a safe command into a write, so they always ask.
function hasShellTricks(command: string): boolean {
  const cleaned = command.replace(/\d?>&\d/g, "").replace(/\d?>\s*\/dev\/null/g, "");
  return /[<>`]|\$\(|(^|[^&])&([^&]|$)/.test(cleaned);
}

function isDangerousRm(segment: string): boolean {
  const m = segment.match(/^rm\s+(.*)$/);
  if (!m) return false;
  const parts = m[1].split(/\s+/);
  const recursive = parts.some((p) => /^-[a-zA-Z]*[rR]/.test(p) || p === "--recursive");
  const target = parts.some((p) => /^(\/|~|\$HOME|\.|\.\.|\*|\/\*|~\/\*?)$/.test(p) || /^[A-Za-z]:[\\/]?\*?$/.test(p));
  return recursive && target;
}

function prefixOf(segment: string): string {
  const words = segment.split(/\s+/);
  if (!TWO_WORD.has(words[0]) || !words[1] || words[1].startsWith("-")) return words[0];
  if (words[1] === "run" && words[2]) return words.slice(0, 3).join(" ");
  return words.slice(0, 2).join(" ");
}

export class Permissions {
  private rules = new Set<string>();

  remember(rule: string) {
    this.rules.add(rule);
  }

  private bashAllowed(segment: string): boolean {
    if (SAFE.some((re) => re.test(segment))) return true;
    for (const rule of this.rules) {
      if (!rule.startsWith("bash:")) continue;
      const prefix = rule.slice(5);
      if (segment === prefix || segment.startsWith(prefix + " ")) return true;
    }
    return false;
  }

  check(tool: Tool<any>, args: any): Verdict {
    if (tool.risk === "read") return { decision: "allow" };

    if (tool.risk === "write") {
      const rule = `tool:${tool.name}`;
      if (this.rules.has(rule)) return { decision: "allow" };
      return { decision: "ask", rule, ruleLabel: `all ${tool.name} calls` };
    }

    const command = String(args.command ?? "").trim();
    for (const [re, reason] of BLOCKED) {
      if (re.test(command)) return { decision: "deny", reason };
    }
    const parts = segments(command);
    if (parts.some(isDangerousRm)) return { decision: "deny", reason: "recursive delete of a root, home or whole folder" };

    const tricks = hasShellTricks(command);
    if (!tricks && parts.length && parts.every((p) => this.bashAllowed(p))) return { decision: "allow" };

    // Only simple single commands can be remembered; compound ones are asked about every time.
    if (tricks || parts.length !== 1) return { decision: "ask" };
    const prefix = prefixOf(parts[0]);
    if (NEVER_REMEMBER.has(prefix)) return { decision: "ask" };
    return { decision: "ask", rule: `bash:${prefix}`, ruleLabel: `"${prefix}" commands` };
  }
}
