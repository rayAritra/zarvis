# zarvis (my-agent)

A coding agent for your terminal. It reads your code, runs commands and edits files, asking before it changes anything. It works with any OpenAI-compatible API, including OpenRouter's free models.

## Features

- **Tools:** read, list and search files; run shell commands; write and edit files, with a diff preview.
- **Permissions:** read-only commands like `ls`, `git status` and `npm test` run without asking. Edits and other commands ask first, with an "always allow" option. Dangerous commands (`sudo`, `rm -rf /`, `git push --force`, `curl … | sh`) are always blocked.
- **Terminal UI:** answers stream in live, diffs are colored, and a plan checklist shows progress. Esc or Ctrl+C stops a running task.
- **Long conversations:** older messages are summarized automatically when the context fills up (`/compact` does it on demand).
- **Sessions:** every conversation is saved, and `my-agent --resume` picks up where you left off.
- **Subagents:** broad research goes to a separate read-only agent, so it doesn't fill the main conversation.
- **Headless mode:** `my-agent -p "…"` for scripts and pipes.
- **Project instructions:** put an `AGENTS.md` in your project and the agent follows it.

## Setup

Requires Node 22+ and, on Windows, [Git for Windows](https://git-scm.com/download/win) (the agent runs commands in Git Bash).

```bash
git clone https://github.com/rayAritra/zarvis.git
cd zarvis
npm install
npm link        # makes the `my-agent` command available everywhere
```

Put your settings in `~/.my-agent/.env`, or in `.env` inside the cloned folder:

```
BASE_URL=https://openrouter.ai/api/v1
API_KEY=sk-or-...
MODEL=poolside/laguna-s-2.1:free
```

The `.env` of the project you're working in is never read, so its keys stay with that project. `CONTEXT_TOKENS` (default 100000) sets when compaction kicks in.

## Usage

```bash
cd your-project
my-agent                     # interactive
my-agent --resume            # continue the last conversation in this folder
my-agent -p "why does npm test fail?"
cat error.log | my-agent -p "explain this"
my-agent -p "fix the failing test" --yes    # approve every action that isn't blocked
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
