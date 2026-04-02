# Ender Functionality Matrix

This document summarizes the tools, workflows, orchestration layers, and operator-facing surfaces currently supplied by Ender.

## Core Runtime and Operator Surfaces

| Area | What it does | Key files / endpoints | Notes |
| --- | --- | --- | --- |
| Task runtime | Runs the iterative model + tool loop for a thread until completion, stall, cancellation, or step cap. | `src/runtime/runTask.js`, `src/runtime/runAgentLoop.js`, `src/runtime/taskManager.js` | Uses LangChain tool calling and persists thread state to disk. |
| REST API | Exposes health, tasks, approvals, workflows, schedules, self-update, and workspace browsing. | `src/api/app.js` | Main local API surface used by the UI and Electron shell. |
| React / Electron UI | Operator console for launching tasks, watching logs, handling approvals, running workflows, and managing schedules. | `ui/src/App.jsx`, `ui/` | Same frontend powers browser UI and desktop app. |
| Workflow engine | Runs server-defined workflow state machines and emits generic UI steps. | `src/workflows/workflowManager.js`, `src/workflows/index.js` | Supports `interactive`, `schedule_config`, and `scheduled_run` modes. |
| Schedule engine | Persists cron jobs and dispatches them to prompt, thread, or workflow targets. | `src/runtime/scheduleManager.js` | Backed by `node-cron` and JSON files in `schedules/`. |
| Self-update supervisor integration | Lets Ender checkpoint, verify, restart, and roll back its own repo when running under the external supervisor. | `src/selfUpdate/*`, `src/tools/selfUpdateTools.js`, `/self-update/*` | Only available when configured and when the active workspace is the Ender repo root. |
| Persistence | Stores threads, schedules, and workflow sessions on disk. | `threads/`, `schedules/`, `workflow-sessions/` | Survives server restarts. |
| Readiness / setup reporting | Reports missing integration config and workflow readiness. | `src/health/readiness.js`, `GET /health` | Used by the UI to surface setup guidance. |

## Tool Catalog

### Workspace and Local Execution Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `file_write` | Write a UTF-8 text file inside the workspace root. | Write | Usually implied by task | Rejects path traversal outside workspace. Creates parent directories as needed. |
| `file_read` | Read a UTF-8 text file inside the workspace root. | Read | No | Returns helpful nearest-path and suggestion info when a file is missing. |
| `file_list` | List directory entries inside the workspace root. | Read | No | Recursive mode ignores `node_modules`; supports `maxItems`. |
| `file_exists` | Check whether a workspace file or directory exists. | Read | No | Returns `exists` and `isDir`. |
| `exec_run` | Run a shell command in the workspace. | Mixed | Required for risky shell actions | Detects and approval-gates risky commands like `sudo`, `git push`, deletes, signals, service control, `dd`, `mkfs`, and reboot/shutdown. Returns command-not-found guidance. |

### Web and Browser Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `http_get` | Fetch raw HTTP response text. | Read | No | Supports paging with `offset` and `maxBytes`; max 1,000,000 bytes. |
| `web_search` | Search the web and return top links. | Read | No | Uses DuckDuckGo HTML results for discovery. |
| `web_page_read` | Fetch a webpage and extract readable text. | Read | No | Supports paging with `offset` and `maxChars`; can include extracted links. |
| `image_ingest` | Load a local or remote image for direct visual inspection. | Read | No | Accepts workspace-local path or URL; rejects oversized images above 2 MB. |
| `browser_snapshot_page` | Capture a rendered full-page browser snapshot. | Read | No | Requires Playwright + Chromium; stores snapshots under `.ender-snapshots/` in the workspace. |

### Git and Repository Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `git_clone` | Clone a git repository into the workspace. | Write | Usually implied by task | Supports GitHub auth header injection when configured. |
| `git_fetch` | Fetch remote refs. | Write metadata | Usually implied by task | Can prune; uses GitHub auth helper when applicable. |
| `git_status` | Inspect repository status. | Read | No | Supports `--short`. |
| `git_add` | Stage file changes. | Write | Usually implied by task | Can stage explicit paths or `--all`. |
| `git_commit` | Create a commit. | Write | Usually implied by task | Automatically prefixes commit messages with `[Ender]` if missing. |
| `git_pull` | Pull remote changes. | Write | Usually implied by task | Supports `--rebase`; may modify working tree/history. |
| `git_push` | Push commits to a remote branch. | Write | Yes | Always approval-gated through the UI. Supports `--set-upstream` and `--force-with-lease`. |

### GitHub Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `github_list_repos` | List accessible GitHub repositories. | Read | No | Requires `GITHUB_TOKEN`. |
| `github_list_pull_requests` | List pull requests for a repository. | Read | No | Supports state, head, base, and pagination filters. |
| `github_create_pull_request` | Create a pull request. | Write | Yes | Approval-gated; supports draft PRs and maintainer modification flag. |
| `github_comment_pull_request` | Comment on a pull request. | Write | Usually | Approval-gated before posting. |

### GitLab Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `gitlab_list_projects` | List accessible GitLab projects. | Read | No | Requires `GITLAB_TOKEN`. |
| `gitlab_list_merge_requests` | List merge requests for a project. | Read | No | Supports state, source branch, target branch, and pagination filters. |
| `gitlab_create_merge_request` | Create a merge request. | Write | Yes | Approval-gated before creation. |
| `gitlab_comment_merge_request` | Comment on a merge request. | Write | Usually | Approval-gated before posting. |

### Jira Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `jira_get_board_issues` | Get issues on a Jira board. | Read | No | Supports `startAt`, `maxResults`, and optional JQL. |
| `jira_get_issue` | Get details for a Jira issue. | Read | No | Optional field filtering. |
| `jira_transition_issue` | Transition a Jira issue by name or ID. | Write | Yes | Resolves transition names to IDs before posting. |
| `jira_comment_issue` | Add a Jira comment. | Write | Usually | Approval-gated; prefixes comments with `[Ender]` if missing. |

### Confluence Tool

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `confluence` | Search, read, create, or update Confluence pages. | Mixed | Required for create/update | Single multi-action tool with `search_pages`, `get_page`, `create_page`, and `update_page`. Update flow fetches current page context and version first. |

### Google Drive Tool

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `google_drive` | Search, inspect, read, export, upload, or update Drive files. | Mixed | Required for upload/update | Single multi-action tool with `search_files`, `get_file`, `read_text_file`, `export_file`, `upload_text_file`, and `update_text_file`. Read path rejects binary-looking content for `read_text_file`. |

### Email Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `email_list` | List recent emails from a mailbox. | Read | Usually | Requires IMAP config. |
| `email_read` | Read a specific email by IMAP UID. | Read | Usually | Requires IMAP config; extracts a text body from raw message source. |
| `email_send` | Send an email via SMTP. | Write | Yes | Approval-gated; requires SMTP config. |

### Scheduling and Time Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `time_now` | Get current server time. | Read | No | Intended before relative scheduling calculations. |
| `cron_schedule` | Create a recurring schedule. | Write | Yes | Supports `prompt`, `thread`, and `workflow` targets. |
| `cron_list` | List schedules. | Read | No | Returns persisted schedule definitions and last-run metadata. |
| `cron_delete` | Delete a schedule. | Write | Yes | Approval-gated. |

### Child Thread Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `thread_spawn` | Start a child thread for delegated work. | Write | No | Only available from within a running task context. |
| `thread_status` | Check child thread status without blocking. | Read | No | Can only inspect the current thread or its child threads. |
| `thread_await` | Wait for a child thread to finish. | Read | No | `timeoutMs: 0` returns an immediate snapshot. |

### Self-Update Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `self_update_status` | Inspect supervisor availability and recent self-update state. | Read | No | Only meaningful when Ender is running under the external supervisor. |
| `self_update_checkpoint_create` | Create a rollback checkpoint before editing Ender itself. | Write | Usually | Requires active workspace to be the Ender repo root. |
| `self_update_apply` | Verify, restart, and roll back on failure. | Write | Yes | Approval-gated; requires supervisor mode and self workspace. |
| `self_update_operations` | Inspect recent self-update operations. | Read | No | Can list all operations or fetch one by ID. |

### Task Ledger / Completion Tools

| Tool | Purpose | Read / write | Approval | Key constraints / behavior |
| --- | --- | --- | --- | --- |
| `save_fact` | Save a concise verified fact for continuity. | Internal state | No | Facts should be directly supported by prompt or tool output. |
| `add_todo` | Save a next actionable step. | Internal state | No | Used for multi-step planning. |
| `get_ledgers` | Read current task and progress ledger. | Internal state | No | Returns plan, todos, facts, and progress. |
| `finalize` | Mark the task complete and emit the final response. | Internal state | No | Normalizes output to begin with `DONE:`. |

## Workflow Support

### Shared workflow contract

| Contract area | Values | Source | Why it matters |
| --- | --- | --- | --- |
| Schedule target kinds | `prompt`, `thread`, `workflow` | `shared/contracts.json` | Keeps backend and UI aligned on schedule target shapes. |
| Workflow modes | `interactive`, `schedule_config`, `scheduled_run` | `shared/contracts.json` | Controls whether a workflow is live, being configured for scheduling, or replayed by cron. |
| Workflow step types | `form`, `select`, `complete` | `shared/contracts.json` | UI renders workflows generically from these step types. |

### Built-in workflows

| Workflow | Purpose | Stages / steps | Scheduling support | Notes |
| --- | --- | --- | --- | --- |
| `jira_to_repo_task` | Select a Jira issue, clone a repo, choose delivery/Jira outcome policy, and start a task. | `project` → `board` → `issue` → `repo` → `delivery` → `jira_outcome` → `complete` | Yes | In `schedule_config`, clone is deferred. In `scheduled_run`, clone collisions auto-rename the target directory. |

### Jira workflow step details

| Stage | UI step type | What Ender gathers or does |
| --- | --- | --- |
| `project` | `select` | Loads Jira projects and asks the operator to choose one. |
| `board` | `select` | Loads boards for the selected project. |
| `issue` | `select` with server-side filter | Loads issues for the selected board and supports status filtering. |
| `repo` | `form` | Collects repository URL and optional target directory; clones immediately except in `schedule_config`. |
| `delivery` | `form` | Captures commit/push policy: `no_commit`, `commit_only`, or `commit_and_push`. |
| `jira_outcome` | `form` | Captures final Jira action: leave unchanged or transition to a selected status. |
| `complete` | `complete` | Shows completion and, in live runs, the started task ID. |

## Schedule Targets and Execution

| Target kind | What happens on run | Required fields | Execution path |
| --- | --- | --- | --- |
| `prompt` | Starts a new task. | `prompt`, optional `workspace` | `taskManager.start(...)` |
| `thread` | Continues an existing thread. | `threadId`, `prompt` | `taskManager.continueTask(...)` |
| `workflow` | Replays a workflow with stored inputs. | `workflowId`, `inputs[]` | `workflowManager.runScheduled(...)` |

## API Surface Summary

| Area | Endpoints |
| --- | --- |
| Health and discovery | `GET /health`, `GET /workspaces`, `GET /filesystem/directories` |
| Tasks | `GET /tasks`, `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/messages`, `POST /tasks/:id/terminate`, `POST /tasks/:id/rerun`, `DELETE /tasks/:id`, `GET /tasks/:id/logs`, `GET /tasks/:id/stream`, `POST /tasks/:id/approvals/:approvalId` |
| Workflows | `GET /workflows`, `POST /workflows/:id/sessions`, `GET /workflow-sessions/:id`, `POST /workflow-sessions/:id/advance`, `POST /workflow-sessions/:id/back` |
| Schedules | `GET /schedules`, `POST /schedules`, `PUT /schedules/:id`, `POST /schedules/:id/run`, `DELETE /schedules/:id` |
| Self-update | `GET /self-update/status`, `GET /self-update/operations`, `GET /self-update/operations/:id` |

## Approval-Gated Actions

| Area | Approval-gated actions |
| --- | --- |
| Shell | Risky shell commands detected by `exec_run`, such as `sudo`, deletes, `git push`, process signals, service control, raw disk writes, filesystem formatting, and reboot/shutdown commands. |
| Git | `git_push` |
| GitHub | `github_create_pull_request`, `github_comment_pull_request` |
| GitLab | `gitlab_create_merge_request`, `gitlab_comment_merge_request` |
| Jira | `jira_transition_issue`, `jira_comment_issue` |
| Confluence | `create_page`, `update_page` actions via `confluence` |
| Google Drive | `upload_text_file`, `update_text_file` actions via `google_drive` |
| Email | `email_send` |
| Scheduling | `cron_schedule`, `cron_delete` |
| Self-update | `self_update_apply` |

## Persistence Summary

| Persisted artifact | Location | Notes |
| --- | --- | --- |
| Threads | `threads/*.json` | Includes task state, logs, approvals, and thread history. |
| Schedules | `schedules/*.json` | Includes cron config, target, and last-run metadata. |
| Workflow sessions | `workflow-sessions/*.json` | Interactive and schedule-config sessions persist; `scheduled_run` sessions do not. |
| Browser snapshots | Workspace `.ender-snapshots/` | Generated by `browser_snapshot_page`. |
