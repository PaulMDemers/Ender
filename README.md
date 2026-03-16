# Ender

<p align="center">
  <img src="ui/public/icons/electron-icon-256.png" alt="Ender logo" width="120">
</p>

Ender is a local-first agent runtime with a React/Electron control surface, guided workflows, recurring schedules, and a tool-calling execution loop built on LangChain.

It is designed for operator-driven work: launch a task against a workspace, watch the live transcript, approve sensitive actions, and keep thread history on disk.

## What Ender Does

- Runs an iterative tool-calling loop until the task is completed, stalled, canceled, or reaches a configured step cap.
- Exposes a local API for threads, live logs, approvals, workflows, schedules, health, and workspace browsing.
- Ships a React UI and an Electron desktop app built from the same frontend.
- Persists threads and schedules to JSON on disk so they survive server restarts.
- Supports guided workflows that gather structured inputs before starting work.
- Supports recurring automation for three targets: start a new prompt, continue an existing thread, or run a workflow on a cron cadence.
- Works with multiple LLM backends: OpenAI, AWS Bedrock, Azure OpenAI, and Ollama.
- Includes tools for files, shell execution, git, GitHub, GitLab, Jira, Confluence, Google Drive, email, browser capture, schedules, and child threads.

## Project Layout

```text
ender/
├── src/        # API server, runtime loop, managers, tools, workflows
├── ui/         # React UI + Electron packaging
├── docs/       # Tutorials, references, architecture notes
├── threads/    # Persisted task snapshots
├── schedules/  # Persisted cron schedules
└── workspace/  # Default working directory for cloned/generated work
```

## Quickstart

### Prerequisites

- Node.js 20+
- npm
- At least one configured LLM backend

### Install

```bash
npm install
npm --prefix ui install
cp .env.example .env
```

### Configure

Pick a backend in `.env`:

- `LLM_BACKEND=openai`
- `LLM_BACKEND=bedrock`
- `LLM_BACKEND=azure`
- `LLM_BACKEND=ollama`

Then fill in the matching credentials. For the default OpenAI setup, the minimum is:

```env
LLM_BACKEND=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

### Run

```bash
npm run dev
```

This starts:

- API: [http://localhost:3000](http://localhost:3000)
- UI: [http://localhost:5173](http://localhost:5173)

## Desktop App

The desktop app lives in [`ui/`](ui/) and packages the same React UI with Electron.

```bash
cd ui
npm install
npm run electron:dev
```

Packaging commands:

```bash
npm run electron:pack
npm run electron:dist
```

Current build targets:

- macOS: `dmg`
- Windows: `nsis`
- Linux: `AppImage`

## Docker

From the repository root:

```bash
docker compose up --build
```

The compose stack includes:

- `Dockerfile.api` for the API/runtime
- [`ui/Dockerfile`](ui/Dockerfile) for the frontend
- bind mounts for `./threads`, `./workspace`, and `./schedules`

Published ports:

- API: `3000`
- UI: `5173`

## Configuration

### Core Runtime

- `PORT`: API port. Default `3000`.
- `AGENT_WORKDIR`: default working directory for generated files and cloned repos. Default `./workspace`.
- `AGENT_WORKSPACE_BASE`: root used by the workspace picker. Default `..`.
- `AGENT_THREADS_DIR`: thread persistence directory. Default `./threads`.
- `AGENT_SCHEDULES_DIR`: schedule persistence directory. Default `./schedules`.
- `AGENT_MAX_STEPS`: optional hard limit on model/tool loop iterations.
- `AGENT_STALL_LIMIT`: repeated-iteration cutoff. Default `4`. Set `0` to disable.

### LLM Backends

OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

AWS Bedrock:

- `AWS_REGION`
- `BEDROCK_MODEL_ID`

Azure OpenAI:

- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_INSTANCE_NAME` or `AZURE_OPENAI_BASE_PATH`
- `AZURE_OPENAI_API_VERSION`

Ollama:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

### SCM and Knowledge Sources

GitHub:

- `GITHUB_TOKEN`
- optional `GITHUB_BASE_URL`

GitLab:

- `GITLAB_TOKEN`
- optional `GITLAB_BASE_URL`

Jira:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

Confluence:

- `CONFLUENCE_BASE_URL`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_API_TOKEN`

Google Drive:

- `GOOGLE_DRIVE_ACCESS_TOKEN`

### Email

SMTP send:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- optional `SMTP_FROM`

IMAP read:

- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_SECURE`
- `IMAP_USER`
- `IMAP_PASS`
- optional `IMAP_MAILBOX`

## Main User Flows

### 1. Start a Direct Task

Use the main composer to send a prompt and optionally choose a workspace. Ender starts a thread, streams logs over SSE, and pauses for UI approval when a tool requires it.

### 2. Launch a Guided Workflow

Ender currently ships one built-in workflow: `jira_to_repo_task`.

It walks through:

1. Select Jira project
2. Select Jira board
3. Select issue
4. Clone repository
5. Choose commit/push policy
6. Choose final Jira action
7. Start a task in the cloned repository

### 3. Create a Schedule

Schedules are persisted cron jobs. A schedule can:

- start a new prompt
- continue an existing thread
- run a workflow with stored inputs

### 4. Run the Desktop App

Use Electron during local operations when you want a dedicated desktop window, OS-specific packaging, and local icon/install assets.

## API Overview

Health and discovery:

- `GET /health`
- `GET /workspaces`
- `GET /filesystem/directories?path=/optional/absolute/path`

Threads:

- `GET /tasks`
- `POST /tasks`
- `GET /tasks/:id`
- `POST /tasks/:id/messages`
- `POST /tasks/:id/terminate`
- `POST /tasks/:id/rerun`
- `DELETE /tasks/:id`
- `GET /tasks/:id/logs?from=0`
- `GET /tasks/:id/stream`
- `POST /tasks/:id/approvals/:approvalId`

Workflows:

- `GET /workflows`
- `POST /workflows/:id/sessions`
- `GET /workflow-sessions/:id`
- `POST /workflow-sessions/:id/advance`
- `POST /workflow-sessions/:id/back`

Schedules:

- `GET /schedules`
- `POST /schedules`
- `PUT /schedules/:id`
- `POST /schedules/:id/run`
- `DELETE /schedules/:id`

## Operational Notes

- Thread snapshots are persisted to disk. Workflow sessions are not; they are held in memory by `WorkflowManager`.
- `DELETE /tasks/:id` can optionally delete the task workspace if it is an eligible child workspace and not in use by another thread.
- `git_push` and schedule deletion are approval-gated through the UI.
- `browser_snapshot_page` requires Playwright plus a Chromium binary in the runtime environment.
- The health endpoint reports backend and integration readiness, including whether the Jira workflow is currently runnable.

## Documentation

Start here:

- [Documentation index](docs/README.md)
- [First task tutorial](docs/tutorials/first-task.md)
- [Jira workflow tutorial](docs/tutorials/jira-workflow.md)
- [Schedules tutorial](docs/tutorials/schedules.md)
- [Desktop app tutorial](docs/tutorials/desktop-app.md)
- [Custom workflow guide](docs/guides/custom-workflow.md)
- [Workflow UI step schema reference](docs/reference/workflow-step-schema.md)
- [Architecture overview](docs/architecture/overview.md)

## Workflow Development

To add a workflow:

1. Copy [`src/workflows/workflowTemplate.js`](src/workflows/workflowTemplate.js).
2. Implement `createInitialState`, `getCurrentStep`, and `advance`.
3. Register it in [`src/workflows/index.js`](src/workflows/index.js).

Workflow UI is generated from the step object returned by `getCurrentStep(session)`. See [Workflow UI step schema reference](docs/reference/workflow-step-schema.md).

## Release Checklist Notes

Before publishing publicly, confirm:

- `.env` is not committed
- provider credentials are removed from local examples
- `threads/`, `schedules/`, and `workspace/` do not contain sensitive data
- desktop packaging assets are the intended release icons

---

This project was developed independently by Paul Demers
outside the scope of any employment and without the use
of employer resources or confidential information.
