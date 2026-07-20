# Frontend Architecture

This document records the frontend boundaries established during the Ender modernization. Runtime behavior in the components remains the source of truth.

## Application shell

`ui/src/components/ApplicationShell.jsx` owns the outer responsive frame: skip navigation, the mobile navigation scrim, layout variants, and shared focus-containment wiring for the off-canvas navigation. It does not own server, task, workflow, schedule, ledger, or editor state.

The shell exposes stable landmarks:

- `#ender-navigation` is the complementary navigation rail.
- `#ender-main-content` is the keyboard-focusable main workspace.
- A skip link is the first keyboard stop and moves focus to the main workspace.
- The mobile navigation trigger reports its open state and controls the navigation landmark. Opening moves focus to the active primary destination; Tab stays within the drawer until selection or dismissal, and Escape restores focus to the trigger.

## Primary navigation

`ui/src/navigation.js` is the single ordered definition of top-level destinations:

1. New task
2. Workflows
3. Schedules
4. Task ledger

`ui/src/components/PrimaryNavigation.jsx` renders that model and exposes the active destination through `aria-current="page"`. Primary destinations remain visible instead of being hidden behind a launch-mode disclosure. Selecting a live thread intentionally clears the primary destination state because the thread ledger owns that selection.

The existing standalone task-ledger hash route remains compatible and outside the main shell.

## Server connection boundary

`ui/src/hooks/useServerConnection.js` owns server selection and runtime availability:

- active and saved endpoints under the existing `ender_api_base` and `ender_saved_servers` keys;
- initial connection, loading, error, connected-once, and explicit idle/checking/connected/unavailable state;
- health and runtime-catalog polling every 15 visible seconds, immediate foreground refresh, manual health refresh, check timestamps, and the last successful health snapshot;
- LLM profiles, the default profile, and projects;
- disconnect and reconnect notices;
- reactive REST/task-stream compatibility observations scoped to the active endpoint;
- connect, remove, favorite, and project-refresh operations.

Task data remains outside this hook. The thread poll reports only task-list success, failure, and initial-load completion. A reconnect invokes the latest task refresh callback through a ref, avoiding a dependency from the server boundary onto thread state or polling implementation.

Switching servers clears server-derived catalogs and contract observations before the next endpoint loads. `App.jsx` remains responsible for clearing task and workflow selection because those domains own that state.

`ui/src/components/ServerDiagnostics.jsx` and `ui/src/serverPresentation.js` provide the shared server-management vocabulary. The rail and modal expose UI/server versions, REST and stream contracts, local/open API exposure, connection freshness, runtime backend, workspace root, and required versus optional capabilities. A failed health request keeps the last successful snapshot visible but labels it stale; it never enables task/editor behavior because operational feature gates continue to use current health only.

`ServerPickerPanel` validates HTTP/HTTPS endpoints before mutating connection state, retains invalid inputs, and distinguishes saved, checking, connected, and unavailable endpoints. The offline shell can retry its last target directly. The server modal presents health and synchronization failures without requiring the operator to leave the manager.

The API contract tracker publishes observation changes and resets on endpoint changes. Missing legacy headers remain compatible, task-stream compatibility remains “not observed” until a stream advertises it, and newer server contracts are visible warnings rather than silent state or hard client-side blocks.

## Thread collection boundary

`ui/src/hooks/useTaskThreads.js` owns the server-scoped thread collection:

- the 3-second visible-document collection poll, immediate foreground refresh, and explicit refresh path;
- current selection and newest-thread fallback rules;
- active, archived, pinned, and paginated projections;
- `ender_task_ui_state` persistence keyed by server URL;
- collection reset, append, update, select, archive, pin, load-more, and metadata-removal operations.

The hook reports list reachability to `useServerConnection` through success, failure, and completion callbacks. The server reconnect callback reaches the latest collection refresh through a ref, so the hooks remain independently owned and do not restart each other's polling effects.

Task mutations remain orchestrated in `App.jsx`: launch, continue, rerun, terminate, delete, workflow handoff, and ledger handoff call the owning domain operation and then use explicit collection operations. Transcript entries, SSE status, and approvals remain owned by the existing `useTaskLogs` hook. The editor lifecycle belongs to `useThreadEditor` as described below.

## Automation boundary

`ui/src/hooks/useAutomations.js` owns workflow discovery and reload, interactive workflow sessions, saved-session recovery, workflow mutations, schedule discovery/reload, operation identity, mutation outcomes, and schedule mutations.

Interactive session IDs retain the existing `ender_workflow_sessions` storage contract and remain keyed by server URL. A null initial session no longer erases a recoverable saved session; explicit reset, invalid recovery, and completed task handoff clear it deliberately. Workflow completion returns a task ID to `App.jsx`, which refreshes the thread collection and selects the launched thread without moving thread ownership into the automation hook.

Workflow presentation combines catalog definitions with `health.workflows` readiness without changing the workflow API contract. Missing prerequisites disable launch but do not hide the affected workflow. `WorkflowPanel` remembers the last start, advance, or back operation so errors retry the exact structured input while the hook remains the source of session and error state.

Schedule mutations refresh the schedule collection inside the hook. Failed Run now operations also attempt a collection refresh because the server persists `lastRunStatus` and `lastRunMessage` before returning an error response. Form ownership stays in `SchedulePanel`: client validation runs before a mutation, failed creates/updates preserve every field, and the last mutation request remains available for an explicit retry. Run-now returns success to `App.jsx` so the thread collection can be refreshed through its own boundary.

## Task-ledger boundary

`ui/src/hooks/useTaskLedger.js` owns task-ledger entries, server capacity/poll metadata, initial loading, background refresh, mutation identity, errors/results, the 3-second visible-ledger poll, and create, run, delete, refresh, and reset operations.

Background polling is silent and does not disable controls. Ledger mutations refresh their own collection; a failed run also refreshes because the server may persist attempt and lifecycle failure state before returning an error. Creation and run-now return control to `App.jsx` for the explicit cross-domain thread refresh and selection handoff. The standalone ledger and the in-console ledger share this state owner.

`ui/src/taskLedgerPresentation.js` is the shared presentation vocabulary for operationally open and finished states, attention states, lifecycle stages, status tones, linked threads, searchable fields, outcome summaries, and queue-health counts. Failed, blocked, and input-required work remains in the default operational queue; completed and canceled work moves to finished history.

`TaskLedgerPanel` preserves all generic-task inputs behind progressive disclosure while owning validation, filters, and exact mutation retry context. Lifecycle progress and latest outcomes stay scan-level; criteria, plans, evidence, timestamps, and history are disclosed per entry. `SimpleTaskLedgerView` uses the same summaries, filtering, outcomes, retained-create recovery, and linked-thread handoff in the isolated route.

## Design system and responsive contract

`ui/src/design-tokens.css` is the shared source for color, surface, radius, spacing, control, focus, and motion variables. `styles.css` consumes those tokens and retains component and layout rules.

Shared primitives live under `ui/src/components/ui/`:

- `DisclosureButton` consistently reports `aria-expanded`, identifies controlled content, and supplies accessible labels.
- `StatusIndicator` consistently exposes connection state as a polite status region.

Keyboard focus uses a visible shared focus treatment. Reduced-motion preferences collapse animation and transition durations. Coarse-pointer controls receive a 44-pixel minimum target.

`ui/src/hooks/useFocusTrap.js` is the shared overlay keyboard contract. It captures the invoking control, chooses a deterministic initial target, contains forward and reverse Tab movement, dismisses on Escape, and restores focus when the surface unmounts. Server management and the modal editor attach the returned ref directly; the application shell targets the navigation landmark by ID.

`ui/src/hooks/visiblePolling.js` is the shared recurring-refresh scheduler. It preserves each domain's established cadence while the document is visible, prevents overlapping callbacks, clears the interval while hidden, and performs an immediate refresh before restarting when visibility returns. Explicit operator refreshes and mutations bypass this scheduler and remain available regardless of timer state.

Responsive behavior is progressive rather than feature-reducing:

- below 980 pixels, the navigation becomes an off-canvas surface and multi-column workspaces collapse to one column;
- below 720 pixels, headers, actions, metadata, editor controls, and composer controls stack;
- advanced ledger controls remain available behind an explicit disclosure;
- editor behavior retains its established split, modal, and stacked surfaces based on viewport width;
- a 390-pixel browser check guards against document-level horizontal overflow.

## Primary operator hierarchy

The default launch path in `NewTaskForm` presents the mission, project, and workspace first. Backend profile and memory behavior remain fully configurable through a labelled run-settings disclosure, with the current choices summarized while collapsed. Submitting from either state uses the same selected values.

`ThreadComposer` follows the same contract: the follow-up message and attachment actions remain primary, while profile and memory tuning are available through a controlled disclosure. Enter submits, Shift+Enter inserts a newline, and focus returns to the message field after a successful send.

Approval-required threads render one `role="alert"` decision surface. It remains sticky above the transcript and owns the only Approve and Deny controls. The composer is replaced with an explanatory blocked state until the decision is resolved, avoiding duplicate actions and contradictory affordances.

The transcript is exposed as a named region. Active progress is a polite live status, and the empty transcript state is announced without interrupting the operator.

## Thread navigation and transcript views

Thread search belongs to `useTaskThreads` because it is a projection of the complete server-scoped collection. It matches goal, ID, status, workspace, project, and profile before the 12-item pagination boundary, so an older matching thread is discoverable without repeatedly loading pages. Search state resets when the server changes and does not alter persisted pin/archive metadata.

Thread cards expose the selected item through `aria-current`, retain status and pinned state at scan level, surface pending approvals as an attention badge, and label the secondary Details disclosure. Destructive and lifecycle actions remain inside that disclosure.

`LogViewer` provides two reversible presentation modes:

- Conversation, the default, shows human and assistant messages plus one compact live work summary per user turn. The summary consolidates model-authored progress and tool activity, keeps approvals and actionable failures visible, and exposes recoverable tool detail without flooding the transcript.
- All activity shows the complete provider-neutral event stream, including model requests, paired tool calls and results, diagnostics, and timing.

Conversation mode reports how many detailed activity entries are available and provides a direct Show all action. Internal runtime phases such as model invocation are never represented as assistant speech. This is a presentation reduction only: source entries, timestamps, raw payloads, tool details, run metadata, and automatic scroll inputs remain intact. Long prose wraps within a readable measure, while code and tool payloads retain their own scroll containers.

## State and recovery feedback

`ui/src/components/ui/StateNotice.jsx` is the shared primary-path status surface. Neutral, warning, success, and danger tones share the same title/detail/action structure; danger notices use an assertive alert while non-error states use polite status announcements.

Recovery stays with the domain that owns the failed operation:

- `NewTaskForm` retains mission and execution settings and retries launch locally.
- `ThreadComposer` retains text, attachments, profile, and memory settings and retries the same follow-up locally.
- `App.jsx` invokes the thread collection refresh for thread-sync recovery.
- `useServerConnection` remains the source of connection transitions; `App.jsx` only presents its reconnect notice.
- `useThreadEditor` retains launch/stop/copy errors with the failed operation and owns the matching retry.
- `TaskLedgerPanel` and `SimpleTaskLedgerView` retain failed ledger requests and retry through `useTaskLedger`; failed dispatches keep their freshly persisted lifecycle outcome visible.

The empty transcript uses the same pattern to distinguish a run that has not emitted anything from a Conversation view whose only available entries are routine runtime activity. Server diagnostic messages are retained verbatim as notice detail.

Initial `null` health is treated as unchecked rather than offline. A reconnect notice requires a previously successful health check followed by a failed check and subsequent recovery; switching servers resets that transition history.

## State ownership

`ui/src/App.jsx` composes the domain hooks and owns cross-domain orchestration plus rail state. Overlay focus behavior belongs to the shared focus hook at the presenting component boundary. Moving one boundary at a time keeps polling, persistence, and mutation regressions isolated.

`ui/src/hooks/useThreadEditor.js` owns the selected thread's editor session boundary: visibility-aware 15-second discovery polling, launch/stop mutations, expected absent-session handling, visibility-aware iframe reachability probes and reloads, action recovery, credential-copy state, responsive surface selection, and dock resizing. `App.jsx` supplies only the active task identity and uses derived split/stacked state to coordinate the surrounding shell.

`ui/src/components/ThreadEditor.jsx` owns editor presentation. Docked, modal, and stacked surfaces share the same toolbar, progressively disclosed connection details, operation error notice, and frame waiting/retry treatment. Closing a surface preserves the server session; stopping the editor destroys the session. At 1180 pixels and above the preferred surface is a resizable dock, from 980 through 1179 it is modal, and below 980 it becomes a stacked transcript/editor workspace.

The editor frame does not treat iframe `onLoad` alone as readiness because browser error documents can also load. A same-origin proxy probe marks the endpoint reachable, triggers a fresh iframe load, and only then allows the surface to report `connected`. Operators can retry immediately or open the direct URL while automatic probing continues.

Each extraction should preserve the existing API client, polling cadence, local-storage keys, reconnect behavior, and task-selection rules until a separately scoped product change says otherwise.

## Verification contract

The application-shell browser suite covers:

- all four primary destinations and current-page state;
- skip-to-content focus behavior;
- responsive navigation opening, focus containment, Escape dismissal, and trigger restoration;
- connected empty-thread rendering;
- the offline-first server picker;
- the intentional desktop visual baseline.

The server-connection suite additionally covers:

- failed initial connection, explicit retry, unavailable saved-row state, and removal of an unreachable saved endpoint;
- switching endpoints and replacing server-derived catalogs;
- 15-second health and catalog polling, hidden-document suspension, and immediate foreground refresh;
- disconnect notices, recovery, and task refresh on reconnect;
- retained URL input after invalid-protocol validation;
- server/UI versions, newer-contract compatibility warnings, and open-access exposure warnings;
- last-known health snapshots plus manual retry and recovery;
- narrow modal containment plus initial-focus, Tab containment, Escape dismissal, and opener restoration.

The thread-collection suite covers:

- the 12-item page boundary and load-more behavior;
- pinned ordering, archive scope, and durable local metadata;
- isolation of metadata for the same thread ID on different servers;
- selection preservation across polls;
- failure clearing and newest-thread selection after recovery.

The automation and ledger suites additionally cover saved workflow recovery, readiness-aware workflow discovery and retry, structured workflow-step retry, schedule validation and input retention, create/edit/run/delete recovery, persisted run outcomes, enable/disable, responsive administration layouts, refreshed workflow/schedule visual baselines, ledger capacity metadata, structured create retention, persisted dispatch failure refresh, lifecycle/outcome filtering, delete retry, isolated-view thread handoff, and progressive disclosure of advanced ledger inputs.

The application-shell suite also asserts disclosure semantics, controlled-content relationships, shared status regions, and narrow-viewport overflow behavior.

The primary-operator suites cover collapsed and expanded run settings, launch and follow-up payload preservation and retry, single-surface approvals, blocked follow-up state, semantic transcript status, conversation/all-activity reversibility, search-before-pagination, connection/sync recovery, empty and editor-unavailable states, narrow long-content containment, editor launch/stop and iframe recovery, dock/modal/stacked transitions, modal focus restoration, close-versus-stop behavior, credential disclosure, and the inspected launch/transcript/shell/editor visual baselines.

Run the focused suite with:

```sh
npm run test:e2e -- e2e/tests/app-shell.spec.js
npm run test:e2e -- e2e/tests/server-connection.spec.js
npm run test:e2e -- e2e/tests/thread-collection.spec.js
npm run test:e2e -- e2e/tests/automation-state.spec.js
npm run test:e2e -- e2e/tests/automation-admin.spec.js
npm run test:e2e -- e2e/tests/workflows.spec.js e2e/tests/schedules.spec.js
npm run test:e2e -- e2e/tests/task-ledger-state.spec.js
npm run test:e2e -- e2e/tests/task-ledger-admin.spec.js
npm run test:e2e -- e2e/tests/operator-launch.spec.js
npm run test:e2e -- e2e/tests/thread-view.spec.js
npm run test:e2e -- e2e/tests/editor-lifecycle.spec.js
```

Run `npm run verify` before closing a frontend milestone.
