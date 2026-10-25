# Zarvis

A coding agent for your terminal. It reads your code, runs commands and edits files, asking before it changes anything. It works with any OpenAI-compatible API, including OpenRouter's free models.

## Features

- **Tools:** read, list and search files; run shell commands; write and edit files, with a diff preview.
- **Permissions:** read-only commands like `ls`, `git status` and `npm test` run without asking. Edits and other commands ask first, with an "always allow" option. Dangerous commands (`sudo`, `rm -rf /`, `git push --force`, `curl … | sh`) are always blocked.
- **Terminal UI:** answers stream in live, diffs are colored, and a plan checklist shows progress. Esc or Ctrl+C stops a running task.
- **Long conversations:** older messages are summarized automatically when the context fills up (`/compact` does it on demand).
- **Sessions:** every conversation is saved, and `zarvis --resume` picks up where you left off.
- **Subagents:** broad research goes to a separate read-only agent, so it doesn't fill the main conversation.
- **Headless mode:** `zarvis -p "…"` for scripts and pipes.
- **Project instructions:** put an `AGENTS.md` in your project and the agent follows it.

## Setup

Requires Node 22+ and, on Windows, [Git for Windows](https://git-scm.com/download/win) (the agent runs commands in Git Bash).

```bash
git clone https://github.com/rayAritra/zarvis.git
cd zarvis
npm install
npm link        # makes the `zarvis` command available everywhere
```

Copy `.env.example` to `.env` inside the cloned folder (or to `~/.zarvis/.env`) and fill in your key:

```
BASE_URL=https://openrouter.ai/api/v1
API_KEY=sk-or-...
MODEL=poolside/laguna-s-2.1:free
```

The `.env` of the project you're working in is never read, so its keys stay with that project. `CONTEXT_TOKENS` (default 100000) sets when compaction kicks in.

## Usage

```bash
cd your-project
zarvis                     # interactive
zarvis --resume            # continue the last conversation in this folder
zarvis -p "why does npm test fail?"
cat error.log | zarvis -p "explain this"
zarvis -p "fix the failing test" --yes    # approve every action that isn't blocked
```

In the UI, type `/help` for commands (`/clear`, `/compact`, `/exit`).

Without `--yes`, headless mode only runs read-only actions and skips anything that needs approval.

## Development

```bash
npm run dev         # run from source
npm test            # tests use a scripted fake model, so no API calls
npm run typecheck
npm run build       # rebuild dist/, which the linked command runs
```

## Hosting it for others (no key needed)

`server/worker.js` is a small Cloudflare Worker that holds your API key and forwards requests, so people who install Zarvis never need a key. It tries several free models in order (falling back when one is rate-limited), caps the output size and limits each IP to 30 requests a minute.

```bash
cd server
npx wrangler login
npx wrangler secret put OPENROUTER_KEY    # paste your key; it stays on Cloudflare
npx wrangler deploy                       # prints your worker URL
```

Then put that URL in `DEFAULT_PROXY` in `src/config.ts`, commit and push. After that, anyone can install and run it with no setup:

```bash
curl -fsSL https://raw.githubusercontent.com/rayAritra/zarvis/main/scripts/install.sh | sh     # macOS / Linux
irm https://raw.githubusercontent.com/rayAritra/zarvis/main/scripts/install.ps1 | iex           # Windows PowerShell
zarvis
```

People with their own key can still set `API_KEY` and `MODEL`; that takes priority over the hosted server. Set a spending limit on the key you give the worker.
