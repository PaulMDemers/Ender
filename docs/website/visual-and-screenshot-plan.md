# Ender Visual and Screenshot Plan

This document defines the visual proof and screenshot requirements for the rebuilt Ender site. Maintained product images are copied from deterministic Playwright baselines so documentation cannot silently drift away from the tested interface.

---

## Goal

The site should feel grounded in the real product. Visuals should prove that Ender is an operational system, not just a concept.

---

## Visual Priorities

1. Show the real UI
2. Show active operational states
3. Show supervision and approvals
4. Show workflows and schedules
5. Show both browser and desktop surfaces

---

## Maintained asset manifest

Run `npm run docs:screenshots:sync` after an intentional visual-baseline update. Do not edit the documentation copies independently.

| Documentation asset | Tested source baseline | Current use |
| --- | --- | --- |
| `console-overview.png` | `app-shell-chromium-darwin.png` | Documentation overview |
| `new-task-full.png` | `app-shell-chromium-darwin.png` | README launch surface |
| `hero-thread-view.png` | `thread-transcript-chromium-darwin.png` | README/product thread view |
| `approval-thread-view.png` | `approval-card-chromium-darwin.png` | Approval proof |
| `workflow-list.png` | `workflow-list-chromium-darwin.png` | Workflow catalog |
| `workflow-step-view.png` | `workflow-form-state-chromium-darwin.png` | Guided workflow input |
| `schedule-manager-view.png` | `schedule-editor-open-chromium-darwin.png` | Schedule editor |
| `schedule-ledger-detail.png` | `schedule-panel-chromium-darwin.png` | Schedule collection/detail |

The previous JPEG set showed the pre-redesign shell and has been retired. PNG preserves the exact browser baseline without a second lossy conversion.

## Required Screenshot Types

### 1. Main task thread view

What to show:
- Conversation transcript
- compact live work summary
- task context
- recoverable tool detail, or the All activity view where detailed events are the subject

Why it matters:
- This is the clearest proof that Ender is an operator console for live work.

### 2. Approval UI

What to show:
- pending approval state
- action summary
- approve / deny controls

Why it matters:
- Approval-gated actions are one of Ender’s strongest differentiators.

### 3. Workflow runner UI

What to show:
- a structured workflow step
- form or select controls
- visible workflow progression

Why it matters:
- This proves that Ender supports guided workflows, not just freeform prompting.

### 4. Schedule creation UI

What to show:
- schedule target selection
- cadence or cron configuration
- visible schedule management controls

Why it matters:
- This proves recurring automation is part of the product.

### 5. Desktop app window

What to show:
- the Electron app running the same operator experience

Why it matters:
- This proves Ender is multi-surface and not just a browser-only concept.

### 6. Optional architecture diagram

What to show:
- local API server
- runtime loop
- browser UI
- Electron app
- persistence for threads, schedules, workflow sessions
- integrations and providers

Why it matters:
- Helps technical evaluators understand the system quickly.

---

## Screenshot Usage by Page

### Homepage
- main task thread
- approval UI
- workflow UI
- schedule UI
- desktop app

### Product page
- task thread
- desktop app
- optional architecture diagram

### Tools page
- task thread with visible tool activity if possible

### Workflows page
- workflow runner UI

### Automation page
- schedule creation UI

### Safety page
- approval UI
- task thread with logs

### Architecture page
- architecture diagram
- task thread or system screenshot

---

## Visual Style Guidance

- Prefer real screenshots over abstract illustrations.
- Use captions that explain what the operator is seeing.
- Keep the visual tone technical, operational, and trustworthy.
- Avoid generic AI imagery that weakens the product’s credibility.

---

## Caption Guidance

Captions should explain the operational significance of the screenshot.

Examples:
- Watch live task execution, tool activity, and transcript updates in one operator view.
- Review sensitive actions before they happen with approval-gated execution.
- Launch structured work with guided workflow steps.
- Configure recurring automation for prompts, threads, or workflows.

---

## Notes for the Implementer

- Refresh the deterministic Playwright baseline first, inspect it, then run `npm run docs:screenshots:sync`.
- Prioritize real product states over polished mockups.
- If a state must be staged, keep it realistic and consistent with the actual UI contract.
