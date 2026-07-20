# Ender operator interface redesign

Date: 2026-07-20
Status: validated

## Overview

Ender's operator interface is now organized as a focused workstation rather than a permanently expanded configuration dashboard. The redesign keeps the existing launch, supervision, automation, server-management, and recovery capabilities while giving everyday work the most space and moving low-frequency detail behind contextual controls.

No REST, SSE, persistence, workflow, schedule, task-ledger, or task-launch contract changed as part of this redesign.

## What operators will notice

### Shell and server management

- The desktop thread rail is narrower and uses a compact vertical navigation list.
- The command bar stays close to 56 pixels tall and identifies the current destination or thread without repeating page introductions.
- One server target control shows connection state and opens the existing connection manager, health details, versions, API exposure, runtime capabilities, and recovery actions.
- Archive scope now belongs to the thread collection instead of occupying a permanent footer card.

### Starting work

- A new task starts with the mission field, compact run-context and run-settings summaries, and the Start task action.
- Project selection, project creation, workspace browsing, profile selection, and memory mode remain available through Change and Settings disclosures.
- Healthy diagnostics stay quiet. Missing launch prerequisites appear next to the affected launch action.
- Existing Enter-to-start and Shift+Enter-for-new-line behavior is preserved.

### Threads, approvals, and editor sessions

- The transcript is the primary work surface. Conversation combines each turn's model-authored progress and tool work into one live summary, while All activity preserves the complete provider-neutral event stream.
- Tool calls have stable names and normalized pending, running, completed, or failed states; missing provider statuses no longer render as `undefined`.
- Internal model-invocation phases remain operational detail and are not presented as assistant speech.
- The follow-up composer no longer repeats thread IDs, workspaces, or status already visible in the command bar.
- Approval requests keep Approve and Deny visible while request IDs, timestamps, and raw payloads stay behind Review request details.
- Editor credentials, ports, and direct URLs remain available through Connection; the editor viewport receives the default space.
- Responsive Transcript and Editor tabs support arrow-key navigation and controlled tab panels.

### Workflows, schedules, and task ledger

- Workflows use a dense full-width catalog; active-session recovery and debug history remain contextual.
- Schedules open on the collection. New schedule and Edit reveal the full recurring-run editor only when needed.
- Task ledger opens on the queue. New entry reveals structured request, source, constraints, verification, and auto-run controls.
- Schedule and ledger rows keep meaningful status and outcome information visible while identifiers, lifecycle history, workspaces, and other metadata live in details disclosures.

## Visual and interaction system

- The charcoal-and-purple identity remains, with darker neutral surfaces, restrained elevation, smaller radii, tighter spacing, and neutral body copy.
- Primary, secondary, quiet, success, warning, and danger colors have explicit roles; routine healthy state no longer dominates the canvas.
- Core text and primary-action contrast meet the browser-tested thresholds.
- Visible keyboard focus, skip navigation, modal focus containment, focus restoration, reduced-motion behavior, and coarse-pointer targets are retained across the redesign.
- Desktop, 640-pixel zoom-equivalent, and 390-pixel layouts prevent document-level horizontal overflow.

## Capability preservation

The redesign retains:

- project and workspace scoping, creation, and browsing
- LLM profile and memory selection
- multimodal follow-up attachments
- workflow recovery and scheduled workflow configuration
- schedule create, edit, enable, disable, run-now, delete, and outcome review
- ledger filtering, structured requests, lifecycle inspection, manual dispatch, and linked-thread navigation
- server switching, saved endpoints, health refresh, contract/version diagnostics, and degraded-state recovery
- docked, modal, stacked, and direct-tab workspace editor access

## Verification

- synchronized version metadata
- documentation validation across 68 Markdown files, including maintained docs and historical wiki/raw link integrity
- all 128 backend tests
- JavaScript/TypeScript typechecking and syntax checks
- production UI build
- all 58 Playwright browser tests, including dedicated conversation/activity reconciliation, provider/model selection, contrast, focus, reduced-motion, coarse-pointer, zoom-equivalent, and narrow empty-state contracts
- connected visual QA against a disposable isolated Ender API at desktop, 640 by 900, and 390 by 844 viewports
- visual inspection of eight documentation screenshots synchronized from deterministic Playwright baselines
