# UI Enhancement Backlog

Last reviewed: 2026-04-03 16:09 EDT

This backlog captures UI improvements identified from a live review of the running Ender API and UI.

Review inputs:

- Ender's own `browser_snapshot_page` capture of the first-run connection state
- live thread transcript view at `http://127.0.0.1:4173`
- live docked code-server editor launched through `POST /tasks/:id/code-server`

The goal is to improve operator efficiency, reduce repeated chrome, and reclaim working space for the transcript and editor.

## Priority 1

### 1. Compact the docked editor header

Problem:
The docked editor header currently stacks title, credentials, and actions into separate rows, which pushes the primary buttons below the title and burns vertical space before the iframe begins.

Observed impact:

- less visible editor area
- less visible transcript area
- actions feel detached from the title/context

Suggested change:

- make the top row `title + status + actions`
- keep `Show Details` as the only always-visible secondary control
- move URL and password into a collapsible details region or compact popover
- reduce top padding and header gap in the dock

Likely touch points:

- `ui/src/App.jsx` dock header structure
- `ui/src/styles.css` editor dock header and action styles

### 2. Make the right dock a real split layout

Problem:
The editor dock is a fixed overlay while the full left rail stays open. In practice this compresses the transcript into a narrow center column.

Observed impact:

- thread logs become hard to scan
- long prompts/results wrap too aggressively
- the editor and transcript both feel constrained even on wide screens

Suggested change:

- treat the editor as part of the main layout grid instead of a floating overlay
- auto-collapse the left rail when the dock opens
- remember the previous rail state and restore it when the dock closes
- lower the default dock width and let the split grow intentionally

Likely touch points:

- `ui/src/App.jsx` editor open/close state
- `ui/src/styles.css` layout grid and `editorDock`

### 3. Compress the thread header

Problem:
The thread view repeats metadata across the title area, action area, and chip row before the transcript starts.

Observed impact:

- transcript content starts too far down the page
- repeated server/thread metadata competes with the actual run output
- the header feels heavier once the editor dock is open

Suggested change:

- merge status, workspace, and updated time into a single compact metadata strip
- remove the extra thread id / relative-time line when the chip row is visible
- tighten vertical padding in the thread header
- consider a denser "focus mode" while a thread is selected

Likely touch points:

- `ui/src/App.jsx` thread header markup
- `ui/src/styles.css` header spacing and chip layout

### 4. Add a focused "review mode" for selected threads

Problem:
When an operator is actively reviewing a single thread, the layout still optimizes for navigation instead of inspection.

Observed impact:

- too much persistent chrome during transcript review
- less room for logs, approvals, and the follow-up composer

Suggested change:

- add a single action that hides the left rail and compresses the header
- keep thread switching available through a quick-return button
- let the docked editor inherit this focused mode automatically

Likely touch points:

- `ui/src/App.jsx` rail and header state
- `ui/src/styles.css` focus-mode layout variants

## Priority 2

### 5. Streamline first-run connection UX

Problem:
On a clean browser state, the app opens straight into the server modal even though the default local API endpoint is already known.

Observed impact:

- extra friction before the operator sees the product
- the first snapshot of the app is a setup modal rather than the actual console

Suggested change:

- auto-attempt `http://localhost:3000` on first launch
- only open the modal if the first connection fails
- keep server management as an explicit secondary action

Likely touch points:

- `ui/src/App.jsx` initial server bootstrap logic
- `ui/src/components/ServerModal.jsx`

### 6. Increase thread ledger density

Problem:
The left rail thread cards are visually attractive but expensive in height relative to the information they show.

Observed impact:

- fewer visible threads at once
- operators scroll more than necessary while triaging recent work

Suggested change:

- trim vertical padding on cards
- compress timestamps and run/log counts into a single line
- move less-critical actions behind the expanded state only
- consider a "dense list" option for power users

Likely touch points:

- `ui/src/components/TaskList.jsx`
- `ui/src/styles.css` thread card spacing

### 7. Reduce launch-screen dead space

Problem:
The launch view allocates a large amount of area to decorative spacing and the connected-target panel while the actual task input remains relatively sparse.

Observed impact:

- the primary "Mission goal" interaction feels visually distant from the action button
- the page looks under-filled compared with the thread view

Suggested change:

- rebalance the launch form into a more compact two-column rhythm
- bring workspace selection and run readiness closer to the goal field
- make the connected target panel lighter or inline

Likely touch points:

- `ui/src/components/NewTaskForm.jsx`
- `ui/src/styles.css` launch layout rules

### 8. Tighten transcript chrome

Problem:
The transcript view still spends a lot of space on wrappers, labels, and per-block padding around logs and tool groups.

Observed impact:

- fewer log events visible per screen
- tool-heavy runs feel more verbose than they are

Suggested change:

- shrink padding around grouped tool blocks
- reduce repeated labels where context is already clear
- keep raw markdown toggles, but de-emphasize them visually

Likely touch points:

- `ui/src/components/LogViewer.jsx`
- `ui/src/styles.css` transcript and log block styles

## Priority 3

### 9. Improve state transitions between launch, workflow, schedule, and thread modes

Problem:
The shell changes mode cleanly, but the visual hierarchy between these surfaces is still a bit uneven.

Suggested change:

- standardize page-level titles and action placement
- make each mode feel like a variation of one console rather than separate sub-apps

### 10. Add more intentional responsive behavior for editor workflows

Problem:
The current mobile rules keep the dock usable, but the editor/transcript workflow still needs more explicit small-screen behavior.

Suggested change:

- prefer modal editor presentation on smaller widths
- disable split docking below a practical breakpoint
- surface one-tap transitions between transcript and editor

## Recommended implementation order

1. Compact the docked editor header.
2. Convert the editor dock into a true split layout and auto-collapse the rail.
3. Compress the thread header and add focused thread review mode.
4. Streamline first-run server connection UX.
5. Tighten transcript and thread-ledger density.
6. Revisit launch-screen balance and smaller-screen editor flows.

## Definition of done for this backlog

The UI should feel noticeably more operational:

- more transcript lines visible by default
- more editor viewport visible by default
- fewer repeated metadata blocks
- fewer required clicks before seeing the main console
- smoother transition from browsing threads to actively supervising one
