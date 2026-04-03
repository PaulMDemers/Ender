# Ender Homepage Copy Deck

This document provides implementation-ready copy and structure for the Ender homepage.

It should be used together with `docs/website/new-site-spec.md`.

---

## Page Goal

The homepage should make it immediately clear that Ender is:

- a local-first agent runtime
- an operator-facing control surface
- a system for real work in real environments
- a product with workflows, schedules, approvals, persistence, and broad tool access

The homepage should not read like a generic AI landing page.

---

## Hero Section

### Headline options

Preferred:
- **Run, supervise, and automate real agent work**

Alternates:
- **Local-first agent runtime for supervised work**
- **Mission control for real agent operations**

### Subheadline

Ender is a local-first agent runtime and operator console for launching tasks in real workspaces, supervising live execution, approving sensitive actions, running guided workflows, and scheduling recurring automation.

### Primary CTA
- Get Started

### Secondary CTA
- View on GitHub

### Tertiary link
- Read the Docs

### Hero proof bullets
- Live task supervision and streaming logs
- Approval-gated sensitive actions
- Guided workflows and recurring schedules
- Persistent threads, schedules, and workflow sessions
- Browser UI and Electron desktop app
- OpenAI, Bedrock, Azure OpenAI, and Ollama support

### Short supporting paragraph

Ender is built for operator-driven work. It combines an iterative tool-calling runtime, a local API, a browser and desktop control surface, and durable on-disk state so work can be supervised, resumed, and automated.

---

## Product Proof Section

### Section heading
- **See the operator console in action**

### Intro copy

Ender is designed to make agent work visible and controllable. The interface is built around live execution, approvals, workflows, schedules, and persistent thread history.

### Screenshot captions

1. **Live task thread**
   - Watch the transcript, tool activity, and execution logs as work unfolds.

2. **Approval checkpoint**
   - Review sensitive actions before they happen and keep a human in the loop.

3. **Guided workflow**
   - Gather structured inputs before work begins with server-defined workflow steps.

4. **Schedule configuration**
   - Create recurring automation for prompts, threads, or workflows.

5. **Desktop app**
   - Run the same operator experience in a dedicated Electron desktop app.

---

## What Ender Is Section

### Section heading
- **More than chat. Built for real operational work.**

### Body copy

Ender is not just a prompt box with tools attached. It is an operator-facing runtime for real tasks.

It combines:
- an iterative tool-calling execution loop
- a local API for tasks, approvals, workflows, schedules, and health
- a browser UI and Electron desktop app
- guided workflows for structured task launch
- recurring schedules for automation
- durable thread history stored on disk
- approval checkpoints for sensitive actions

### Supporting statement

The result is a system that can do real work in real environments while keeping operators informed and in control.

---

## Core Capabilities Section

### Section heading
- **Core capabilities**

### Capability cards

#### 1. Run tasks in real workspaces
Launch work against a selected workspace or repository. Ender can inspect files, update content, and execute local commands inside the working environment.

#### 2. Supervise execution live
Watch logs, transcript updates, and tool activity as the task runs. Resume later from persisted thread history instead of losing context.

#### 3. Approve sensitive actions
Keep a human in the loop for impactful operations like pushes, external writes, risky commands, and other approval-gated actions.

#### 4. Launch guided workflows
Use structured workflows to gather inputs before work starts. Ender’s UI renders workflow steps from server-defined contracts.

#### 5. Automate recurring work
Schedule new prompts, thread continuations, or workflow runs on a cron cadence without leaving the Ender system.

#### 6. Run across multiple model backends
Use OpenAI, AWS Bedrock, Azure OpenAI, or Ollama depending on your environment and deployment needs.

---

## Tool Ecosystem Section

### Section heading
- **A real tool surface, not just prompt orchestration**

### Intro copy

Ender can work across local files, shell commands, source control, project systems, knowledge systems, communication channels, and the web.

### Category grid copy

#### Workspace & Files
Read, write, list, and verify files inside the active workspace.

#### Shell & Local Execution
Run local commands for inspection, testing, builds, and verification.

#### Web & Browser
Fetch raw content, search the web, extract readable pages, inspect images, and capture rendered pages.

#### Git & Repositories
Clone repositories, inspect status, stage changes, commit, pull, and push with approval where needed.

#### GitHub & GitLab
Inspect repositories and review flows, create pull requests or merge requests, and comment on active work.

#### Jira & Knowledge Systems
Work across Jira, Confluence, and Google Drive to connect execution with planning and documentation.

#### Email & Communication
Inspect recent email context and send outbound messages with operator approval.

#### Scheduling & Delegation
Create recurring schedules and delegate sub-work to child threads.

### Section CTA
- Explore the tools

---

## How Ender Works Section

### Section heading
- **How Ender works**

### Step 1
**Choose a workspace or repo**

Start in a real working environment. Ender can operate inside a selected workspace, repository, or project directory.

### Step 2
**Start a task or workflow**

Launch a direct task from a prompt or use a guided workflow to gather structured inputs before execution begins.

### Step 3
**Watch execution and approve sensitive actions**

Follow live logs and transcript updates. When an action has external or persistent consequences, Ender can pause for approval.

### Step 4
**Resume later or automate with schedules**

Threads persist on disk, so work can be resumed after interruption. Repeated work can be automated with cron-backed schedules.

---

## Workflows Section

### Section heading
- **Structured workflows for repeatable operational tasks**

### Body copy

Ender supports server-defined workflows that gather structured inputs before work begins. The UI renders workflow steps from shared contracts, making workflows consistent and operator-friendly.

### Built-in workflow highlight

**Built-in today: `jira_to_repo_task`**

This workflow can guide an operator through:
- selecting a Jira project
- selecting a Jira board
- selecting a Jira issue
- specifying a repository to clone
- choosing commit and push behavior
- choosing the final Jira outcome
- starting a task in the repository

### Supporting statement

Ender’s current built-in workflow catalog is focused, but the workflow architecture is extensible.

---

## Automation Section

### Section heading
- **Recurring automation with operator-grade control**

### Body copy

Ender supports cron-backed recurring schedules that stay inside the same operational system as live tasks and workflows.

### Schedule target types
- **Prompt** — start a new task from a stored prompt
- **Thread** — continue an existing thread with a new prompt
- **Workflow** — run a workflow with stored inputs

### Supporting statement

Schedules are persisted on disk, visible in the UI, and designed to work with the same supervision model as the rest of Ender.

---

## Safety Section

### Section heading
- **Human-in-the-loop by design**

### Body copy

Ender is built to keep operators in control when actions have external or persistent consequences. Instead of hiding execution behind a black box, Ender makes work visible and can pause for approval before sensitive actions happen.

### Example approval-gated actions
- risky shell commands
- git push
- pull request or merge request creation
- Jira transitions and comments
- Confluence writes
- Google Drive writes
- email sending
- self-update apply

### Supporting statement

This is a core product behavior, not an afterthought.

---

## Deployment Section

### Section heading
- **Local-first deployment**

### Body copy

Ender runs locally or against a reachable Ender API server. It exposes a local API, provides a browser UI and Electron desktop app, and stores threads, schedules, and workflow sessions on disk.

### Deployment bullets
- Local API for tasks, approvals, workflows, schedules, and health
- Browser UI and Electron desktop app built from the same frontend
- On-disk persistence for threads, schedules, and workflow sessions
- Practical deployment for local and operator-controlled environments

---

## Integrations and Providers Section

### Section heading
- **Works with the systems around your work**

### Model providers
- OpenAI
- AWS Bedrock
- Azure OpenAI
- Ollama

### Operational systems
- GitHub
- GitLab
- Jira
- Confluence
- Google Drive
- Email
- Web and browser tooling

---

## Differentiation Section

### Section heading
- **Why Ender is different**

### Comparison bullets
- Not just a chat interface
- Not just background autonomy with no visibility
- Not just workflow forms without runtime depth
- Combines runtime, supervision, tools, persistence, workflows, and automation in one system

---

## Footer CTA Section

### Heading
- **Ready to run real agent work with operator control?**

### Supporting copy

Start with the docs, explore the code, or run Ender locally to see how supervised agent operations work in practice.

### CTAs
- Get Started
- Read the Docs
- View on GitHub

---

## Notes for the Implementer

- Use real screenshots wherever possible.
- Do not replace concrete capability language with generic AI marketing language.
- Keep the tool ecosystem visible on the homepage.
- Keep the local-first and approval-driven model explicit.
