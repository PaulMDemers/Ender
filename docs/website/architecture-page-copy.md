# Ender Architecture / How It Works Page Copy Deck

This document provides implementation-ready copy for the Architecture or How It Works page.

---

## Page Goal

Explain Ender’s system model in a way that technical evaluators can understand quickly.

A visitor should understand that Ender combines:
- a local API server
- an iterative tool-calling runtime
- a browser UI and Electron desktop app
- on-disk persistence
- workflow and schedule managers
- live log streaming
- readiness and health reporting

---

## Hero Section

### Heading
- **How Ender works**

### Subheading

Ender combines a local API server, an iterative tool-calling runtime, a browser and desktop operator console, and durable on-disk state for threads, schedules, and workflow sessions.

---

## System Overview Section

### Heading
- **System overview**

### Body copy

Ender is a local-first operational system for agent work. The backend runtime manages tasks, workflows, schedules, approvals, and persistence. The frontend provides the operator experience in both browser and desktop form.

---

## Runtime Loop Section

### Heading
- **Iterative runtime loop**

### Body copy

At the core of Ender is an iterative tool-calling loop. A task runs until it is completed, stalled, canceled, or reaches a configured step cap. During execution, the runtime can call tools, inspect results, and continue working toward the task goal.

### Key points
- iterative execution
- tool-calling runtime
- completion, stall, cancel, or cap outcomes
- approval pauses when needed

---

## API Surface Section

### Heading
- **Local API surface**

### Body copy

Ender exposes a local API for the operational surfaces that matter: tasks, logs, approvals, workflows, workflow sessions, schedules, health, and workspace browsing.

### API areas
- tasks and messages
- task logs and streaming
- approvals
- workflows and workflow sessions
- schedules
- health and readiness
- workspace browsing
- self-update status and operations when applicable

---

## UI Surfaces Section

### Heading
- **Browser and desktop operator surfaces**

### Body copy

The same frontend powers Ender’s browser UI and Electron desktop app. This gives operators a consistent experience across environments while keeping the product centered on supervision and operational control.

---

## Persistence Section

### Heading
- **On-disk persistence**

### Body copy

Ender persists key operational state to disk as JSON. This includes task threads, schedules, and workflow sessions.

### Why it matters

Durable state makes Ender practical for real work that spans multiple sessions, interruptions, and follow-up actions.

---

## Workflow Engine Section

### Heading
- **Workflow engine**

### Body copy

Ender supports server-defined workflows that guide operators through structured steps before work begins. The UI renders workflow steps from shared contracts, which keeps the frontend generic while allowing the backend to define workflow logic.

---

## Schedule Engine Section

### Heading
- **Schedule engine**

### Body copy

Ender’s schedule engine manages cron-backed recurring automation. Schedules can target new prompts, existing threads, or workflows with stored inputs.

---

## Live Streaming Section

### Heading
- **Live logs and streaming execution**

### Body copy

Task execution is streamed to the operator interface so work remains visible while it is happening. This supports supervision, debugging, and approval handling.

---

## Readiness and Health Section

### Heading
- **Readiness and health reporting**

### Body copy

Ender exposes health and readiness information so operators can understand whether model providers and integrations are configured correctly.

---

## Provider Support Section

### Heading
- **Provider support**

### Body copy

Ender supports multiple model backends, including OpenAI, AWS Bedrock, Azure OpenAI, and Ollama. This gives teams flexibility in how they deploy and operate the runtime.

---

## Deployment Model Section

### Heading
- **Deployment model**

### Body copy

Ender is designed for local and operator-controlled environments. It can run locally or against a reachable Ender API server, with browser and desktop interfaces layered on top.

---

## Closing CTA Section

### Heading
- **Explore the runtime in more detail**

### Copy

If you want a practical, inspectable, local-first system for supervised agent work, Ender’s architecture is built for that model.

### CTAs
- Read the Docs
- Explore Tools
- View on GitHub
