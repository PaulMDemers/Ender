# Ender Developer Knowledge Base

This directory is the fast code-navigation and change-safety addendum for future development threads. Operators and release owners should start at [`docs/README.md`](../docs/README.md); the release evidence boundary is [`RELEASE_READINESS.md`](../RELEASE_READINESS.md).

## Recommended read order

1. [Quick start for agents](quick-start-for-agents.md)
2. [Repository map](repo-map.md)
3. [Architecture](architecture.md)
4. [Change playbooks](change-playbooks.md)
5. [Testing and quality](testing-and-quality.md)
6. [Developer troubleshooting](troubleshooting.md)

Read the concern-specific records only when relevant:

- [Runtime loop](runtime-loop.md)
- [Workflows and schedules](workflows-and-schedules.md)
- [UI operator console](ui-operator-console.md)
- [Self-update](self-update.md)
- [Glossary](glossary.md)

## Sources of truth

- Current code and tests define runtime behavior.
- [`API_CONTRACTS.md`](../API_CONTRACTS.md), [`PERSISTENCE.md`](../PERSISTENCE.md), [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md), and [`TYPECHECKING.md`](../TYPECHECKING.md) record maintained compatibility and ownership boundaries.
- [`docs/README.md`](../docs/README.md) owns operator/deployment navigation.
- [`RELEASE_READINESS.md`](../RELEASE_READINESS.md) owns environment-specific release evidence and gaps.
- [`ROADMAP.md`](../ROADMAP.md) owns modernization continuity, not permanent product behavior.

If an older knowledge note disagrees with those records, verify the code and update the note in the same change.
