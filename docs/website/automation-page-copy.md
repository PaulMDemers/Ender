# Ender Automation Page Copy Deck

This document provides implementation-ready copy for the Schedules & Automation page.

---

## Page Goal

Explain Ender’s recurring automation model clearly and concretely.

A visitor should understand that:
- Ender supports cron-backed schedules
- schedules are part of the same operational system as tasks and workflows
- schedules are persisted on disk
- schedules can target prompts, threads, and workflows

---

## Hero Section

### Heading
- **Recurring automation with operator visibility**

### Subheading

Ender supports cron-backed schedules for recurring work, without separating automation from the same runtime, supervision model, and persisted state used for live tasks.

---

## Overview Section

### Heading
- **What automation means in Ender**

### Body copy

Automation in Ender is built around schedules. A schedule stores a target, a cadence, and the inputs needed to run recurring work. Instead of living outside the product, schedules operate inside the same system as tasks and workflows.

---

## Why It Matters Section

### Heading
- **Why this matters**

### Body copy

Recurring work should not require a separate automation stack if it depends on the same runtime, tools, and operator model as interactive work. Ender keeps automation inside the same operational surface.

---

## Schedule Model Section

### Heading
- **Schedule model**

### Body copy

Schedules in Ender are cron-backed and persisted to disk. They can be created, listed, updated, run manually, and deleted through the product’s operational interfaces.

### Key points
- Cron-backed recurring execution
- Persisted schedule definitions
- Visible in the UI
- Part of the same runtime as tasks and workflows

---

## Schedule Target Types Section

### Heading
- **Three schedule target types**

### Prompt target

A prompt schedule starts a new task from a stored prompt on a recurring cadence.

### Thread target

A thread schedule continues an existing thread with a new prompt, allowing recurring follow-up work inside an existing context.

### Workflow target

A workflow schedule runs a workflow with stored inputs, making structured recurring work possible.

---

## Persistence Section

### Heading
- **Persisted and resumable**

### Body copy

Schedules are stored on disk so they survive restarts and remain part of Ender’s durable operational state. This makes recurring work manageable and inspectable over time.

---

## Operator Control Section

### Heading
- **Automation without losing control**

### Body copy

Ender’s automation model is designed to preserve visibility. Schedules are not hidden background jobs disconnected from the operator experience. They are part of the same system that supports live tasks, approvals, workflows, and persistent history.

---

## Example Use Cases Section

### Heading
- **Example use cases**

### Examples
- run a recurring weekday prompt to inspect a workspace
- continue a long-running thread every morning with a follow-up instruction
- run a workflow on a schedule using stored inputs
- automate repeatable operational checks without leaving the Ender environment

---

## Relationship to Workflows Section

### Heading
- **Automation and workflows fit together**

### Body copy

Because workflows can be schedule targets, Ender can automate structured operational flows instead of only freeform prompts. This is especially useful when recurring work depends on predefined inputs and repeatable launch logic.

---

## Closing CTA Section

### Heading
- **Automate recurring work without leaving the runtime**

### Copy

If your team needs recurring prompts, thread continuation, or workflow execution with operator-grade visibility, Ender’s schedule model is built for that.

### CTAs
- Explore Workflows
- Read the Docs
- View on GitHub
