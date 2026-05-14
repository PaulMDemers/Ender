# Ender Master Source of Truth

Last reviewed: 2026-05-08

Product version observed: 0.1.1

This document describes Ender as the product currently exists. It intentionally ignores older documentation and avoids implementation-level details. It is meant to be the durable product and service reference for what Ender is, what it does, what concepts users interact with, what integrations exist, and what operational boundaries are currently true.

## Product Definition

Ender is a local or self-hosted agent runtime and operator console for supervising long-running AI work. It lets an operator start agent tasks, watch their transcripts, provide approvals, continue prior threads, attach files, manage project context, schedule recurring work, queue work in a global task ledger, and launch guided workflows that can hand off into live agent threads.

Ender is not just a chat UI. It is an operational control plane for agent work:

- A user gives Ender a goal.
- Ender runs an agent loop using a configured language model profile.
- The agent can inspect and act on a scoped workspace through tools.
- The UI streams the run as a live transcript with tool activity and status changes.
- Sensitive actions can pause for explicit approval.
- Finished work remains available as a resumable thread.
- Recurring, queued, and workflow-driven tasks can start agent runs without the operator manually retyping every prompt.

The product is designed for hands-on technical operations, especially repository work, issue-to-repo workflows, local workspace automation, documentation work, and recurring agent jobs. Its primary trust model is supervised autonomy: Ender can work independently inside configured boundaries, but important external or destructive operations are gated by approval prompts or by explicit user intent.

## Current User-Facing Surfaces

Ender has two main user surfaces:

1. Web operator console
2. Desktop Electron shell for the same console experience

The console can connect to an Ender server by base URL. It supports saved servers, favorites, last-used ordering, quick reconnect, and a disconnected/offline server picker. The default local server target is `http://localhost:3000` unless configured otherwise.

The main console modes are:

- Launch: start a new supervised task.
- Workflow: run a guided server-defined launch flow.
- Schedules: create and manage recurring automations.
- Task Ledger: queue and monitor shared work items.
- Thread view: inspect and continue an existing task thread.
- Isolated Task Ledger view: a simpler shared-queue screen available from the ledger mode.

The UI also exposes health/readiness information for the connected server, including LLM readiness, Jira workflow readiness, browser capture readiness, code-server/editor readiness, GitHub token readiness, and self-update readiness.

## Core Concepts

### Server

An Ender server is the backend runtime that owns tasks, workspaces, schedules, workflow sessions, projects, memories, task ledger entries, self-update status, and code-server sessions.

The operator console can switch between servers. Server records are stored by the browser/desktop client for convenience, not as shared server-side accounts.

### Workspace

A workspace is the filesystem directory where a task is allowed to operate. A task always has one workspace. If the user does not pick one, Ender uses the server's default workspace directory.

Workspace selection appears in the task launcher and task ledger. The launcher includes a directory browser so operators can select a narrower repository or folder. Project-backed tasks can ensure a project workspace exists before running.

Workspace deletion is conservative. When deleting a task, Ender can optionally delete the task workspace only when it is a safe child of the configured workspace root, is not the root itself, is not owned by a project, and is not still used by another task.

### Task

A task is a supervised agent run. It has:

- A goal.
- A workspace.
- A status.
- A transcript and logs.
- A run count.
- Optional project context.
- Optional memory mode.
- Optional LLM profile.
- Optional parent/child thread relationships.
- Optional pending approvals.
- Optional linkage to a task ledger entry.

Task statuses currently include:

- running
- awaiting_approval
- done
- error
- canceled
- terminated
- blocked
- needs_input

`done` means the task completed. `needs_input` means Ender determined that required information is missing. `blocked` means Ender hit an external constraint or hard blocker. `terminated` means the operator stopped the run.

Tasks persist across server restarts. If a task was interrupted by a restart, Ender normally marks it as error. Tasks running in Ender's own self-root workspace auto-restart by default, and all interrupted tasks can be configured to auto-restart.

### Thread

A thread is the persisted conversation and execution history for a task. Operators can continue a completed, blocked, errored, or needs-input thread with a new message. Continuing a thread reuses recent conversation context, the selected workspace, project context, memory mode, and LLM profile unless changed.

Threads support:

- Human messages.
- Assistant results.
- Tool call summaries.
- Structured multimodal user content.
- Pending approval prompts.
- Resumption through the composer.
- Re-run of the original goal.
- Pinning and archiving in the local UI state.

The thread composer supports text plus attachments. Up to 6 attachments can be added per message. Images up to 2 MB are embedded for visual model input. Text-like files up to 512 KB are inlined into the message. Other binary files are represented by a metadata note rather than embedded content.

### Transcript

The transcript is the live and historical view of a task. It groups tool calls, renders assistant/user markdown, shows structured JSON when relevant, displays attached images, and hides noisy internal step details by default. Operators can still see run details such as backend, workspace, and loop stop reason.

Live task updates are streamed to the UI. A selected task receives status events, log events, approval-required events, completion events, and keepalive pings.

### Approval

An approval is a user decision requested by the agent before a sensitive or externally mutating action. While approval is pending, the task status becomes `awaiting_approval`. The operator can approve or deny. The decision is recorded in the transcript and unblocks the run.

Approval-gated actions include examples such as sending email, creating or updating Confluence pages, creating or commenting on GitHub/GitLab pull requests, mutating Jira issues, pushing git commits, creating or deleting schedules, and applying Ender self-updates.

### Project

A project is a durable record for reusable work context. A project can contain:

- Name and aliases.
- Description.
- Repository URL.
- Default local directory or workspace path.
- Default branch.
- Resource links.
- Associated memory IDs.

Projects are searchable by name, alias, description, repository URL, and workspace path. A task can attach to a project at launch time. When needed, Ender can prepare the project workspace by cloning the project repository if the workspace is missing.

Project workspaces are protected from task-level workspace deletion.

### Memory

A memory is durable context that can be loaded into future tasks. Memories can be global, project-scoped, or thread-scoped. They can represent facts, preferences, summaries, resources, or notes.

Memory fields include:

- Scope: global, project, or thread.
- Kind: fact, preference, summary, resource, or note.
- Title.
- Body.
- Tags.
- Project ID.
- Source thread ID.
- Load policy.
- Confidence.
- Status.

Load policies are:

- auto: eligible for automatic context loading.
- pinned: strongly preferred for automatic loading.
- manual: stored but only loaded through explicit memory tools or manual selection.
- off: excluded from automatic loading.

Task memory mode controls runtime loading:

- Auto: Ender builds a context pack from pinned, project, thread, and search-relevant memories.
- Manual tools only: no automatic context pack is injected, but memory tools remain available.
- Off: no automatic memory context.

Ender can compact a thread into a memory summary.

### LLM Profile

An LLM profile is a selectable model/backend configuration. Ender supports profiles so operators can choose a backend profile per new task or thread continuation.

Supported backend families are:

- OpenAI
- AWS Bedrock
- Azure OpenAI
- Ollama

When no explicit profile list is configured, Ender exposes one default profile derived from the selected backend. A configured profile can have a label, description, backend, model, and provider-specific settings. The UI shows profile label, backend, model when available, and the default marker.

### Workflow

A workflow is a guided multi-step launch flow defined by the server. Workflows collect structured inputs, validate selections, and eventually start a task or produce a complete scheduled configuration.

Workflow step types are:

- form
- select
- complete

Workflow modes are:

- interactive
- schedule_config
- scheduled_run

Interactive workflow sessions persist and can resume after reconnecting or restarting. Scheduled-run sessions do not persist as interactive sessions.

The currently available production workflow is `Jira -> Repo -> Work`.

### Schedule

A schedule is a recurring automation driven by a cron expression. A schedule can be enabled or disabled, can have a timezone, tracks last run time, and records the last run status/message.

Schedule target types are:

- Start a new prompt.
- Continue an existing thread.
- Run a workflow with preconfigured inputs.

Schedules can be created, edited, deleted, and run immediately from the UI. The UI includes cadence presets for weekdays 9am, daily 9am, and hourly, while also allowing custom cron expressions.

### Task Ledger

The task ledger is a global queue of work items that can be manually dispatched or automatically assigned to available agent workers. It is designed for generic work from any source, not only chat-originated tasks.

A ledger entry can contain:

- Title.
- Prompt/task request.
- Task type.
- Workspace.
- Auto-run flag.
- Source metadata.
- Success criteria.
- Constraints.
- Verification plan.
- Linked started/completed task.
- Attempt count.
- Current status.
- Lifecycle details.

Task types offered in the UI are:

- generic
- coding
- documentation
- research
- ops

Ledger statuses include:

- pending
- running
- completed
- failed
- canceled
- blocked
- needs_input

Ledger lifecycle stages include:

- queued
- intake
- feasibility_check
- workspace_scan
- plan
- implement
- verify
- finalize

Ledger verification statuses include:

- pending
- running
- passed
- failed
- skipped

The ledger can automatically dispatch pending auto-run entries if worker capacity is configured. By default, automatic dispatch capacity is 0, meaning entries are queued until run manually or until capacity is enabled. Manual "Run now" bypasses capacity checks for that entry.

Ledger-run tasks receive a stricter autonomous policy. They should not stop for preferences, should record lifecycle progress, should save a concrete plan before implementation, should verify when practical, and should finish as completed, needs_input, or blocked based on the actual result.

### Code-Server Thread Editor

Ender can launch a thread-scoped browser-based code editor for a task workspace using code-server. The UI can show the editor inline in split view, stacked view, modal view, or a separate browser tab depending on screen size and operator choice.

Editor sessions are task-specific and password-protected. The UI displays the session URL, password copy control, mode, and port. The operator can stop an editor session.

Code-server launch modes are:

- auto
- local
- docker

On macOS, auto mode prefers a local code-server launcher. On other platforms, auto mode prefers Docker and can fall back to local launchers. Docker mode uses a code-server container image and can map host workdir paths. Local mode uses an installed code-server command or an npx package when compatible.

## Main Product Workflows

### Start a New Task

The operator starts in Launch mode, enters a mission goal, optionally selects a project, optionally changes workspace, chooses a backend profile, chooses memory loading mode, and starts the task.

Ender creates a thread, begins streaming transcript events, invokes the configured model, and lets the agent use its tools until it finalizes or stops due to a limit, blocker, approval, error, or need for input.

### Continue a Thread

The operator selects an existing task and sends a follow-up message. The follow-up can include text, images, and text-like file attachments. Ender appends the message to the thread and starts another run in the same task.

A thread cannot be continued while it is already running or awaiting approval.

### Re-run a Task

The operator can re-run a task. Re-run starts a new task using the original goal, not the latest continuation prompt. It preserves the workspace/project/profile/memory context from the source task.

### Terminate a Task

The operator can terminate an active task. Termination resolves pending approvals as denied, records the terminal state, closes live streams, and marks the task as finished.

### Delete a Task

The operator can delete a task record. If requested, Ender can also attempt workspace deletion subject to safety rules. Code-server sessions for the task are stopped before deletion.

### Use the Guided Jira Workflow

The Jira workflow walks the operator through:

1. Select Jira project.
2. Select Jira board.
3. Select a Jira issue, with status filtering.
4. Provide a repository URL and target directory.
5. Choose delivery policy.
6. Choose final Jira action.
7. Start a task.

Delivery policy options are:

- Do not commit or push.
- Commit locally only.
- Commit and ask to push.

Final Jira action options are:

- Leave issue status unchanged.
- Transition to one of the available issue transitions.

For interactive runs, the workflow clones the repository before starting the task. If the target directory already exists and is not empty, the workflow fails clearly and asks for a different target. For scheduled workflow configuration, cloning is deferred. For scheduled runs, non-empty clone targets can be automatically renamed with a timestamped suffix.

The task created by the workflow includes Jira issue context, repository path, delivery instructions, Jira outcome instructions, and guardrails for Jira comments and commit messages.

### Schedule Recurring Work

The operator creates a schedule by naming it, selecting a cron cadence, selecting a target type, filling in target details, and optionally setting timezone and enabled/disabled state.

Prompt schedules start a new task. Thread schedules continue an existing thread with a prompt. Workflow schedules require the operator to preconfigure workflow steps so scheduled execution can run without interactive prompts.

Schedules record the last run time, last result, and last message. They can be run immediately outside their normal cadence.

### Queue Work in the Task Ledger

The operator adds a ledger entry with a task request. Optional fields add title, workspace, task type, source metadata, success criteria, constraints, verification plan, and auto-run behavior.

Open ledger entries show status, source, task type, prompt preview, workspace, attempts, lifecycle stage, linked thread, feasibility, verification, checklist, evidence, and result summary when present.

The operator can run entries manually, open the linked task thread, include finished entries, delete non-running entries, or use the isolated ledger view for a simpler queue screen.

### Work with Projects and Memory

Projects provide reusable repo/resource context and can prepare a workspace. Memories provide durable context. Together, they let future tasks start with more relevant knowledge without relying entirely on the current thread.

The UI currently exposes project creation in the task launcher. Memory management is available through service controls and agent tools, and automatic memory loading affects task context.

### Launch a Workspace Editor

From a selected thread, the operator can launch a code-server editor for the task workspace if the server reports editor readiness. The editor can be displayed next to the transcript, stacked on smaller screens, in a modal, or in a new tab. The operator can copy the password and stop the session.

## Agent Runtime Capabilities

Ender's agent can use a broad toolset inside a task. The exact availability depends on server configuration and credentials.

### Workspace and Local Tools

Ender can:

- Read, write, list, and check files within the active workspace.
- Run shell commands in the active workspace.
- Use git operations such as clone, fetch, status, add, commit, pull, and push.
- Spawn child threads for independent subtasks.
- Wait for child threads or inspect their status.
- Save runtime facts and todos for the active task.
- Finalize a run with a completed, needs_input, or blocked outcome.

### Web and Browser Tools

Ender can:

- Fetch raw HTTP responses.
- Search the web.
- Read human-readable webpage text.
- Load images for visual inspection.
- Capture rendered browser snapshots with Chromium when Playwright/Chromium are available.

### Project and Memory Tools

Ender can:

- Search projects.
- Create project records.
- Ensure a project workspace exists.
- Search memories.
- Create memories.
- Update or archive memories.
- Compact a thread into a memory summary.

### Scheduling and Thread Tools

Ender can:

- Get current server time before relative scheduling.
- Create schedules when the user requests automation.
- List schedules.
- Delete schedules.
- Start child threads.
- Inspect or await child threads.

### External Service Tools

Ender can integrate with:

- GitHub: list repositories, list pull requests, create pull requests, comment on pull requests.
- GitLab: list projects, list merge requests, create merge requests, comment on merge requests.
- Jira: get board issues, get issue details, transition issues, comment on issues.
- Confluence: search, read, create, and update pages.
- Google Drive: search, inspect, read, export, upload, and update Drive files.
- Email: send via SMTP, list via IMAP, and read specific messages.

Mutating external actions require explicit user intent and often an approval prompt.

### Self-Update Tools

When Ender is running under its external supervisor, it can:

- Inspect self-update supervisor status.
- Create rollback checkpoints before changing Ender's own source.
- Ask the supervisor to verify and restart Ender with rollback on failure.
- Inspect recent self-update operations.

Self-update is not considered ready unless the server has a supervisor URL, supervisor token, and self root configured.

## Safety, Permissions, and Trust Boundaries

Ender's safety model is based on scoped workspaces, explicit configuration, approval prompts, and truthful reporting.

Important current truths:

- The agent is instructed to prefer direct evidence over speculation.
- The agent is instructed to use the minimum private or external data needed.
- The agent is instructed not to inspect unrelated resources merely because tools permit access.
- Workspace file tools are scoped to the active workspace root.
- Shell commands run in the active workspace and should avoid destructive or credential-inspecting behavior unless explicitly required.
- Git push requires approval.
- External mutating actions require explicit user intent and often an approval prompt.
- Email sending requires approval.
- Schedule creation and deletion require explicit user intent and approval when invoked by the agent.
- Self-update apply requires approval and supervisor support.
- Code-server sessions are task-scoped and password-protected.

Ender currently does not expose a built-in product concept of user accounts, roles, or tenant isolation. Deployments should treat the Ender server as a privileged operator runtime and protect it accordingly with network, host, or reverse-proxy controls when used outside a trusted local environment.

## Readiness and Configuration

Ender reports readiness through the connected server health view. A healthy server can still show individual services as not ready if credentials or local dependencies are missing.

Core runtime settings include:

- Server port.
- Default workspace root.
- Workspace base for browsing/listing workspaces.
- Directories for threads, projects, memories, schedules, task ledger, and workflow sessions.
- Agent max steps.
- Agent stall limit.
- Task ledger poll interval.
- Task ledger max auto-agent capacity.
- Auto-restart policy for interrupted threads.
- Self-update supervisor settings.
- Code-server launch settings.
- LLM backend and profiles.
- Provider credentials.
- External service credentials.

LLM readiness depends on backend:

- OpenAI requires an OpenAI API key.
- Bedrock requires AWS region.
- Azure OpenAI requires API key, deployment name, and either instance name or base path.
- Ollama requires base URL and model.

Jira workflow readiness requires both LLM readiness and Jira credentials. Jira credentials include base URL, email, and API token.

GitHub readiness requires a GitHub token for private access and pull request workflows.

Confluence readiness requires Confluence base URL, email, and API token.

Google Drive readiness requires a Google Drive access token.

Email readiness is available if either SMTP send settings or IMAP read settings are fully configured.

Browser capture readiness requires the Playwright package and a Chromium browser binary.

Code-server readiness depends on whether code-server is enabled, selected mode, local launcher availability, Docker availability, configured image, and npx compatibility.

## Persistence and State

Ender persists operational data on the server filesystem:

- Threads/tasks.
- Projects.
- Memories.
- Schedules.
- Workflow sessions.
- Task ledger entries.
- Code-server session metadata.

The UI also stores some local-only preferences:

- Saved server endpoints.
- Favorite servers.
- Last-used server data.
- Selected workflow session per server.
- Pinned/archived task display state.
- Rail collapsed state.

Because some UI state is local to the browser/desktop client, another client connected to the same server may see the same server-side tasks but not the same local pins, archives, saved servers, or layout preferences.

## Deployment and Runtime Modes

Ender can run as:

- A Node server plus Vite web UI during development.
- A built static web UI served separately from the API.
- A Docker Compose stack with API and UI services.
- An Electron desktop app wrapping the UI.

The Docker Compose configuration runs the API on port 3000 and the UI on port 5173, uses mounted runtime directories for persistence, and configures Docker-backed code-server support.

The Electron shell opens the console in a desktop window with a minimum desktop-oriented size and uses the same web UI behavior.

## Product Boundaries and Current Limitations

The following are current product boundaries as observed:

- Ender is an operator runtime, not a general multi-user SaaS with built-in accounts or permissions.
- The source of truth for active product behavior is the running service and current product surfaces, not historical docs.
- The only active built-in workflow is Jira -> Repo -> Work.
- Task ledger auto-dispatch is disabled by default unless a positive max auto-agent capacity is configured.
- Memory management is product-supported, but the main UI currently emphasizes task launch, project selection, schedules, workflows, and ledger more than a full memory admin screen.
- Project creation is available from the task launcher; project update/archive management is service-supported but not presented as a full project administration UI in the main console.
- Scheduled workflow runs require preconfigured workflow inputs and cannot pause for interactive choices during scheduled execution.
- The local UI's archive/pin task state is display state, not a server-side task status.
- Browser capture requires local Playwright/Chromium readiness.
- Code-server availability depends heavily on host platform, Docker/local launcher availability, and configuration.
- Self-update requires the external supervisor. Without it, self-update status and operations are unavailable.

## Source-of-Truth Maintenance Rules

When this document is updated, use these rules:

1. Base claims on the current product behavior and active source surfaces, not older docs.
2. Keep the document product-facing and service-facing. Do not turn it into source code or module documentation.
3. Include newly shipped user-visible features, statuses, integrations, concepts, and operational boundaries.
4. Remove or mark obsolete features when the product no longer supports them.
5. Prefer exact current product terms from the UI and service behavior.
6. Include dates and version context for major reviews.
7. Keep safety, persistence, and configuration truths current, because operators rely on them for deployment decisions.
