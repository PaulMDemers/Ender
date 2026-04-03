# Ender Tools Pages Copy Deck

This document defines the content for the Tools overview page and the detailed tool category pages.

The goal is to make Ender’s practical tool surface obvious and concrete.

---

## Tools Overview Page

### Page Goal

Show that Ender has a broad, practical tool ecosystem that supports real work across local environments, source control, project systems, knowledge systems, communication channels, and the web.

### Hero Heading
- **Tools for real work, not just text generation**

### Hero Subheading

Ender’s tool surface spans local files, shell execution, repositories, hosted source control platforms, project systems, knowledge systems, communication channels, browser inspection, and recurring automation.

### Intro Paragraph

Ender is useful because it can act in real environments, not just generate text. Its tools let it inspect, modify, verify, and coordinate work across the systems that technical teams already use.

### Tool Category Table

| Category | What Ender can do |
| --- | --- |
| Workspace & Files | Read, write, list, and check files inside the workspace |
| Shell & Local Execution | Run local commands with approval-gating for risky actions |
| Web & Browser | Fetch raw pages, search the web, extract readable content, inspect images, capture rendered pages |
| Git & Repositories | Clone repos, inspect status, stage, commit, pull, and push |
| GitHub & GitLab | List repos/projects, inspect PRs/MRs, create PRs/MRs, comment |
| Jira & Knowledge Systems | Inspect issues, transition issues, comment, search/read/update Confluence, search/read/update Drive |
| Email & Communication | List/read email and send email with approval |
| Scheduling & Delegation | Create schedules, inspect schedules, spawn child threads, await delegated work |
| Self-Update | Checkpoint, verify, restart, and roll back Ender when running under supervision |

### Approval Note

Some actions are approval-gated by design. Ender is built to keep operators in control when actions have external or persistent consequences.

### CTA
- Explore tool categories

---

## Tool Category Page Template

Each category page should include:
- category overview
- why it matters
- what Ender can do
- example operator use cases
- safety and approval notes
- related categories or docs

---

## Workspace & Files Page

### Heading
- **Workspace & Files**

### Overview

Ender can work directly inside a selected workspace. It can inspect files, update content, list directories, and verify whether paths exist before taking action.

### Why it matters

This is the foundation for practical repo work, documentation work, and local task execution. Ender is not limited to abstract reasoning; it can operate inside the actual working directory.

### What Ender can do
- Read UTF-8 text files in the workspace
- Write UTF-8 text files in the workspace
- List directory entries
- Check whether files or directories exist

### Example use cases
- inspect a codebase before making changes
- update documentation files
- generate new project files
- verify that a target file exists before editing

### Safety notes

Workspace file access is constrained to the workspace root. This helps keep actions scoped to the intended environment.

---

## Shell & Local Execution Page

### Heading
- **Shell & Local Execution**

### Overview

Ender can execute local commands inside the workspace to inspect state, run tests, build projects, and verify changes.

### Why it matters

Real work often requires more than file edits. It requires running the project, checking outputs, and validating results in the local environment.

### What Ender can do
- Run shell commands in the workspace
- Use local verification commands
- Inspect command output and exit status

### Example use cases
- run tests after a code change
- build a project to verify a fix
- inspect git state through local commands
- run targeted verification scripts

### Safety notes

Risky or destructive commands should be approval-gated. Ender is designed to treat local execution as a supervised capability, not an unrestricted one.

---

## Web & Browser Page

### Heading
- **Web & Browser**

### Overview

Ender can gather information from the web in multiple ways, from raw HTTP responses to readable page extraction and rendered browser snapshots.

### Why it matters

Research, verification, and UI inspection often require more than one view of a page. Ender can inspect both machine-readable and human-readable web content, and it can capture rendered pages when layout matters.

### What Ender can do
- Fetch raw HTTP response text
- Search the web for relevant sources
- Extract readable webpage text
- Ingest images for direct inspection
- Capture rendered full-page browser snapshots

### Example use cases
- inspect documentation pages
- search for references or release notes
- capture a rendered page for review
- inspect screenshots or visual assets

### Safety notes

Web inspection is read-oriented, but operators should still prefer direct evidence over speculation when using external sources.

---

## Git & Repositories Page

### Heading
- **Git & Repositories**

### Overview

Ender can work directly with repositories, not just individual files. It can clone repos, inspect status, stage changes, commit work, pull updates, and push with approval.

### Why it matters

This makes Ender practical for real development and operational workflows where repository state matters.

### What Ender can do
- Clone a repository into the workspace
- Fetch updates from remotes
- Read repository status
- Stage file changes
- Create commits
- Pull changes from a remote branch
- Push commits to a remote branch

### Example use cases
- clone a repo before starting work
- inspect the working tree before committing
- stage and commit documentation or code changes
- prepare a branch for review

### Safety notes

Push is approval-gated and should remain operator-controlled.

---

## GitHub & GitLab Page

### Heading
- **GitHub & GitLab**

### Overview

Ender can participate in hosted source control workflows by inspecting repositories and review flows, creating pull requests or merge requests, and adding comments.

### Why it matters

Many real workflows do not end at a local commit. They continue into review systems and hosted collaboration platforms.

### What Ender can do
- List accessible GitHub repositories
- List GitHub pull requests
- Create GitHub pull requests
- Comment on GitHub pull requests
- List accessible GitLab projects
- List GitLab merge requests
- Create GitLab merge requests
- Comment on GitLab merge requests

### Example use cases
- inspect open pull requests before starting related work
- create a pull request after local changes are complete
- comment on a merge request with findings or follow-up notes

### Safety notes

External write actions should be approval-gated. The site should make clear that Ender supports these workflows with operator oversight.

---

## Jira & Knowledge Systems Page

### Heading
- **Jira & Knowledge Systems**

### Overview

Ender can connect execution to planning and documentation systems. It can inspect Jira issues, update issue state, work with Confluence pages, and read or update Google Drive content.

### Why it matters

This is one of Ender’s strongest practical advantages. It can bridge active work with the systems where requirements, plans, and documentation live.

### What Ender can do in Jira
- Get issues on a Jira board
- Get details for a Jira issue
- Transition a Jira issue
- Add a comment to a Jira issue

### What Ender can do in Confluence
- Search pages
- Read page content
- Create pages
- Update pages

### What Ender can do in Google Drive
- Search files
- Inspect file metadata
- Read text files
- Export files
- Upload text files
- Update text files

### Example use cases
- pull a Jira issue into active work
- update issue status after implementation
- inspect a Confluence page for requirements
- publish updated documentation after a task
- read a Drive document for context

### Safety notes

Transitions, comments, and content writes should be treated as operator-visible actions with approval where appropriate.

---

## Email & Communication Page

### Heading
- **Email & Communication**

### Overview

Ender can inspect recent email context and send outbound messages when communication is part of the task.

### Why it matters

Operational work often depends on communication context. Ender can help gather that context and draft or send updates with operator approval.

### What Ender can do
- List recent emails
- Read a specific email
- Send an email via SMTP

### Example use cases
- review recent messages for task context
- send a status update after completing work
- draft a follow-up message based on task results

### Safety notes

Sending email is approval-gated and should remain explicitly operator-controlled.

---

## Scheduling & Delegation Page

### Heading
- **Scheduling & Delegation**

### Overview

Ender supports recurring automation and delegated sub-work. It is not limited to one-off prompts.

### Why it matters

Real operational systems need both repeatable automation and the ability to break work into smaller units.

### What Ender can do for scheduling
- Get current server time
- Create recurring schedules
- List schedules
- Delete schedules

### What Ender can do for delegation
- Start a child thread for delegated work
- Check child thread status
- Await child thread completion

### Example use cases
- run a recurring prompt every weekday
- continue a thread on a schedule
- run a workflow on a recurring cadence
- delegate research to a child thread while the main thread continues

### Safety notes

Schedule creation and deletion are operationally important actions and should remain visible and controlled.

---

## Self-Update Page

### Heading
- **Self-Update**

### Overview

When Ender is running under its external supervisor and operating in its own repository, it can safely modify and restart itself using a checkpointed, supervised flow.

### Why it matters

This is a specialized capability that supports supervised self-maintenance without treating self-modification as an unsafe black box.

### What Ender can do
- Inspect self-update supervisor availability and status
- Create a rollback checkpoint before editing
- Apply an update with verification and supervised restart
- Inspect recent self-update operations

### Example use cases
- create a checkpoint before editing Ender’s own source
- verify and restart after a change
- roll back automatically if verification fails

### Safety notes

This capability should be described carefully. It only applies when Ender is running under the external supervisor and should be framed as supervised self-maintenance.

---

## Notes for the Implementer

- Keep the tools story concrete.
- Use tables where helpful.
- Link each category page back to the docs or functionality matrix if available.
- Do not collapse the tools story into a single vague paragraph.
