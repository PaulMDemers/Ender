# Run Your First Task

This tutorial covers the fastest path from a clean checkout to a running Ender thread.

## Prerequisites

- Node.js 20+
- npm
- one configured LLM backend

## 1. Install dependencies

```bash
npm install
cp .env.example .env
```

The root install includes the `ui` workspace.

## 2. Configure one or more backends

For the simplest local setup, use OpenAI:

```env
LLM_BACKEND=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

`LLM_BACKEND` chooses the default. If you also configure ACP, Ollama, Bedrock, or Azure OpenAI values in the same `.env`, Ender publishes those providers alongside OpenAI. Add comma-separated `OPENAI_MODELS`, `BEDROCK_MODEL_IDS`, `AZURE_OPENAI_API_DEPLOYMENT_NAMES`, or `OLLAMA_MODELS` values to publish more than one model for a provider. The run-settings picker can select any profile per task or follow-up.

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

You should see `services.llm.ready: true` for the default backend. `GET /llm-profiles` lists every provider/model profile currently available to task launches.

## 5. Start a thread

In the UI:

1. Choose **New task** in the primary navigation.
2. Enter a goal such as:

```text
Inspect this repo, summarize the major modules, and list the first three cleanup opportunities.
```

3. Optionally select a project and workspace.
4. Open **Review run settings** only when you need a non-default backend profile or memory mode.
5. Select **Start task**.

## 6. Watch the live transcript

Once the task starts, the UI streams logs from:

- `GET /tasks/:id/stream`

**Conversation** keeps the run readable: it shows your messages, one compact live work summary for each turn, approvals that need action, and the final assistant response. Expand a work summary when you need its tool details.

Switch to **All activity** for the complete provider-neutral event stream, including model requests, paired tool calls and results, diagnostics, and timing. Internal phases such as model invocation are not presented as assistant speech.

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

- Check the default `LLM_BACKEND`
- Check the matching credentials in `.env`
- Check `GET /llm-profiles` for the profile selected in the run settings
- Re-open `/health`

No workspaces appear:

- Ender lists directories under `AGENT_WORKSPACE_BASE`
- The default value is `..`, which means sibling folders next to the repo

Task stops early:

- Check `AGENT_MAX_STEPS`
- Check `AGENT_STALL_LIMIT`
- Review the thread log for missing tools or approvals

For connection states, capability diagnostics, launch recovery, and persistence issues, see [Troubleshoot Ender](../guides/troubleshooting.md).
