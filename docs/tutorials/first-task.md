# Run Your First Task

This tutorial covers the fastest path from a clean checkout to a running Ender thread.

## Prerequisites

- Node.js 20+
- npm
- one configured LLM backend

## 1. Install dependencies

```bash
npm install
npm --prefix ui install
cp .env.example .env
```

## 2. Configure a backend

For the simplest local setup, use OpenAI:

```env
LLM_BACKEND=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

## 3. Start Ender

```bash
npm run dev
```

This starts:

- API at `http://localhost:3000`
- UI at `http://localhost:5173`

## 4. Check readiness

Open:

- `http://localhost:3000/health`

You should see `services.llm.ready: true` for your chosen backend.

## 5. Start a thread

In the UI:

1. Open the new task composer.
2. Enter a goal such as:

```text
Inspect this repo, summarize the major modules, and list the first three cleanup opportunities.
```

3. Optionally select a workspace.
4. Submit the task.

## 6. Watch the live transcript

Once the task starts, the UI streams logs from:

- `GET /tasks/:id/stream`

You will see:

- model step boundaries
- tool invocations
- tool result summaries
- approvals when a sensitive action is gated
- final completion status

## 7. Continue a thread

When the task is idle, use the thread composer to send a follow-up prompt. This calls:

- `POST /tasks/:id/messages`

That reuses the persisted thread history and runs the loop again.

## What to expect on disk

- Thread state is persisted in `threads/`
- Default work happens in `workspace/`
- If you choose a custom workspace, Ender will run there instead

## Common issues

LLM backend not ready:

- Check `LLM_BACKEND`
- Check the matching credentials in `.env`
- Re-open `/health`

No workspaces appear:

- Ender lists directories under `AGENT_WORKSPACE_BASE`
- The default value is `..`, which means sibling folders next to the repo

Task stops early:

- Check `AGENT_MAX_STEPS`
- Check `AGENT_STALL_LIMIT`
- Review the thread log for missing tools or approvals

