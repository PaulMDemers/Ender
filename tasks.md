# Ender Task Roadmap

## Group 1: Bug Fixes

- [x] 1. Make scheduled Jira workflow setup side-effect free and scheduled execution idempotent.
- [x] 2. Route Jira workflow cloning through shared git auth handling for private GitHub repositories.
- [x] 3. Preserve the original task goal so reruns use the initial task intent instead of the latest follow-up prompt.
- [x] 4. Add explicit clone target collision handling for Jira workflow repository setup.
- [x] Add regression tests covering the group.
- [x] Verify the group and create a checkpoint commit.

## Group 2: Recommendations

- [x] 5. Add broader automated regression coverage for task, workflow, schedule, approval, and restart flows.
- [x] 6. Persist workflow sessions across restarts and surface resumed state cleanly.
- [x] 7. Tighten readiness and setup guidance in the API, UI, and docs.
- [x] Verify the group and create a checkpoint commit.

## Group 3: Upgrades

- [x] 8. Share core API and workflow schemas between backend and UI.
- [x] 9. Improve package/tooling quality gates and package layout ergonomics.
- [x] 10. Begin a targeted TypeScript migration for the runtime surface.
- [x] Verify the group and create a checkpoint commit.
