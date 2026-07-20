# Ender

<p align="center">
  <img src="ui/public/icons/electron-icon-256.png" alt="Ender logo" width="120">
</p>

Ender is a local-first agent runtime with a React/Electron control surface, guided workflows, recurring schedules, and a tool-calling execution loop built on LangChain.

It is designed for operator-driven work: launch a task against a workspace, watch the live transcript, approve sensitive actions, and keep thread history on disk.

## What Ender Does

- Runs an iterative tool-calling loop until the task is completed, stalled, canceled, or reaches a configured step cap.
- Exposes a local API for threads, live logs, approvals, workflows, schedules, health, and workspace browsing.
- Adds a persisted global task ledger that can queue work, auto-dispatch tasks, and track which thread completed each item.
- Ships a React UI and an Electron desktop app built from the same frontend.
- Persists threads, projects, memories, schedules, task-ledger entries, and workflow sessions to versioned JSON records so they survive server restarts.
- Supports guided workflows that gather structured inputs before starting work.
- Supports recurring automation for three targets: start a new prompt, continue an existing thread, or run a workflow on a cron cadence.
- Works with multiple LLM backends: OpenAI, AWS Bedrock, Azure OpenAI, Ollama, and ACP-compliant agents (Claude Code, etc.)
- Includes tools for files, shell execution, git, GitHub, GitLab, Jira, Confluence, Google Drive, email, browser capture, schedules, and child threads.

![Ender live thread view](docs/website/screenshots/hero-thread-view.png)

## Core Functionality at a Glance

### Runtime and orchestration

| Area | Summary |
| --- | --- |
| Task runtime | Iterative LangChain-based tool loop with persistence, approvals, SSE logs, reruns, and follow-up prompts. |
| Workflows | Server-defined state machines rendered by the UI from generic `form`, `select`, and `complete` steps. |
| Schedules | Cron-backed automation for `prompt`, `thread`, and `workflow` targets. |
| Global task ledger | Persists queue entries, auto-dispatches work when slots are free, and links completed work back to the responsible thread. |
| Self-update | Optional supervised self-edit / verify / restart / rollback flow for Ender’s own repo. |
| Persistence | Threads, schedules, and workflow sessions are stored on disk as JSON. |

### Tooling categories

| Category | Included functionality |
| --- | --- |
| Workspace tools | Read, write, list, and existence checks for workspace files. |
| Local execution | Shell command execution with approval gating for risky commands. |
| Web and browser | Raw HTTP fetch, web search, readable page extraction, image ingest, and rendered page snapshots. |
| Source control | Git clone/fetch/status/add/commit/pull/push plus GitHub and GitLab repo / PR / MR operations. |
| Work management | Jira issue lookup, board issue listing, transitions, and comments. |
| Knowledge systems | Confluence search/read/create/update and Google Drive search/read/export/upload/update. |
| Communication | IMAP email listing/reading and SMTP email sending. |
| Automation | Current time lookup plus schedule create/list/delete. |
| Delegation and continuity | Child thread spawn/status/await plus task ledger tools for facts, todos, and completion. |

### Built-in workflow

| Workflow | Purpose | Scheduling |
| --- | --- | --- |
| `jira_to_repo_task` | Select a Jira issue, clone a repository, choose commit/push and Jira outcome policy, then start a task in the repo. | Supported |

![Ender workflow step](docs/website/screenshots/workflow-step-view.png)

Sensitive actions stay operator-visible instead of disappearing into a black box.

For the full functionality tables, see [docs/reference/functionality-matrix.md](docs/reference/functionality-matrix.md).

## Project Layout

```text
ender/
├── src/        # API server, runtime loop, managers, tools, workflows
├── ui/         # React UI + Electron packaging
├── docs/       # Tutorials, references, architecture notes
├── knowledge/  # Fast onboarding docs for future threads
├── threads/    # Persisted task snapshots
├── schedules/  # Persisted cron schedules
├── task-ledger/ # Persisted global task ledger entries
├── workflow-sessions/ # Persisted interactive workflow sessions
└── workspace/  # Default working directory for cloned/generated work
```

## Quickstart

The maintained operator, architecture, deployment, and troubleshooting path starts at [docs/README.md](docs/README.md).

### Prerequisites

- Node.js 20+
- npm
- At least one configured LLM backend

### Install

```bash
npm install
cp .env.example .env
```

Running `npm install` from the repository root installs both the API/runtime and [`ui/`](ui/) through npm workspaces.

### Configure

Choose the default backend in `.env`:

- `LLM_BACKEND=openai`
- `LLM_BACKEND=bedrock`
- `LLM_BACKEND=azure`
- `LLM_BACKEND=ollama`
- `LLM_BACKEND=acp`

Then fill in the matching credentials. Ender automatically publishes the selected backend plus every other configured provider through `GET /llm-profiles`; comma-separated plural model variables publish additional profiles for the same provider. The launch and follow-up pickers can switch provider or model per turn without restarting the server. For the default OpenAI setup, the minimum is:

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

![Ender new task launch](docs/website/screenshots/new-task-full.png)

## Knowledge Base for Future Threads

Start here for fast repo onboarding:

- [knowledge/README.md](knowledge/README.md)
- [knowledge/quick-start-for-agents.md](knowledge/quick-start-for-agents.md)
- [knowledge/change-playbooks.md](knowledge/change-playbooks.md)
- [knowledge/glossary.md](knowledge/glossary.md)
- [knowledge/troubleshooting.md](knowledge/troubleshooting.md)

Ender’s system prompt also instructs future threads to check repo-local guidance early, especially `knowledge/` and common files like `README.md`, `docs/README.md`, `tasks.md`, `TASKS.md`, `soul.md`, `SOUL.md`, `AGENTS.md`, `agent.md`, `instructions.md`, `notes.md`, and `context.md` when relevant.

### Supervised Self-Update Mode

To let Ender edit and safely restart its own repo, start the API under the external supervisor:

```bash
npm run start:supervised
```

This mode:

- injects `ENDER_SUPERVISOR_URL` and `ENDER_SUPERVISOR_TOKEN` into the child server
- enables self-update tools for tasks running against the Ender repo root
- supports rollback checkpoints plus verification before promotion

Recommended self-update flow:

1. Launch a task with the Ender repo as the workspace.
2. Call `self_update_checkpoint_create` before editing.
3. Make the code changes.
4. Call `self_update_apply` to run `npm run verify`, restart under supervision, and roll back on failure.
5. After reconnect, inspect the result with `self_update_operations` or `GET /self-update/operations`.

### Quality Gates

```bash
npm test
npm run typecheck
npm run docs:check
npm run verify
npm audit --omit=dev
```

- `npm test` runs the backend regression suite.
- `npm run typecheck` runs the targeted TypeScript check for the migrated runtime slice.
- `npm run docs:check` validates maintained local Markdown links and referenced root npm scripts.
- `npm run verify` checks version synchronization, documentation, backend tests, typecheck, syntax, the UI production build, and Playwright browser coverage.
- `npm audit --omit=dev` checks the production dependency graph against the current npm advisory database.
- Environment-specific release checks and their prerequisites are tracked in [`RELEASE_READINESS.md`](RELEASE_READINESS.md).

## Contributing and Releases

Ender uses a `dev`-based workflow. There is no separate long-lived `main` branch for normal development or releases.

Contributors should:

1. Branch from `dev`.
2. Use Git flow-style branch names that describe the work:
   - `feat/short-feature-name`
   - `bug/short-bug-name`
   - `doc/short-doc-change`
   - `chore/short-maintenance-change`
3. Open a pull request back into `dev`.
4. Run the relevant quality gates before requesting review. For broad changes, prefer `npm run verify`.

Releases are cut by tagging a known-good commit on `dev`. Release tags are the source of truth for published versions; no release branch is required unless a future maintenance need makes one necessary.

### Versioning

The repository version is stored in [`VERSION`](VERSION) and mirrored into the server package, UI package, lockfiles, and UI runtime version module.

To update every component version:

```bash
npm run version:set -- 0.1.1
```

To verify that all version metadata is synchronized:

```bash
npm run version:check
```

The server exposes its version through `GET /health` as `app.version`. The UI exposes its own build version in the current server details and compares it with the connected server version.

## Desktop App

The desktop app lives in [`ui/`](ui/) and packages the same React UI with Electron.

After the root install step above, the `ui` dependencies are already installed.

```bash
npm run electron:dev
```

Packaging commands:

```bash
npm run electron:pack
npm run electron:dist
```

Smoke the built renderer/preload boundary before packaging, then smoke the current-platform unpacked package:

```bash
npm run smoke:electron
npm run electron:pack
npm run smoke:electron:packaged
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
- bind mounts for `./threads`, `./workspace`, `./schedules`, `./task-ledger`, and `./workflow-sessions`

Published ports:

- API: `3000`
- UI: `5173`

The compose profile explicitly uses `ENDER_API_ACCESS_MODE=open` because traffic forwarded from the host is not loopback inside the API container. Its browser CORS allowlist is limited to `http://localhost:5173`; protect port `3000` with the host firewall or a trusted deployment boundary. For authenticated remote use, prefer Pillar instead of publishing the API directly.

For isolated image build/runtime checks that do not load the repository `.env`, use the commands in [`RELEASE_READINESS.md`](RELEASE_READINESS.md).

For connection, readiness, Docker exposure, editor, automation, and persistence diagnosis, use the [operator troubleshooting guide](docs/guides/troubleshooting.md).

![Ender schedule manager](docs/website/screenshots/schedule-manager-view.png)

## Pillar Lighthouse Relay

Pillar is the cloud-facing relay for reaching an on-prem Ender API from mobile or remote clients without opening inbound firewall ports. The cloud Pillar process accepts client requests at `/api/:serverId/...`; the on-prem Ender API keeps an outbound poll open, executes the request locally, and posts the response back.

Start the cloud relay:

```bash
PILLAR_AUTH_MODE=oidc \
KEYCLOAK_ISSUER=https://auth.ender.bot/realms/ender \
KEYCLOAK_AUDIENCE=ender \
PILLAR_PORT=8080 \
npm run start:pillar
```

For production, set `CLOUD_DATABASE_URL` or `PILLAR_DATABASE_URL` so registered servers and token hashes are stored in Postgres instead of the local JSON fallback.

Validate the shared Postgres schema with:

```bash
TEST_DATABASE_URL=postgres://user:pass@host:5432/db npm run smoke:cloud-postgres
```

Build the dedicated cloud image:

```bash
docker build -f Dockerfile.pillar -t ender-pillar .
```

Register an Ender server with the same Keycloak user that will access it remotely:

```bash
curl -X POST https://pillar.ender.bot/servers \
  -H "Authorization: Bearer <keycloak-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"serverId":"home","displayName":"Home Ender"}'
```

Enable the on-prem Ender API connector with the returned `plr_...` token:

```env
PILLAR_ENABLED=true
PILLAR_URL=https://pillar.ender.bot
PILLAR_SERVER_ID=home
PILLAR_SERVER_TOKEN=plr_...
```

Remote clients can then use `https://pillar.ender.bot/api/home` as the Ender API base URL with their Keycloak access token. `GET /pillar/status` on the on-prem API reports connector state, and `GET /servers` on Pillar lists the authenticated user's registered servers. `PILLAR_AUTH_MODE=legacy` still supports the earlier global `PILLAR_CLIENT_TOKEN`/`PILLAR_SERVER_TOKEN` mode for local testing.

Pillar also supports Ender's task log stream path, `GET /api/:serverId/tasks/:taskId/stream`, by polling the on-prem API over the outbound connector and emitting the same SSE event names used by the local API.

## Beacon Notification Hub

Beacon is the cloud notification node for Ender apps under `beacon.ender.bot`. It assumes users authenticate with Keycloak OIDC at `auth.ender.bot`, registers mobile/browser push targets to the authenticated user, registers on-prem Ender servers to that same user, and issues a server token that the on-prem API can use to post task notifications.

Start the cloud hub:

```bash
BEACON_PUBLIC_URL=https://beacon.ender.bot \
KEYCLOAK_ISSUER=https://auth.ender.bot/realms/ender \
KEYCLOAK_AUDIENCE=ender \
BEACON_PORT=8090 \
npm run start:beacon
```

For production, set `CLOUD_DATABASE_URL` or `BEACON_DATABASE_URL` so devices, server registrations, notifications, and delivery attempts are stored in Postgres instead of the local JSON fallback. Pillar and Beacon intentionally share the `ender_cloud_servers` table when they point at the same database.

Build the dedicated cloud image:

```bash
docker build -f Dockerfile.beacon -t ender-beacon .
```

Client apps register push targets with their Keycloak access token:

```bash
curl -X POST https://beacon.ender.bot/devices \
  -H "Authorization: Bearer <keycloak-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"phone-1","platform":"ios","pushToken":"..."}'
```

Operators register an Ender server to the same user and copy the returned `token` into the on-prem API:

```bash
curl -X POST https://beacon.ender.bot/servers \
  -H "Authorization: Bearer <keycloak-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"serverId":"home","displayName":"Home Ender"}'
```

Enable the on-prem notification connector:

```env
BEACON_ENABLED=true
BEACON_URL=https://beacon.ender.bot
BEACON_SERVER_ID=home
BEACON_SERVER_TOKEN=bcn_...
```

The local API posts approval and terminal task events to Beacon best-effort. `GET /beacon/status` reports the connector state. Beacon stores notifications, sends native push through APNs and FCM when provider credentials are configured, and records per-device delivery status. Web Push device records are accepted but marked `unsupported_web_push` until the VAPID/Web Push adapter is added.

## Configuration

### Core Runtime

- `PORT`: API port. Default `3000`.
- `ENDER_API_ACCESS_MODE`: `local` rejects non-loopback API and WebSocket clients; `open` allows direct network clients. Default `local`. Pillar's outbound connector continues to work in local mode.
- `ENDER_API_BIND_HOST`: HTTP listen address. Default `0.0.0.0`; access mode is enforced independently.
- `ENDER_CORS_ORIGINS`: optional comma-separated browser origin allowlist. Local mode automatically permits loopback origins; open mode allows all origins only when no list is configured.
- `ENDER_SHUTDOWN_TIMEOUT_MS`: maximum graceful cleanup window before remaining HTTP connections are forced closed. Default `10000`.
- `AGENT_WORKDIR`: default working directory for generated files and cloned repos. Default `./workspace`.
- `AGENT_WORKSPACE_BASE`: root used by the workspace picker. Default `..`.
- `AGENT_THREADS_DIR`: thread persistence directory. Default `./threads`.
- `AGENT_SCHEDULES_DIR`: schedule persistence directory. Default `./schedules`.
- `AGENT_TASK_LEDGER_DIR`: global task-ledger persistence directory. Default `./task-ledger`.
- `AGENT_WORKFLOW_SESSIONS_DIR`: workflow session persistence directory. Default `./workflow-sessions`.
- `AGENT_SELF_ROOT`: repo root allowed for self-update tools. Default current working directory.
- `AGENT_MAX_STEPS`: optional hard limit on model/tool loop iterations.
- `AGENT_STALL_LIMIT`: repeated-iteration cutoff. Default `4`. Set `0` to disable.
- `AGENT_TASK_LEDGER_POLL_INTERVAL_MS`: how often Ender refreshes the global task ledger and checks for finished linked threads. Default `15000`. Set `0` to disable polling.
- `AGENT_TASK_LEDGER_MAX_AUTO_AGENTS`: maximum number of ledger-driven tasks Ender auto-starts concurrently. Default `0` (manual dispatch only).
- `AGENT_AUTO_RESTART_INTERRUPTED_THREADS`: when `true`, interrupted `running` or `awaiting_approval` threads auto-restart after server boot for all workspaces. Default `false`.
- Ender self-root threads opt into interrupted-thread auto-restart by default even when `AGENT_AUTO_RESTART_INTERRUPTED_THREADS` is unset or `false`.
- `AGENT_SELF_UPDATE_VERIFY`: verification command run by the supervisor before restart. Default `npm run verify`.
- `AGENT_SELF_UPDATE_TIMEOUT_MS`: health-wait timeout after restart or rollback. Default `90000`.
- `ENDER_SUPERVISOR_URL`: supervisor control URL injected when using `npm run start:supervised`.
- `ENDER_SUPERVISOR_TOKEN`: supervisor auth token injected when using `npm run start:supervised`.
- `CLOUD_DATABASE_URL`: shared Postgres connection URL used by cloud services. Service-specific `PILLAR_DATABASE_URL` and `BEACON_DATABASE_URL` override this when set.

### Pillar Relay

- `PILLAR_ENABLED`: enables the on-prem outbound connector. Defaults to `true` when `PILLAR_URL` is set.
- `PILLAR_URL`: cloud Pillar base URL.
- `PILLAR_SERVER_ID`: stable server name used in Pillar client URLs, for example `home`.
- `PILLAR_SERVER_TOKEN`: per-server token returned by Pillar registration in `oidc` mode, or the global server token in `legacy` mode.
- `PILLAR_LOCAL_BASE_URL`: local API base URL used by the connector. Defaults to `http://127.0.0.1:$PORT`.
- `PILLAR_AUTH_MODE`: `oidc` for Keycloak user/server authorization, `legacy` for global bearer tokens, or `dev` for local tests with `x-pillar-user-id`.
- `PILLAR_DATABASE_URL`: Postgres connection URL for Pillar's user-owned server registry. Falls back to `CLOUD_DATABASE_URL`, then JSON.
- `PILLAR_DATA_FILE`: JSON store path for registered servers and token hashes in `oidc`/`dev` mode.
- `PILLAR_OIDC_ISSUER`: Keycloak realm issuer. Planned production value: `https://auth.ender.bot/realms/ender`.
- `PILLAR_OIDC_AUDIENCE`: expected OIDC audience or authorized party. Default `ender`.
- `PILLAR_OIDC_JWKS_URI`: optional JWKS override. Defaults to `${PILLAR_OIDC_ISSUER}/protocol/openid-connect/certs`.
- `PILLAR_CLIENT_TOKEN`: legacy-mode cloud token required from mobile or remote clients.
- `PILLAR_PORT`: cloud Pillar listen port. Default `8080`.
- `PILLAR_REQUEST_TIMEOUT_MS`: cloud timeout while waiting for an on-prem response. Default `60000`.
- `PILLAR_POLL_TIMEOUT_MS`: long-poll wait timeout. Default `25000`.
- `PILLAR_RETRY_DELAY_MS`: on-prem retry delay after a failed poll. Default `2000`.
- `PILLAR_CAPACITY`: number of queued requests the on-prem connector accepts per poll. Default `4`.
- `PILLAR_STREAM_POLL_MS`: cloud-side poll interval used to synthesize task SSE streams. Default `1000`.
- `PILLAR_STREAM_HEARTBEAT_MS`: SSE heartbeat interval for relayed task streams. Default `15000`.

### Beacon Notifications

- `BEACON_PUBLIC_URL`: cloud Beacon URL. Planned production value: `https://beacon.ender.bot`.
- `BEACON_PORT`: cloud Beacon listen port. Default `8090`.
- `BEACON_DATABASE_URL`: Postgres connection URL for Beacon devices, server registry, notifications, and delivery attempts. Falls back to `CLOUD_DATABASE_URL`, then JSON.
- `BEACON_DATA_FILE`: JSON store path for devices, server registrations, and notifications.
- `BEACON_AUTH_MODE`: `oidc` for production, `dev` for local tests with `x-beacon-user-id`.
- `KEYCLOAK_ISSUER`: Keycloak realm issuer. Planned production value: `https://auth.ender.bot/realms/ender`.
- `KEYCLOAK_AUDIENCE`: expected OIDC audience or authorized party. Default `ender`.
- `BEACON_OIDC_JWKS_URI`: optional JWKS override. Defaults to `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`.
- `BEACON_ENABLED`: enables the on-prem notification connector. Defaults to `true` when `BEACON_URL` is set.
- `BEACON_URL`: cloud Beacon base URL.
- `BEACON_SERVER_ID`: server ID registered through Beacon.
- `BEACON_SERVER_TOKEN`: server token returned by Beacon registration or rotation.
- `BEACON_FCM_PROJECT_ID`: Firebase project ID for Android push delivery.
- `BEACON_FCM_CLIENT_EMAIL`: Firebase service account client email.
- `BEACON_FCM_PRIVATE_KEY`: Firebase service account private key. Escaped `\n` sequences are accepted.
- `BEACON_APNS_TEAM_ID`: Apple developer team ID.
- `BEACON_APNS_KEY_ID`: APNs token auth key ID.
- `BEACON_APNS_PRIVATE_KEY`: APNs `.p8` private key. Escaped `\n` sequences are accepted.
- `BEACON_APNS_BUNDLE_ID`: app bundle ID used as the APNs topic.
- `BEACON_APNS_ENV`: `production` or `sandbox`. Default `production`.

### Shared Contracts

- Shared schedule/workflow contract enums live in [`shared/contracts.json`](shared/contracts.json).
- Backend schema wrappers live in [`src/shared/contracts.js`](src/shared/contracts.js).
- The UI imports the same contract definitions for workflow step and schedule target handling.

### Readiness Tips

- `GET /health` reports missing configuration for LLM, Jira, GitHub, browser capture, email, and workflow prerequisites.
- The UI server summary now surfaces setup hints directly from that readiness payload.
- Interactive workflow sessions are persisted to disk and can be resumed after a server restart from the workflow panel.

### LLM Backends

`LLM_BACKEND` selects the default provider; it does not limit the server to one provider or model. When `LLM_PROFILES_JSON` is unset, Ender discovers configured OpenAI, Bedrock, Azure OpenAI, Ollama, and ACP providers. The singular model or deployment variable becomes that provider's stable default profile (`openai`, `bedrock`, `azure`, or `ollama`), and each value in its optional comma-separated plural variable becomes another selectable profile. `DEFAULT_LLM_PROFILE_ID` can select any generated profile ID. Set `LLM_PROFILES_JSON` only when you need custom labels, per-profile credentials, or an explicit authoritative allowlist.

OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` — default model
- `OPENAI_MODELS` — optional comma-separated additional models

AWS Bedrock:

- `AWS_REGION`
- `BEDROCK_MODEL_ID` — default model or inference-profile ID; defaults to the US Claude Sonnet 5 inference profile
- `BEDROCK_MODEL_IDS` — optional comma-separated additional model or inference-profile IDs

Azure OpenAI:

- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_DEPLOYMENT_NAME` — default deployment
- `AZURE_OPENAI_API_DEPLOYMENT_NAMES` — optional comma-separated additional deployments
- `AZURE_OPENAI_API_INSTANCE_NAME` or `AZURE_OPENAI_BASE_PATH`
- `AZURE_OPENAI_API_VERSION`

Ollama:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL` — default local model
- `OLLAMA_MODELS` — optional comma-separated additional local models

ACP (Agent Client Protocol):

- `ACP_COMMAND` — the agent binary to spawn (e.g. `claude-code`)
- `ACP_ARGS` — CLI args passed to the agent (default: `acp`)
- `ENDER_ACP_HANDSHAKE_TIMEOUT_MS` — optional startup timeout for ACP `initialize`/`newSession` handshakes, default `30000`

The ACP backend runs an external ACP-compliant agent as a subprocess. When the agent requests permissions (file read/write, shell commands), Ender routes them through its own tool layer and approval system. This lets you use agents like Claude Code as the LLM backend while Ender handles tool execution, approvals, logging, and persistence.

ACP remains one Ender profile because its spawned agent owns model selection. Use the ACP adapter's own configuration when that agent supports multiple models, or define distinct commands with `LLM_PROFILES_JSON`.

Example:
```env
LLM_BACKEND=acp
ACP_COMMAND=claude-code
ACP_ARGS=acp
```

For Codex, use the [maintained Agent Client Protocol adapter](https://github.com/agentclientprotocol/codex-acp) instead of the raw `codex` CLI or the [deprecated `@zed-industries/codex-acp` package](https://www.npmjs.com/package/%40zed-industries/codex-acp). The maintained package includes a compatible Codex runtime:

```env
LLM_BACKEND=acp
ACP_COMMAND=npx
ACP_ARGS=--yes @agentclientprotocol/codex-acp
```

If installed globally as a binary, use `ACP_COMMAND=codex-acp` with empty `ACP_ARGS`. If `CODEX_PATH` is set, it overrides the adapter's bundled Codex; remove stale overrides when the server reports that a model requires a newer Codex version.

After configuring Codex authentication and restarting Ender, exercise the actual HTTP task path, ACP handshake, session, and one minimal model turn with:

```bash
npm run smoke:acp-server
```

This smoke starts an isolated loopback server with temporary persistence and workspace directories, then removes them. It intentionally uses the configured Codex authentication, network access, and one model request; it is therefore separate from `npm run verify`.

To prove that one running server can execute both the automatically discovered ACP and OpenAI profiles, run:

```bash
npm run smoke:configured-backends
```

The combined smoke makes one minimal request through each configured profile and has the same credential, network, and model-usage boundary as the ACP-only smoke.

ACP agents also support custom LLM profiles for different agent binaries or configurations.

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
- `GET /llm-profiles`
- `GET /filesystem/directories?path=/optional/absolute/path`
- `GET /pillar/status`
- `GET /beacon/status`

Projects and memories:

- `GET /projects`
- `POST /projects`
- `PUT /projects/:id`
- `POST /projects/:id/ensure-workspace`
- `GET /memories`
- `POST /memories`
- `PUT /memories/:id`
- `DELETE /memories/:id`

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
- `GET /tasks/:id/code-server`
- `POST /tasks/:id/code-server`
- `DELETE /tasks/:id/code-server`

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

Task ledger:

- `GET /task-ledger`
- `GET /task-ledger/:id`
- `POST /task-ledger`
- `PUT /task-ledger/:id`
- `POST /task-ledger/:id/run`
- `DELETE /task-ledger/:id`

Self-update:

- `GET /self-update/status`
- `GET /self-update/operations`
- `GET /self-update/operations/:id`

## Operational Notes

- Thread snapshots are persisted to disk in `threads/`.
- Workflow sessions are persisted to disk in `workflow-sessions/` unless created in `scheduled_run` mode.
- On server restart, tasks that were `running` or `awaiting_approval` are either reloaded as `error` and annotated as interrupted, or auto-restarted if the task or config opted into restart behavior.
- Ender self-root threads auto-restart on interruption by default.
- `DELETE /tasks/:id` can optionally delete the task workspace if it is an eligible child workspace and not in use by another thread.
- `git_push` and schedule deletion are approval-gated through the UI.
- `browser_snapshot_page` requires Playwright plus a Chromium binary in the runtime environment.
- The health endpoint reports backend and integration readiness, including whether the Jira workflow is currently runnable.

## Documentation

Start here:

- [Documentation index](docs/README.md)
- [Knowledge base index](knowledge/README.md)
- [Functionality matrix](docs/reference/functionality-matrix.md)
- [First task tutorial](docs/tutorials/first-task.md)
- [Jira workflow tutorial](docs/tutorials/jira-workflow.md)
- [Schedules tutorial](docs/tutorials/schedules.md)
- [Desktop app tutorial](docs/tutorials/desktop-app.md)
- [Custom workflow guide](docs/guides/custom-workflow.md)
- [Workflow UI step schema reference](docs/reference/workflow-step-schema.md)
- [Architecture overview](docs/architecture/overview.md)
- [Release readiness matrix](RELEASE_READINESS.md)

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
- `threads/`, `projects/`, `memories/`, `schedules/`, `task-ledger/`, `workflow-sessions/`, and `workspace/` do not contain sensitive data
- desktop packaging assets are the intended release icons
- `npm run verify`, both npm audits, and the applicable checks in [`RELEASE_READINESS.md`](RELEASE_READINESS.md) pass
- platform signing, notarization or installer validation is recorded for the target artifact

---

This project was developed independently by Paul Demers
outside the scope of any employment and without the use
of employer resources or confidential information.
