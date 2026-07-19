# Ender API Contracts

This file records the compatibility boundary for Ender's direct and Pillar-accessed HTTP API and task event streams. Code and automated contract tests remain the source of truth.

## Versions

Current shared versions are defined in `shared/contracts.json`:

| Contract | Current version | Exposure |
| --- | --- | --- |
| REST/JSON API | 1 | `X-Ender-API-Version: 1` response header |
| Task SSE | 1 | `X-Ender-SSE-Version: 1` response header and initial `contract` event |

REST bodies are not wrapped or otherwise changed by version metadata. This preserves existing clients that expect arrays, resource objects, or operation-specific envelopes.

Pillar relays the direct API version header with ordinary HTTP responses. Its synthesized task stream advertises the same task-SSE contract as a direct Ender stream.

## Task SSE version 1

Every successful task stream starts with:

```text
event: contract
data: {"version":1,"apiVersion":1}
```

Legacy EventSource clients ignore named events they do not subscribe to. The existing event payloads remain unchanged:

| Event | Payload |
| --- | --- |
| `status` | `{ t, status }` |
| `log` | `{ t, level, data }` |
| `approval_required` | `{ id, type, title, description, details, requestedAt }` |
| `complete` | `{ status, result }` |
| `error` | `{ t, level, data }` |
| `ping` | Unix timestamp number |

The contract event precedes initial status, replayed logs and approvals, live events, and terminal completion.

## Frontend compatibility

The frontend contract tracker treats:

- missing metadata as a compatible legacy server;
- versions at or below the supported version as compatible;
- higher versions as `newer` and observable, without blocking requests or task streams.

This permits additive server evolution while retaining diagnostic visibility. A future breaking contract may introduce explicit negotiation or a user-facing compatibility block as a separate migration.

## Change policy

For additive changes, retain the current version when old clients can safely ignore the new field, header, event, or route. For a breaking change:

1. Increment only the affected contract version in `shared/contracts.json`.
2. Document changed response or event semantics here.
3. Keep legacy behavior available or provide explicit negotiation during the supported migration window.
4. Test direct API, Pillar relay/synthesis, SSE replay/live ordering, and frontend legacy/current/newer handling.
