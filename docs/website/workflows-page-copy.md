# Ender Workflows Page Copy Deck

This document provides implementation-ready copy for the Workflows page.

---

## Page Goal

Explain how Ender handles structured, guided work and how workflows fit into the broader runtime.

A visitor should understand that:
- Ender supports server-defined workflows
- workflows gather structured inputs before work begins
- the UI renders workflow steps from shared contracts
- the current built-in workflow catalog is focused but real
- the workflow architecture is extensible

---

## Hero Section

### Heading
- **Structured workflows for repeatable operational tasks**

### Subheading

Ender supports guided workflows that gather structured inputs before execution begins, helping operators launch repeatable work with more consistency and less guesswork.

---

## Overview Section

### Heading
- **What workflows are in Ender**

### Body copy

Workflows in Ender are server-defined state machines that guide an operator through a sequence of structured steps before a task is launched or completed. The UI renders these steps from shared contracts, which keeps the experience consistent while allowing the backend to define the logic.

### Supporting bullets
- Server-defined workflow logic
- UI-rendered workflow steps
- Structured input gathering before execution
- Consistent operator experience across workflows

---

## Why Workflows Matter Section

### Heading
- **Why workflows matter**

### Body copy

Not every task should start from a blank prompt. Some operational tasks benefit from a guided launch flow that gathers the right inputs in the right order. Workflows help reduce ambiguity, improve repeatability, and connect task execution to upstream systems like Jira.

---

## Workflow Step Model Section

### Heading
- **Workflow step model**

### Body copy

Ender’s UI renders workflow steps from shared contracts. Current step types include:
- `form`
- `select`
- `complete`

### Supporting explanation

This means the workflow engine can define the sequence and logic, while the UI remains generic and reusable.

---

## Workflow Modes Section

### Heading
- **Workflow modes**

### Body copy

Ender workflows can run in different modes depending on how they are being used.

### Modes to describe

#### Interactive
Used when an operator is actively stepping through the workflow in the UI.

#### Schedule configuration
Used when a workflow is being configured for recurring automation and some actions should be deferred until the scheduled run.

#### Scheduled run
Used when the workflow is executed by a schedule with stored inputs.

### Why this matters

This allows the same workflow architecture to support both interactive and automated operational patterns.

---

## Built-in Workflow Section

### Heading
- **Built-in today: Jira to repo task**

### Workflow ID
- `jira_to_repo_task`

### Body copy

Ender currently includes a built-in workflow that guides an operator from Jira issue selection to repository setup and task launch.

### Stages

#### 1. Project
Select the Jira project context.

#### 2. Board
Choose the relevant Jira board.

#### 3. Issue
Select the issue that should drive the work.

#### 4. Repo
Specify the repository to clone for the task.

#### 5. Delivery
Choose commit and push behavior for the resulting work.

#### 6. Jira outcome
Choose what should happen to the Jira issue after the task completes.

#### 7. Complete
Review the gathered inputs and launch the task.

### Supporting statement

This workflow is a concrete example of how Ender can connect planning systems, repository setup, and task execution in one guided flow.

---

## Extensibility Section

### Heading
- **Extensible by design**

### Body copy

Ender’s workflow architecture is designed to support additional workflows over time. The current built-in catalog is focused, but the underlying model is not limited to a single flow.

### Important wording guidance

Do not imply that Ender already ships a large built-in workflow library. The correct message is that Ender is workflow-capable today and extensible going forward.

---

## Relationship to Tasks and Schedules Section

### Heading
- **Workflows, tasks, and schedules work together**

### Body copy

Workflows are not separate from the rest of Ender. They are one way to launch and structure work inside the same runtime. Workflow sessions can persist on disk, and workflows can also be used as schedule targets for recurring automation.

---

## Closing CTA Section

### Heading
- **Use workflows when the launch path matters**

### Copy

If your work depends on gathering the right inputs before execution starts, Ender’s workflow model gives you a structured way to do it without losing the flexibility of the underlying runtime.

### CTAs
- Explore Automation
- Read the Docs
- View on GitHub
