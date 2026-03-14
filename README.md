# Ender

Ender is an agentic runtime scaffold that repeatedly reprompts and invokes tools until a task is solved.

## Features
- LangChain tool-calling loop with optional max step limit
- Repeated-cycle stall detection to prevent endless tool loops
- Per-thread workspace selection from UI
- JSON-backed thread persistence across server restarts
- JSON-backed schedule persistence for cron automation
- Backend selection via env:
  - OpenAI API key
  - AWS Bedrock
  - Azure OpenAI
- Task API + SSE log streaming compatible with existing `agent-ui` shape
- Workspace-jail file tools and execution tool

## Quickstart
1. Install dependencies:
   - `npm install`
   - `npm --prefix ui install`
2. Configure env:
   - `cp .env.example .env`
   - choose `LLM_BACKEND=openai|bedrock|azure`
   - fill provider-specific env vars
3. Run:
   - `npm run dev`

This starts both API (`http://localhost:3000`) and UI (`http://localhost:5173`).

## Docker
From `ender/`:

1. Build and run:
   - `docker compose up --build`
2. Services:
   - API: `http://localhost:3000`
   - UI: `http://localhost:5173`

The compose stack includes:
- `Dockerfile.api` for the backend runtime
- `ui/Dockerfile` (multi-stage build + nginx) for the frontend
- bind mounts for `./threads`, `./workspace`, and `./schedules` so data persists on disk

## UI
`ender/ui` is a React + Vite console for tasks and live logs.

- `npm run dev:ui` to run UI only
- `npm run build:ui` to build UI only
- Server picker in sidebar supports custom API base URLs and persists locally.

### Optional Electron Build
Inside `ender/ui`:

1. `npm install`
2. `npm run electron:dev` for desktop dev (uses Vite + Electron)
3. `npm run electron:pack` for unpacked build output
4. `npm run electron:dist` for installer artifacts (`dmg`/`nsis`/`AppImage`)

## Provider Setup
### OpenAI
- `LLM_BACKEND=openai`
- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=gpt-4.1-mini` (or your model)

### Bedrock
- `LLM_BACKEND=bedrock`
- `AWS_REGION=us-east-1`
- `BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0`
- provide AWS credentials via standard SDK env/profile

### Azure OpenAI
- `LLM_BACKEND=azure`
- `AZURE_OPENAI_API_KEY=...`
- `AZURE_OPENAI_API_DEPLOYMENT_NAME=...`
- `AZURE_OPENAI_API_INSTANCE_NAME=...` or `AZURE_OPENAI_BASE_PATH=...`
- `AZURE_OPENAI_API_VERSION=2024-10-21`

## Email Setup
### SMTP (send)
- `SMTP_HOST=...`
- `SMTP_PORT=587`
- `SMTP_SECURE=false` (`true` for SMTPS)
- `SMTP_USER=...`
- `SMTP_PASS=...`
- optional: `SMTP_FROM=...`

### IMAP (list/read)
- `IMAP_HOST=...`
- `IMAP_PORT=993`
- `IMAP_SECURE=true`
- `IMAP_USER=...`
- `IMAP_PASS=...`
- optional: `IMAP_MAILBOX=INBOX`

## SCM Setup
### GitHub
- `GITHUB_TOKEN=...`
- optional: `GITHUB_BASE_URL=https://github.com` or your GitHub Enterprise base URL
- private GitHub clones/fetch/pull/push use HTTPS token auth via Ender tools; no SSH keys required

### GitLab
- `GITLAB_TOKEN=...`
- optional: `GITLAB_BASE_URL=https://gitlab.com`

## API
- `GET /health`
- `GET /workspaces` (workspace picker source)
- `GET /filesystem/directories?path=/optional/absolute/path` (browse folders for picker)
- `GET /tasks`
- `GET /workflows`
- `GET /schedules`
- `POST /schedules`
- `PUT /schedules/:id`
- `POST /schedules/:id/run`
- `DELETE /schedules/:id`
- `POST /workflows/:id/sessions`
- `GET /workflow-sessions/:id`
- `POST /workflow-sessions/:id/advance`
- `POST /tasks` `{ "goal": "...", "workspace": "optional/path" }`
- `POST /tasks/:id/messages` `{ "prompt": "..." }` (continue an existing thread when idle)
- `POST /tasks/:id/terminate`
- `GET /tasks/:id`
- `GET /tasks/:id/logs?from=0`
- `GET /tasks/:id/stream`
- `POST /tasks/:id/approvals/:approvalId` `{ "approved": true|false }`
- `DELETE /tasks/:id` `{ "deleteWorkspace": true|false }` (remove thread history and persisted snapshot; optionally delete workspace directory)
- `POST /tasks/:id/rerun`

## Notes
- Current cancel is soft cancel (status change + stream close).
- `POST /tasks/:id/terminate` keeps thread history; `DELETE /tasks/:id` removes it entirely.
- When deleting a thread with `deleteWorkspace: true`, the workspace is only removed if it is not used by another thread.
- Built-in workflows are currently server-defined. The first workflow guides: Jira items -> issue selection -> repo clone -> commit/push policy -> final Jira status -> task start.
- Schedules are cron-based and persisted to `./schedules` by default. Override with `AGENT_SCHEDULES_DIR=/absolute/path`.
- Use [workflowTemplate.js](/Users/pauldemers/Desktop/ender-workspace/ender/src/workflows/workflowTemplate.js) as the copy/paste starting point for a new workflow.
- New workflows should live in `src/workflows/`, export a definition with `id`, `name`, `description`, `createInitialState`, `getCurrentStep`, and `advance`, then be added once in [index.js](/Users/pauldemers/Desktop/ender-workspace/ender/src/workflows/index.js).
- If `AGENT_MAX_STEPS` is unset, the loop runs without a hard cap.
- `AGENT_STALL_LIMIT` stops repeated tool-call cycles (set `0` to disable).
- Threads are persisted to `./threads` by default. Override with `AGENT_THREADS_DIR=/absolute/path`.
- Thread workspaces can be any existing directory selected in the picker.
- `exec_run` reports `command_not_found` explicitly to prevent blind retries.
- Git tools are included: clone/fetch/status/add/commit/pull/push.
- Private GitHub repositories can be cloned and synced over HTTPS when `GITHUB_TOKEN` is set.
- `git_push` is approval-gated through the UI prompt.
- GitLab tools: list projects, list/create/comment merge requests.
- GitHub tools: list repositories, list/create/comment pull requests.
- Jira tools: list board issues, get issue, transition issue, comment issue.
- Web tools: `web_search`, `web_page_read`, `http_get`, `image_ingest`, `browser_snapshot_page`.
- `browser_snapshot_page` requires Playwright + browser binaries in the runtime environment.
  - install: `npm install playwright`
  - install Chromium binary: `npx playwright install chromium`
- Email tools: `email_list`, `email_read`, `email_send`.
- Cron tools: `time_now`, `cron_schedule`, `cron_list`, `cron_delete`.
- All generated files are constrained to `AGENT_WORKDIR`.

## Adding Workflows
1. Copy [workflowTemplate.js](/Users/pauldemers/Desktop/ender-workspace/ender/src/workflows/workflowTemplate.js) to a new file in [src/workflows](/Users/pauldemers/Desktop/ender-workspace/ender/src/workflows).
2. Replace the template `id`, `name`, `description`, and step logic.
3. Register the workflow once in [index.js](/Users/pauldemers/Desktop/ender-workspace/ender/src/workflows/index.js).

Workflow contract:
- `createInitialState(input, context)`: bootstrap server-side state for the first step.
- `getCurrentStep(session)`: return the UI-visible step definition (forms/select steps are rendered dynamically by the workflow panel).
- `advance(session, input, context)`: mutate `session.state`, optionally call `taskManager.start(...)`, and return `{ ok: true, startedTaskId? }`.
