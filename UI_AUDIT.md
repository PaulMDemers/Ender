# Ender UI audit and simplification brief

Date: 2026-07-18
Status: audit complete; recommendations implemented through ROADMAP milestones H2-H5

This brief records the pre-implementation findings and target hierarchy. See `UI_RELEASE_NOTES.md` for the delivered operator experience and `ROADMAP.md` for milestone verification.

Post-implementation validation uses connected browser runs and the current deterministic Playwright baselines. The stopped-instance note below is retained only as provenance for the original 2026-07-18 audit; it is not the current validation boundary.

## Executive verdict

Ender already exposes the right operational capabilities, but it gives too many of them permanent, card-level prominence. The result is a capable console that reads more like a polished prototype or product tour than a workstation used repeatedly throughout the day.

The primary problem is hierarchy, not missing functionality:

- Server identity and status are repeated in the rail, page header, and launch panel.
- The page header and launch panel both introduce the same task.
- Low-frequency configuration is presented beside the mission goal at nearly equal visual weight.
- Large radii, bright lavender copy, pills, gradients, borders, and generous padding make every region feel important.
- The 360-pixel rail and expanded header consume a large share of the initial viewport before the operator reaches the work.

The redesign should make Ender feel quieter, denser, and more deliberate while keeping every current capability within one or two interactions.

## Evidence reviewed

- The supplied 3276 by 1844 launch-screen capture.
- Current shell, navigation, launch-form, responsive, token, and server-diagnostics code.
- Deterministic visual baselines for the application shell, transcript, workflows, schedules, and editor dock.
- Existing accessibility and responsive contracts, including skip navigation, focus containment, focus restoration, visible focus styling, reduced-motion behavior, and 390-pixel containment tests.

The screenshot's `localhost:5544` instance was no longer running during the audit. The supplied capture and repository-owned deterministic browser baselines are therefore the visual evidence for connected surfaces. No schedules, connectors, credentials, or persisted runtime state were started for this audit.

## Product hierarchy

Ender should use frequency, urgency, and consequence to decide what stays visible.

### Always visible

- Current destination in human-readable form, with one connection-state indicator.
- Current page or selected thread.
- The main work surface: mission goal, transcript, editor, workflow, schedule list, or ledger.
- The primary action for that surface.
- Failures, approvals, blocked states, and degraded readiness that require action.

### Contextual or one interaction away

- Selected project and workspace.
- Runtime profile and memory mode.
- Thread status, last update, and workspace summary.
- Search, filtering, archive scope, and secondary actions.
- Editor connection controls when an editor session exists.

### On demand

- Raw server URL.
- UI/server versions and contract details.
- API exposure mode and backend name.
- Full readiness/capability grid.
- Server workspace path and self-update guidance.
- Connection credentials and direct editor URL.
- Explanatory copy for familiar controls.

This model preserves power while making exceptional conditions more visible than healthy diagnostics.

## Highest-impact findings

| Current treatment | Why it costs too much | Recommended treatment |
| --- | --- | --- |
| 360-pixel rail with large brand, server card, 2-by-2 navigation cards, archive card, and version footer | Permanent navigation consumes 25% of a 1440-pixel baseline and uses several stacked cards before the thread list begins | Use a 272- to 288-pixel rail, a compact brand row, a single target switcher row, 40-pixel list navigation, and archive/search controls in the thread-list toolbar |
| Expanded page header with title, description, controls, and four diagnostic cards | Versions, backend, and API mode are useful for diagnosis but not for every task launch | Use a 56- to 64-pixel command bar with page title, connection indicator, and server/settings action; move diagnostics to server management |
| Second launch hero inside the main panel | Repeats the page title and description immediately above it | Keep one page title only; begin the main surface with the mission input |
| Full Connected target side card | Repeats server identity, URL, workspace, self-update state, and healthy capabilities while taking a fixed 320-pixel column | Remove it from the default launch view; show a compact run-context row and surface only degraded readiness inline |
| Project and workspace fields always expanded | Important for some runs, but defaults make them low-frequency for many launches | Show a one-line `Run in` summary with Change; open a popover, drawer, or inline disclosure for project creation and path browsing |
| Long helper text under most fields | Makes routine use feel instructional and visually doubles field height | Keep short labels and examples; move durable explanation to contextual help or the expanded configuration surface |
| Large bordered empty/archive cards in the rail | Empty states and archive scope occupy space even when there is no content | Use a compact empty message and a filter/menu control; show counts in the thread-list heading |
| Pills and rounded cards for routine information | Too many capsule shapes create a soft, consumer-product feel and flatten hierarchy | Reserve pills for short statuses and filters; use restrained rows, dividers, and square-ended toolbars elsewhere |

## Proposed desktop structure

```text
┌──────────────────────────┬───────────────────────────────────────────────────────┐
│ Ender              [‹]   │ New task                           Local Ender ●  [⋯] │
│                          ├───────────────────────────────────────────────────────┤
│ + New task               │ Mission                                               │
│ Workflows                │ ┌───────────────────────────────────────────────────┐ │
│ Schedules                │ │ What should the agent accomplish?                 │ │
│ Task ledger              │ └───────────────────────────────────────────────────┘ │
│                          │ Run in  Ender · …/Desktop/Ender      [Change]         │
│ Threads              [⌕] │ Profile ACP default · Automatic memory [Settings]    │
│ No threads yet           │                                                       │
│                          │                                        [Start task]   │
│ [Active ▾]               │                                                       │
└──────────────────────────┴───────────────────────────────────────────────────────┘
```

Key behavior:

- The target name and status appear once in the command bar. Selecting them opens server management and full diagnostics.
- The launch surface contains one title, one mission field, two compact context summaries, and one primary action.
- `Change` reveals project, workspace, project creation, and browsing without navigating away.
- `Settings` preserves backend/profile and memory controls.
- Healthy readiness stays quiet. A degraded capability appears beside the affected action with a direct path to details.
- On wide screens, optional detail can use a temporary right drawer. It should not reserve a permanent column.

## Launch-surface recommendations

### Default state

The default launch path should contain:

1. Page title: `New task`.
2. Mission textarea, focused on entry.
3. Compact project/workspace summary.
4. Compact profile/memory summary.
5. Start action and existing Enter/Shift+Enter behavior.

This reduces the normal task launch from a long configuration form to a focused command surface without changing the submitted data.

### Expanded context

The context disclosure should retain:

- Project selection and project creation.
- Workspace path and directory browser.
- The rule that a project can prepare a missing workspace.
- Profile/backend selection.
- Memory mode.

Use local disclosure instead of a modal for simple edits; use a right drawer only if project creation and directory browsing need more room. Keep the selected summary visible when the disclosure closes.

### Readiness and server state

- Do not show four healthy readiness chips on every launch.
- Block or warn at the affected action when a required capability is unavailable.
- Keep the full readiness matrix, timestamps, contracts, API exposure, version comparison, and self-update guidance in server management.
- Keep one persistent connection indicator because loss of the server affects the entire console.

## Shell recommendations

### Left rail

- Target width: 272 to 288 pixels expanded; 44 to 48 pixels collapsed.
- Replace the 50-pixel logo plus marketing copy with a 40- to 44-pixel brand row. The full product description belongs in the connection/empty experience, not the working shell.
- Replace the current server card with one row: status dot, friendly server name, and disclosure affordance.
- Replace the 2-by-2 navigation cards with a vertical list. The labels are familiar after first use; descriptions can be tooltips or omitted.
- Let the thread collection receive most of the rail's height.
- Put thread search, active/archive scope, and counts in one collection toolbar.
- Move the version footnote to About or server diagnostics.

### Top command bar

- Target height: 56 to 64 pixels in standard views and no more than 72 pixels with a second status row.
- Keep one page title or truncated thread goal.
- Keep connection status, server switcher, and surface-specific primary actions.
- Put versions, runtime, API access, raw workspace, and capability detail in server management.
- Avoid a collapse control for a header that is already compact; the best default should not require housekeeping.

### Main canvas

- Remove decorative outer panels when the page background already establishes the region.
- Use a content grid with 16-pixel gutters and a sensible reading-width limit for prose, while allowing transcript/editor/table surfaces to fill available space.
- Prefer a divider or background step over a rounded container around every group.
- Keep primary actions near their inputs rather than at the remote bottom-right corner of a large card.

## Theme maturity

The purple-on-charcoal identity is worth keeping. The visual system should use it with more restraint.

### Color

- Use a darker neutral base and clearer surface steps, for example `#111318` for the canvas, `#171a21` for raised surfaces, and `#1d2029` for hover/selected neutral states.
- Keep near-white for headings and critical values only. Use neutral gray for body copy rather than lavender across the whole interface.
- Suggested roles: primary text near `#ececf2`, secondary near `#a7adbb`, quiet metadata near `#737b8c`.
- Retain purple as the brand and selection color, but reserve saturated purple for the primary action, focus, active navigation, and high-value accents.
- Use green, amber, and red only for real state. Healthy state should be legible without glowing or dominating.

### Shape and elevation

- Reduce the current 24/18/14-pixel radius system to approximately 12/10/8 pixels.
- Use 999-pixel rounding only for compact statuses, segmented filters, and avatars—not general buttons and containers.
- Remove ambient gradients and most shadows. Use one-pixel dividers, small surface-value changes, and selective elevation for overlays.
- Standardize controls around 36 or 40 pixels; reserve larger controls for touch-first or primary composing actions.

### Typography

- Replace the rounded/display quality of Space Grotesk in dense operational UI with a neutral system sans or Inter-like family. A brand wordmark can remain distinctive.
- Keep IBM Plex Mono for URLs, IDs, paths, timestamps, and log data—not navigation descriptions or general metadata.
- Reduce uppercase, widely tracked labels. Use them sparingly for true section markers, not every routine property.
- Tighten body line height and shorten helper copy before reducing font size.

### Spacing

- Keep the existing 4-pixel base, but make 8, 12, and 16 pixels the common working intervals.
- Use 20 to 24 pixels for page-level separation only.
- Preserve generous space around the active mission/transcript; remove it around repeated metadata and navigation.

## Other surface findings

### Thread workspace

The transcript baseline is closer to the desired density than the launch screen. Its collapsed routine events and chronological structure are useful. The redesign should:

- Maximize transcript/editor width and vertical space.
- Keep thread state, approval requirement, and last activity in a compact toolbar.
- Keep raw-markdown and activity filters secondary.
- Avoid repeating the selected thread's metadata in the rail, header, and transcript chrome.
- Make approval-required states visually stronger than healthy connection state.

### Workspace editor

The editor viewport should dominate. Connection state, password, port, direct URL, and launch mode are setup details after connection succeeds.

- Keep editor status and Stop/Close as a compact toolbar.
- Move credentials and direct URL into `Connection details`.
- Remove the large metadata-card grid from the normal connected state.
- Preserve copy actions and fallback URL access.

### Workflows

The individual workflow cards are already relatively compact. The full surface should use a master-detail pattern:

- Searchable workflow list on the left or top.
- Selected workflow steps and parameters in the main pane.
- Advanced/debug output disclosed on demand.
- Start action remains visible while configuration scrolls.

### Schedules

The four summary metrics are only valuable when they change a decision.

- Use a compact toolbar with total/enabled counts.
- Surface `Needs review` as an attention filter when nonzero.
- Move `Never run` into filtering or row metadata.
- Use a dense list/table with a detail drawer for target, prompt, history, pause/recovery, and editing.

### Task ledger

- Favor a searchable, sortable list/table over nested cards.
- Keep lifecycle and outcome visible in the row.
- Move history, tags, target detail, and advanced creation fields into a detail pane or disclosure.
- Preserve the existing lifecycle semantics and server-managed queue controls.

### Server management

Server management is the correct home for the information removed from the shell:

- Friendly target name and endpoint.
- Connection history and last health check.
- UI/server/contract compatibility.
- Runtime backend and API exposure.
- Workspace root and readiness matrix.
- Self-update status and guidance.
- Saved/favorite endpoints and retry/removal actions.

No diagnostic capability needs to be removed.

## What should not be removed

- Multi-server switching and saved targets.
- Project selection, project creation, workspace override, and directory browsing.
- LLM profile/backend and memory controls.
- Full readiness, contract, version, API-exposure, and self-update diagnostics.
- Workflows, schedules, ledger lifecycle, editor fallback access, approvals, archive scope, or focus mode.
- Existing keyboard behavior, accessible focus management, responsive containment, polling behavior, and status semantics.

The redesign is an information-architecture change, not a reduction in system capability.

## Phased implementation plan

### H2 — Work-first shell, launch path, and foundation tokens

Priority: highest

1. Introduce the compact command bar and 272- to 288-pixel list-based rail.
2. Consolidate server state to one default-visible target control.
3. Remove the duplicate launch hero and permanent Connected target card.
4. Replace expanded project/workspace/profile controls with summary rows and progressive disclosure.
5. Apply the mature color, radius, typography, control-height, border, and spacing foundation.
6. Update desktop, narrow, keyboard, and visual-regression coverage.

Acceptance criteria:

- At 1440 by 900, the mission field, run-context summary, and enabled Start action fit without page scrolling.
- The standard command bar is at most 64 pixels high, or 72 pixels when a contextual status row is required.
- The expanded desktop rail is at most 288 pixels wide.
- Server endpoint, versions, runtime, API access, and full readiness are not permanently repeated in the default shell.
- Project, workspace, profile, and memory values remain visible as summaries and editable within one interaction.
- Degraded required capabilities appear at the affected action; healthy capability detail remains available in server management.
- The 390-pixel navigation and launch flows remain contained and keyboard accessible.
- Existing start payloads, server switching, diagnostics, directory browsing, project creation, and shortcut behavior remain unchanged.

### H3 — Thread and editor workstation

1. Compact the thread toolbar and remove repeated metadata.
2. Prioritize transcript, approvals, and composer states.
3. Make the editor viewport primary and connection detail secondary.
4. Refine split, stacked, focus, and narrow layouts.

### H4 — Operational collections

1. Convert workflows, schedules, and ledger surfaces to consistent master-detail/list patterns.
2. Make filters and attention states more prominent than passive metrics.
3. Standardize detail drawers, destructive actions, empty states, and dense row behavior.

### H5 — Final cohesion and validation

1. Audit copy, empty/loading/error states, and icon consistency.
2. Check contrast, zoom, keyboard order, reduced motion, and coarse pointers.
3. Refresh intentional visual baselines and perform desktop plus narrow in-app visual QA.
4. Validate the complete production build and browser matrix.

## Decision summary

The strongest first move is not a broad reskin. It is a structural pass that removes repeated information, makes the normal launch path compact, and assigns diagnostics to server management. Applying the more restrained token system in the same milestone will let the new hierarchy read correctly. Thread/editor and automation surfaces can then inherit the foundation without another visual reset.
