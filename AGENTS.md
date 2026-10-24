# my-agent

A terminal coding agent in TypeScript (Node, ESM). It talks to any OpenAI-compatible API (OpenRouter by default), configured through `BASE_URL`, `API_KEY` and `MODEL` in `.env`.

## Commands

- `npm run dev`: start the agent
- `npm run typecheck`: type-check with `tsc`

## Layout

- `src/cli.ts`: entry point and terminal input
- `src/loop.ts`: the agent loop (model call, tool calls, approvals)
- `src/permissions.ts`: which commands run without asking, which are blocked
- `src/prompts.ts`: builds the system prompt
- `src/tools/`: one file per tool, registered in `src/tools/index.ts`

## Conventions

- ESM imports use `.js` extensions, even for `.ts` files.
- Tool arguments are zod schemas; tools throw `ToolError` for errors the model should see.
- Never read or print `.env`.
