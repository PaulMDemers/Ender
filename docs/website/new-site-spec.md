# Ender Website Rebuild Specification

This document is a detailed implementation brief for rebuilding `ender.bot` so the public site accurately reflects what Ender is today.

It is intended to be handed to another LLM or implementation agent with minimal need for guesswork.

---

## 1. Purpose of the Site

The site should present Ender truthfully and clearly as:

- a **local-first agent runtime**
- an **operator-facing control surface** for supervising agent work
- a system with **real tool access**, not just chat
- a product with **guided workflows**, **recurring schedules**, **persistent threads**, and **approval-gated actions**
- a system that can run through a **web UI** and a **desktop Electron app**
- a platform that supports **multiple model providers** and **multiple operational integrations**

The site should not position Ender as a vague “AI employee,” generic chatbot, or purely hosted SaaS.

The site should emphasize that Ender is for **real work in real environments** with **human oversight**.

---

## 2. Core Positioning

### Primary positioning statement

Ender is a local-first agent runtime and operator console for running, supervising, and automating real work.

### Expanded positioning

Ender lets an operator launch tasks in a real workspace, watch live execution, approve sensitive actions, run structured workflows, schedule recurring automation, and keep durable thread history on disk.

### Key differentiators to communicate

1. **Operator-driven, not black-box autonomous**
   - Ender is built for supervision.
   - Sensitive actions can be approval-gated.
   - Operators can watch live logs and transcripts.

2. **Local-first and practical**
   - Ender runs locally or against a reachable Ender API server.
   - It persists threads, schedules, and workflow sessions on disk.
   - It is not just a hosted chat interface.

3. **Real tool access**
   - Ender can work with files, shell commands, git, GitHub, GitLab, Jira, Confluence, Google Drive, email, the web, browser snapshots, schedules, and child threads.

4. **Structured operations, not just prompts**
   - Ender supports guided workflows.
   - Ender supports recurring schedules.
   - Ender supports persistent task threads and resumable operational context.

5. **Multi-surface product**
   - Browser UI
   - Electron desktop app
   - Local API

6. **Multi-provider model support**
   - OpenAI
   - AWS Bedrock
   - Azure OpenAI
   - Ollama

---

## 3. Messaging Principles

### Must do

- Be concrete.
- Prefer operational truth over hype.
- Show what Ender can do today.
- Explain both the operator experience and the tool/runtime capabilities.
- Make the deployment model clear.
- Make the safety model clear.

### Must avoid

- Do not imply Ender is a fully autonomous replacement for teams.
- Do not imply a giant built-in workflow catalog if only limited built-in workflows exist today.
- Do not imply cloud-only hosted execution unless that is actually offered.
- Do not reduce Ender to “chat with tools.”
- Do not overstate no-code business-user simplicity if the product is still operator/developer oriented.

### Tone

- Technical but accessible
- Confident but precise
- Product-forward, not academic
- Operational and practical

---

## 4. Verified Product Reality the Site Must Reflect

The rebuilt site should align with the following verified realities from the repository and runtime docs.

### Product/runtime reality

- Ender is a **local-first agent runtime**.
- Ender exposes a **local API** for tasks, approvals, workflows, schedules, health, and workspace browsing.
- Ender has a **React UI** and an **Electron desktop app** built from the same frontend.
- Ender persists:
  - threads
  - schedules
  - workflow sessions
- Ender runs an **iterative tool-calling loop** until completion, stall, cancellation, or step cap.
- Ender supports **approval-gated actions**.
- Ender supports **live logs / streaming execution**.
- Ender supports **guided workflows**.
- Ender supports **cron-backed recurring schedules**.
- Ender supports **multiple LLM backends**.

### Verified built-in workflow reality

Current built-in workflow:

- `jira_to_repo_task`

This workflow can guide an operator through:
- selecting a Jira project
- selecting a Jira board
- selecting a Jira issue
- specifying a repository to clone
- choosing commit/push policy
- choosing final Jira outcome behavior
- starting a task in the repo

The site may describe Ender as **workflow-capable** and **extensible**, but should not imply a huge built-in workflow library unless that becomes true.

### Verified tool ecosystem reality

The site should explicitly communicate that Ender includes tools for:

- workspace file read/write/list/existence
- shell command execution
- raw HTTP fetch
- web search
- readable webpage extraction
- image ingest
- rendered browser snapshots
- git clone/fetch/status/add/commit/pull/push
- GitHub repo and pull request operations
- GitLab project and merge request operations
- Jira issue and board operations
- Confluence page operations
- Google Drive file operations
- email read/send
- time lookup
- recurring schedule creation/list/delete
- child thread delegation
- self-update flows when running under the external supervisor

---

## 5. Site Goals

The new site should help a visitor quickly understand:

1. What Ender is
2. Who it is for
3. What it can actually do
4. How it works
5. Why it is different from generic agent/chat products
6. How to get started
7. Where to learn more about tools, workflows, and architecture

The site should support these visitor types:

- technical founder/operator
- developer
- internal tooling engineer
- AI operations lead
- technical team evaluating agent infrastructure

---

## 6. Recommended Information Architecture

The site should include at minimum the following pages.

### Top-level pages

1. **Home**
2. **Product / Platform**
3. **Tools**
4. **Workflows**
5. **Schedules & Automation**
6. **Safety & Control**
7. **Architecture / How It Works**
8. **Compare**
9. **Docs / Getting Started**
10. **Blog**
11. **Contact**

### Tool detail pages

The site should include a tools overview page and category pages.

Recommended tool pages:

1. **Tools Overview**
2. **Workspace & Files**
3. **Shell & Local Execution**
4. **Web & Browser**
5. **Git & Repositories**
6. **GitHub & GitLab**
7. **Jira & Knowledge Systems**
8. **Email & Communication**
9. **Scheduling & Delegation**
10. **Self-Update**

If the site architecture prefers fewer pages, these can be grouped, but the content must still exist.

---

## 7. Global Navigation

Recommended primary nav:

- Product
- Tools
- Workflows
- Automation
- Safety
- Compare
- Docs
- Blog
- Contact

Recommended persistent CTA buttons:

- **Get Started**
- **View on GitHub**

Optional secondary CTA:

- **Read the Docs**

---

## 8. Homepage Specification

The homepage should be the clearest and strongest summary of Ender.

### Homepage goals

- Explain Ender in one screen.
- Show that it is an operator-facing runtime, not just a chatbot.
- Show that it has real tools and operational structure.
- Show screenshots of the actual product.
- Drive visitors to docs, GitHub, and deeper product pages.

### Homepage section order

1. Hero
2. Product proof / screenshots
3. What Ender is
4. Core capabilities
5. Tool ecosystem
6. How Ender works
7. Workflows
8. Schedules / automation
9. Safety and approvals
10. Deployment model
11. Integrations / providers
12. Compare / differentiation
13. CTA footer

### Homepage hero

#### Goal
Immediately communicate the true product.

#### Recommended headline options

Option A:
- **Ender is mission control for real agent work**

Option B:
- **Local-first agent runtime for supervised work**

Option C:
- **Run, supervise, and automate agent work with Ender**

#### Recommended subheadline

Ender is a local-first agent runtime and operator console for launching tasks in real workspaces, supervising live execution, approving sensitive actions, running guided workflows, and scheduling recurring automation.

#### Hero CTAs

Primary:
- Get Started

Secondary:
- View on GitHub

Tertiary text link:
- Read the Docs

#### Hero proof bullets

Use 4–6 short bullets directly under the hero:

- Live task supervision and streaming logs
- Approval-gated sensitive actions
- Guided workflows and recurring schedules
- Persistent threads, schedules, and workflow sessions
- Web UI + Electron desktop app
- OpenAI, Bedrock, Azure OpenAI, and Ollama support

### Product proof / screenshots section

Use real screenshots from the current UI.

Recommended screenshots:
- Main task thread with logs/transcript
- Approval UI
- Workflow runner UI
- Schedule creation UI
- Desktop app window

Each screenshot should have a short caption explaining what the operator is seeing.

### “What Ender is” section

Suggested copy direction:

Ender is not just a chat interface. It is an operator-facing runtime for real tasks.

It combines:
- a tool-calling execution loop
- a local API
- a browser and desktop control surface
- guided workflows
- recurring schedules
- durable task history
- approval checkpoints for sensitive actions

### Core capabilities section

Present as cards or a table.

Recommended cards:

1. **Run tasks in real workspaces**
   - Launch work against a selected workspace or repo.
   - Read and write files.
   - Execute local commands.

2. **Supervise execution live**
   - Watch logs and transcript updates.
   - Inspect tool activity.
   - Resume from persisted thread history.

3. **Approve sensitive actions**
   - Keep a human in the loop for pushes, external writes, risky shell commands, and other impactful actions.

4. **Launch guided workflows**
   - Gather structured inputs before work starts.
   - Use server-defined workflow steps rendered by the UI.

5. **Automate recurring work**
   - Schedule prompts, thread continuations, or workflow runs on cron.

6. **Run across multiple model backends**
   - OpenAI, Bedrock, Azure OpenAI, Ollama.

### Tool ecosystem section

This section is critical and should be explicit.

Suggested heading:
- **A real tool surface, not just prompt orchestration**

Suggested intro:
Ender can work across local files, shell commands, source control, project systems, knowledge systems, communication channels, and the web.

Recommended category grid:

- Workspace & Files
- Shell & Local Execution
- Web & Browser
- Git & Repositories
- GitHub & GitLab
- Jira & Knowledge Systems
- Email & Communication
- Scheduling & Delegation

Each category should link to a dedicated tools page.

### How Ender works section

Use a 4-step flow.

1. **Choose a workspace or repo**
2. **Start a task or workflow**
3. **Watch execution and approve sensitive actions**
4. **Resume later or automate with schedules**

Add a short paragraph under each step.

### Workflows section

Suggested heading:
- **Structured workflows for repeatable operational tasks**

Explain:
- Ender supports server-defined workflows.
- The UI renders workflow steps from shared contracts.
- Workflows can gather structured inputs before task execution.

Mention the current built-in workflow explicitly:
- `jira_to_repo_task`

Describe it concretely.

### Schedules / automation section

Suggested heading:
- **Recurring automation with operator-grade control**

Explain that schedules can target:
- a new prompt
- an existing thread
- a workflow

Mention that schedules are persisted and cron-backed.

### Safety and approvals section

Suggested heading:
- **Human-in-the-loop by design**

Explain:
- Ender can pause for approval before sensitive actions.
- Operators can review what is about to happen.
- This is a core product behavior, not an afterthought.

Mention examples:
- git push
- PR/MR creation
- Jira transitions/comments
- Confluence writes
- Google Drive writes
- email sending
- risky shell commands
- self-update apply

### Deployment model section

Suggested heading:
- **Local-first deployment**

Explain clearly:
- Ender runs locally or against a reachable Ender API server.
- It exposes a local API.
- It has a browser UI and an Electron desktop app.
- It stores threads, schedules, and workflow sessions on disk.

This section should remove ambiguity about whether Ender is a hosted SaaS.

### Integrations / providers section

Split into two groups:

#### Model providers
- OpenAI
- AWS Bedrock
- Azure OpenAI
- Ollama

#### Operational systems
- GitHub
- GitLab
- Jira
- Confluence
- Google Drive
- Email
- Web/browser tooling

### Compare / differentiation section

Suggested heading:
- **Why Ender is different**

Suggested comparison points:
- not just chat
- not just background autonomy
- not just workflow forms
- combines runtime + supervision + tools + persistence + automation

### Homepage footer CTA

Suggested copy:
- Ready to run real agent work with operator control?

Buttons:
- Get Started
- Read the Docs
- View on GitHub

---

## 9. Product / Platform Page Specification

This page should go deeper than the homepage and explain the full product model.

### Goals

- Explain the product architecture in product language.
- Explain the operator experience.
- Explain the runtime model.
- Explain persistence and deployment.

### Recommended sections

1. Overview
2. Runtime model
3. Operator console
4. Persistence
5. Workflows
6. Schedules
7. Desktop app
8. API surface
9. Deployment model
10. Integrations and providers

### Key points to include

- Ender runs an iterative tool-calling loop.
- Tasks continue until done, stalled, canceled, or capped.
- Threads persist to disk.
- Workflow sessions persist to disk.
- Schedules persist to disk.
- The same frontend powers browser and Electron experiences.
- The API exposes tasks, approvals, workflows, schedules, health, and workspace browsing.

---

## 10. Tools Overview Page Specification

This page should be one of the most important pages on the site.

### Goal

Show that Ender has a broad, practical, operator-relevant tool ecosystem.

### Page structure

1. Intro
2. Why tools matter
3. Tool category grid
4. Detailed category summaries
5. Approval model for write actions
6. Link to docs/reference

### Intro copy direction

Ender is useful because it can act in real environments, not just generate text. Its tool surface spans local workspaces, shell execution, source control, project systems, knowledge systems, communication channels, and the web.

### Tool category summary table

Include a table like this:

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

### Important note

This page should explicitly state that some actions are approval-gated by design.

---

## 11. Tool Detail Pages Specification

Each tool category page should follow a consistent structure.

### Shared structure for every tool page

1. Category overview
2. Why this category matters
3. What Ender can do in this category
4. Example operator use cases
5. Safety / approval notes
6. Related docs / related categories

Below are the required content points for each page.

### 11.1 Workspace & Files

#### Must cover
- file read
- file write
- file list
- file exists

#### Key messaging
- Ender can work directly inside a selected workspace.
- File access is constrained to the workspace root.
- This makes it practical for repo work, documentation work, and local task execution.

#### Example use cases
- inspect a codebase
- update docs
- generate files
- verify file presence before edits

### 11.2 Shell & Local Execution

#### Must cover
- local command execution
- risky command approval gating

#### Key messaging
- Ender can execute local commands in the workspace.
- Risky commands are not treated casually.
- Approval gates help keep operators in control.

#### Example use cases
- run tests
- build a project
- inspect git state via shell
- run local verification commands

### 11.3 Web & Browser

#### Must cover
- raw HTTP fetch
- web search
- readable page extraction
- image ingest
- rendered browser snapshots

#### Key messaging
- Ender can gather information from the web in multiple ways.
- It can inspect both raw content and rendered pages.
- This matters for research, verification, and UI inspection.

#### Example use cases
- inspect docs pages
- search for references
- capture a rendered page for review
- inspect screenshots or images

### 11.4 Git & Repositories

#### Must cover
- clone
- fetch
- status
- add
- commit
- pull
- push

#### Key messaging
- Ender can work directly with repositories, not just files.
- Push is approval-gated.
- This supports real development and operational workflows.

#### Example use cases
- clone a repo for task execution
- inspect working tree state
- stage and commit changes
- prepare a branch for review

### 11.5 GitHub & GitLab

#### Must cover
- list repos/projects
- inspect PRs/MRs
- create PRs/MRs
- comment on PRs/MRs

#### Key messaging
- Ender can participate in hosted source control workflows.
- External write actions are approval-gated.

#### Example use cases
- inspect open PRs
- create a PR after local changes
- comment on a merge request with findings

### 11.6 Jira & Knowledge Systems

This page can be split into two pages if desired, but the content must exist.

#### Must cover Jira
- board issue listing
- issue detail lookup
- transitions
- comments

#### Must cover Confluence
- search pages
- get page
- create page
- update page

#### Must cover Google Drive
- search files
- inspect metadata
- read text files
- export files
- upload text files
- update text files

#### Key messaging
- Ender can connect operational work to planning and documentation systems.
- This is one of its strongest practical advantages.

#### Example use cases
- pull a Jira issue into active work
- update a Confluence page after implementation
- inspect a Drive document for requirements

### 11.7 Email & Communication

#### Must cover
- list recent emails
- read email
- send email

#### Key messaging
- Ender can inspect inbound communication and draft/send outbound communication.
- Sending is approval-gated.

#### Example use cases
- review recent messages for context
- send a status update after task completion

### 11.8 Scheduling & Delegation

#### Must cover scheduling
- current time lookup
- create schedule
- list schedules
- delete schedule

#### Must cover delegation
- spawn child thread
- inspect child thread status
- await child thread completion

#### Key messaging
- Ender is not limited to one-off prompts.
- It supports recurring automation and delegated sub-work.

#### Example use cases
- run a recurring prompt every weekday
- continue a thread on a schedule
- delegate a research subtask to a child thread

### 11.9 Self-Update

#### Must cover
- self-update status
- checkpoint creation
- apply update
- inspect operations

#### Key messaging
- Ender can safely modify and restart itself when running under the external supervisor.
- This is a specialized capability and should be described carefully.
- It should be framed as supervised self-maintenance, not magic autonomy.

#### Example use cases
- create a checkpoint before editing Ender’s own repo
- verify and restart with rollback on failure

---

## 12. Workflows Page Specification

### Goal

Explain how Ender handles structured, guided work.

### Must include

- Ender supports server-defined workflows.
- The UI renders workflow steps from shared contracts.
- Workflow step types include:
  - form
  - select
  - complete
- Workflow modes include:
  - interactive
  - schedule_config
  - scheduled_run

### Built-in workflow section

Feature `jira_to_repo_task` prominently.

Describe the stages:
- project
- board
- issue
- repo
- delivery
- jira_outcome
- complete

Explain what each stage gathers or does.

### Important messaging

- Ender is workflow-capable today.
- The current built-in workflow catalog is limited but real.
- The architecture is extensible.

Do not imply dozens of built-in workflows unless that becomes true.

---

## 13. Schedules & Automation Page Specification

### Goal

Explain recurring automation clearly and concretely.

### Must include

- Schedules are cron-backed.
- Schedules are persisted to disk.
- Schedules can target:
  - prompt
  - thread
  - workflow

### Explain each target kind

#### Prompt
Starts a new task from a stored prompt.

#### Thread
Continues an existing thread with a new prompt.

#### Workflow
Runs a workflow with stored inputs.

### Important messaging

- Ender supports recurring automation without losing operator visibility.
- Automation is part of the same operational system as tasks and workflows.

---

## 14. Safety & Control Page Specification

This page is important and should be explicit.

### Goal

Show that Ender is designed for supervised operation.

### Must include

- approval-gated actions
- live logs / transcript visibility
- persistent thread history
- operator review before impactful actions
- local-first control model

### Approval examples to list

- risky shell commands
- git push
- GitHub PR creation/comments
- GitLab MR creation/comments
- Jira transitions/comments
- Confluence writes
- Google Drive writes
- email sending
- schedule creation/deletion
- self-update apply

### Messaging direction

Ender is built to keep humans in the loop when actions have external or persistent consequences.

This should be framed as a product strength.

---

## 15. Architecture / How It Works Page Specification

### Goal

Explain the system in a way that technical evaluators can understand quickly.

### Must include

- iterative tool-calling runtime loop
- local API
- React UI
- Electron desktop app
- persistence model
- SSE/live log streaming
- workflow manager
- schedule manager
- readiness/health reporting

### Suggested section order

1. System overview
2. Runtime loop
3. API surface
4. UI surfaces
5. Persistence
6. Workflow engine
7. Schedule engine
8. Provider support
9. Deployment model

### Suggested architecture summary copy

Ender combines a local API server, an iterative tool-calling runtime, a browser/desktop operator console, and on-disk persistence for threads, schedules, and workflow sessions.

---

## 16. Compare Pages Specification

The compare pages should remain, but should be updated to reflect Ender’s current strengths more concretely.

### Comparison dimensions to include

- operator supervision
- approval gates
- persistent threads
- guided workflows
- recurring schedules
- local-first deployment
- desktop app availability
- tool ecosystem breadth
- source control integration
- project system integration
- knowledge system integration
- communication integration

### Important note

Comparisons should be factual and product-specific, not dismissive or vague.

---

## 17. Docs / Getting Started Page Specification

### Goal

Help technical visitors move from marketing site to actual usage.

### Must include links to

- README / quickstart
- first task tutorial
- Jira workflow tutorial
- schedules tutorial
- desktop app tutorial
- custom workflow guide
- workflow step schema reference
- architecture overview
- functionality matrix

### Suggested sections

1. Quickstart
2. Installation
3. Configuration
4. Run locally
5. Desktop app
6. Tutorials
7. Reference docs
8. GitHub link

---

## 18. Blog Page Guidance

The blog can remain conceptually strong, but future posts should be more grounded in the actual product.

### Recommended themes

- why supervised agent operations matter
- local-first agent infrastructure
- workflows vs freeform prompting
- approval gates as a product feature
- practical tool ecosystems for agents
- recurring automation with visibility

### Recommendation for existing/future posts

Where possible, tie conceptual claims back to concrete product capabilities.

---

## 19. Contact Page Guidance

The contact page should include:

- direct contact method
- GitHub link
- docs link
- quickstart link

It should support both conversation and self-serve evaluation.

---

## 20. Required Content Blocks and Claims

The following claims are safe and should appear somewhere on the site.

### Safe claims

- Ender is a local-first agent runtime.
- Ender includes a browser UI and an Electron desktop app.
- Ender exposes a local API.
- Ender persists threads, schedules, and workflow sessions on disk.
- Ender supports guided workflows.
- Ender supports recurring schedules.
- Ender supports approval-gated actions.
- Ender supports OpenAI, AWS Bedrock, Azure OpenAI, and Ollama.
- Ender includes tools for files, shell, git, GitHub, GitLab, Jira, Confluence, Google Drive, email, web access, browser snapshots, schedules, and child threads.
- Ender currently includes a built-in Jira-to-repo workflow.

### Claims to qualify carefully

- “Everything agents need” should be softened unless backed by a clear scope.
- “Autonomous” should be qualified with supervision/approval language.
- “Workflow platform” should mention current built-in workflow scope and extensibility.

---

## 21. Recommended Copy Snippets

These are suggested copy blocks the implementation agent can use or adapt.

### Short product description

Ender is a local-first agent runtime and operator console for real work. Launch tasks in a workspace, supervise live execution, approve sensitive actions, run guided workflows, and automate recurring work with schedules.

### Slightly longer product description

Ender combines an iterative tool-calling runtime, a local API, a browser and desktop control surface, guided workflows, recurring schedules, and durable thread history. It is designed for operator-driven work in real environments, not just chat.

### Tooling summary

Ender’s tool surface spans local files, shell commands, source control, hosted repository platforms, project systems, knowledge systems, communication channels, and the web.

### Safety summary

Ender keeps humans in the loop for sensitive actions. Operators can watch live execution, review pending actions, and approve impactful changes before they happen.

### Workflow summary

Ender supports server-defined workflows that gather structured inputs before work begins. The current built-in Jira-to-repo workflow can take an issue from selection to repository setup and task launch.

### Automation summary

Ender supports cron-backed recurring automation for new prompts, thread continuations, and workflow runs, all within the same operational system as live tasks.

---

## 22. Visual / Design Guidance

### Visual priorities

- Show the real product UI.
- Use screenshots generously.
- Prefer product proof over abstract illustrations.
- Make the operator console feel active and operational.

### Screenshot priorities

1. Task thread with logs
2. Approval modal/panel
3. Workflow step UI
4. Schedule creation UI
5. Desktop app window
6. Optional architecture diagram

### Design tone

- dark, technical, operational is fine
- should feel like control software, not consumer chat
- should feel trustworthy and precise

---

## 23. SEO / Metadata Guidance

### Homepage title suggestion

Ender — Local-First Agent Runtime and Operations Console

### Homepage meta description suggestion

Ender is a local-first agent runtime and operator console for supervised work. Run tasks in real workspaces, approve sensitive actions, launch workflows, and automate recurring work with schedules.

### Suggested keyword themes

- local-first agent runtime
- agent operations console
- supervised AI agents
- agent workflow platform
- AI agent scheduling
- human-in-the-loop agent system
- agent tooling platform

---

## 24. Implementation Notes for the Site Builder

### Important constraints

- Do not invent unsupported built-in workflows.
- Do not imply hosted SaaS unless that exists.
- Do not hide the local-first model.
- Do not omit the tools story.
- Do not omit the approval/safety story.

### Strong recommendation

The site should include at least one page or section with a **table of tool categories** and at least one page with **detailed tool breakdowns**.

### Another strong recommendation

The homepage should not rely only on conceptual messaging. It should include concrete capability summaries and links to deeper pages.

---

## 25. Suggested Final Sitemap

- /
- /product
- /tools
- /tools/workspace-files
- /tools/shell-local-execution
- /tools/web-browser
- /tools/git-repositories
- /tools/github-gitlab
- /tools/jira-knowledge-systems
- /tools/email-communication
- /tools/scheduling-delegation
- /tools/self-update
- /workflows
- /automation
- /safety
- /architecture
- /compare
- /docs
- /blog
- /contact

If fewer pages are preferred, merge some tool pages, but preserve the content.

---

## 26. Acceptance Criteria

The rebuilt site should satisfy all of the following:

1. A new visitor can understand in under 30 seconds that Ender is:
   - local-first
   - operator-facing
   - tool-capable
   - workflow-capable
   - schedule-capable
   - approval-aware

2. The homepage explicitly mentions:
   - local-first runtime
   - approvals
   - workflows
   - schedules
   - persistence
   - web UI + desktop app

3. The site includes at least one dedicated tools overview page.

4. The site includes pages or sections that explain the major tool categories.

5. The site explicitly mentions the current built-in Jira-to-repo workflow.

6. The site clearly explains the deployment model.

7. The site clearly explains the safety/approval model.

8. The site includes links to docs and GitHub.

9. The site uses screenshots or visuals from the real product.

10. The site avoids unsupported hype and reflects the actual product truthfully.

---

## 27. Source Truth for This Spec

This spec is based on the verified repository documentation and functionality, including:

- `README.md`
- `docs/reference/functionality-matrix.md`
- `knowledge/README.md`
- `docs/agentic-spec.md`
- the currently rendered `ender.bot` site positioning

If implementation questions arise, the repo documentation should be treated as the source of truth over older marketing copy.
