# Ender Product / Platform Page Copy Deck

This document provides implementation-ready copy guidance for the Product or Platform page.

---

## Page Goal

Explain Ender as a complete product system, not just a UI or a model wrapper.

A visitor should leave this page understanding that Ender combines:
- a local-first runtime
- an operator console
- a local API
- persistent threads and sessions
- workflows and schedules
- broad tool access
- multiple model backends

---

## Hero Section

### Heading
- **A local-first platform for supervised agent work**

### Subheading

Ender combines an iterative tool-calling runtime, an operator-facing control surface, a local API, guided workflows, recurring schedules, and durable on-disk state.

### Supporting paragraph

It is designed for teams and operators who want real agent capability without giving up visibility, control, or practical integration with the systems where work actually happens.

---

## Overview Section

### Heading
- **What Ender is**

### Body copy

Ender is a local-first agent runtime and operator console for real work. It can launch tasks in a selected workspace, stream execution live, pause for approvals, persist thread history, run structured workflows, and automate recurring work with schedules.

It is not just a chat interface and not just a background automation engine. It is an operational system for running and supervising agent work.

---

## Runtime Model Section

### Heading
- **Runtime model**

### Body copy

At the core of Ender is an iterative tool-calling loop. A task runs until it is completed, stalled, canceled, or reaches a configured step cap. During execution, Ender can inspect files, call tools, gather information, and take action inside the boundaries of the configured environment.

### Key bullets
- Iterative tool-calling execution loop
- Live logs and transcript updates
- Approval checkpoints for sensitive actions
- Durable task threads that can be resumed later

---

## Operator Console Section

### Heading
- **Built for operators, not black boxes**

### Body copy

Ender’s interface is designed around supervision. Operators can launch tasks, watch execution unfold, inspect tool activity, review pending approvals, and continue work from persisted thread history.

The same frontend powers both the browser UI and the Electron desktop app.

### Supporting bullets
- Live task supervision
- Approval handling
- Workflow launch and progression
- Schedule creation and management
- Persistent thread browsing

---

## Persistence Section

### Heading
- **Durable state across tasks, workflows, and automation**

### Body copy

Ender persists operational state to disk so work does not disappear when a session ends. Threads, schedules, and workflow sessions are stored as JSON and reloaded by the runtime.

### Persisted entities
- Task threads
- Schedules
- Workflow sessions

### Why it matters

This makes Ender practical for real operational use, where work often spans multiple sessions, interruptions, and follow-up actions.

---

## Workflows Section

### Heading
- **Structured workflows for repeatable launch patterns**

### Body copy

Ender supports server-defined workflows that gather structured inputs before work begins. The UI renders workflow steps from shared contracts, which keeps the workflow experience consistent while allowing the backend to define the logic.

### Built-in workflow highlight

The current built-in workflow, `jira_to_repo_task`, guides an operator from Jira issue selection to repository setup and task launch.

### Supporting statement

The built-in workflow catalog is currently focused, but the workflow architecture is extensible.

---

## Schedules Section

### Heading
- **Recurring automation inside the same operational system**

### Body copy

Ender supports cron-backed schedules for recurring work. A schedule can start a new prompt, continue an existing thread, or run a workflow with stored inputs.

### Why it matters

Automation does not live outside the product. It uses the same runtime, visibility model, and persisted state as interactive work.

---

## Desktop App Section

### Heading
- **Browser and desktop surfaces**

### Body copy

Ender ships a browser UI and an Electron desktop app built from the same frontend. This gives operators flexibility in how they run and supervise work while keeping the product experience consistent.

---

## API Surface Section

### Heading
- **A local API for operational control**

### Body copy

Ender exposes a local API for tasks, approvals, workflows, schedules, health, and workspace browsing. This makes the runtime inspectable and gives the UI a clean operational interface.

### API areas to mention
- tasks and task logs
- approvals
- workflows and workflow sessions
- schedules
- health and readiness
- workspace browsing
- self-update status and operations when applicable

---

## Deployment Model Section

### Heading
- **Local-first by design**

### Body copy

Ender is designed for local and operator-controlled environments. It runs locally or against a reachable Ender API server, stores operational state on disk, and supports both browser and desktop usage.

### Supporting bullets
- Local-first runtime
- On-disk persistence
- Browser UI and Electron app
- Practical for technical teams and operator-led workflows

---

## Integrations and Providers Section

### Heading
- **Model flexibility and operational reach**

### Model providers
- OpenAI
- AWS Bedrock
- Azure OpenAI
- Ollama

### Operational integrations
- GitHub
- GitLab
- Jira
- Confluence
- Google Drive
- Email
- Web and browser tooling

### Supporting statement

Ender is designed to work where real tasks happen: codebases, project systems, documentation systems, communication channels, and the web.

---

## Closing CTA Section

### Heading
- **Explore the runtime, tools, and workflows**

### Copy

If you want supervised agent operations with real tool access, durable state, and practical automation, Ender is built for that model.

### CTAs
- Explore Tools
- Read the Docs
- View on GitHub
