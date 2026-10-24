# my-agent

A terminal coding agent in TypeScript (Node, ESM). It talks to any OpenAI-compatible API (OpenRouter by default), configured through `BASE_URL`, `API_KEY` and `MODEL` in `.env`.

## Commands

- `npm run dev`: start the agent from source
- `npm run typecheck`: type-check with `tsc`
- `npm test`: run the tests (vitest, with a fake model; no API calls)
- `npm run build`: build `dist/cli.js`, which is what the global `my-agent` command runs

## Layout

- `src/cli.tsx`: entry point, flags, starts the UI
- `src/config.ts`: reads settings from the agent's own `.env` or `~/.my-agent/.env`
- `src/loop.ts`: the `Agent` class (streaming model calls, tool calls, approvals, interrupts)
- `src/permissions.ts`: which commands run without asking, which are blocked
- `src/prompts.ts`: builds the system prompt
- `src/compact.ts`: summarizes old messages when the context fills up
- `src/session.ts`: saves conversations to `~/.my-agent/sessions` for `--resume`
- `src/ui/`: the Ink terminal UI
- `src/tools/`: one file per tool, registered in `src/tools/index.ts`
- `test/`: tests; `test/fakeClient.ts` is the scripted fake model

## Conventions

- ESM imports use `.js` extensions, even for `.ts` files.
- Tool arguments are zod schemas; tools throw `ToolError` for errors the model should see.
- Never read or print `.env`.
