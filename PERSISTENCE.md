# Ender Persistence Contracts

This inventory records Ender's application-owned persistence formats. Code remains the source of truth; update this file when a format, version, migration, or ownership boundary changes.

## Versioned JSON records

All current JSON records use `recordVersion: 1`. Loaders accept legacy unversioned records as version 0, migrate them sequentially, and rewrite successfully loaded legacy data in the current format. A record newer than the running Ender build is rejected and left untouched.

| Record family | Location/configuration | Ownership | Migration implementation |
| --- | --- | --- | --- |
| Tasks | One file per task in `threadsDir` | `JsonTaskRepository` and `TaskManager` | `src/runtime/taskRecord.js` |
| Workflow sessions | One file per interactive session in `workflowSessionsDir` | `WorkflowManager` | `src/persistence/jsonRecord.js` |
| Schedules | One file per schedule in `schedulesDir` | `ScheduleManager` | `src/persistence/jsonRecord.js` |
| Task ledger entries | One file per entry in `taskLedgerDir` | `TaskLedgerManager` | `src/persistence/jsonRecord.js` |
| Projects | One file per project in `projectsDir` | `ProjectManager` | `src/persistence/jsonRecord.js` |
| Memories | One file per memory in `memoriesDir` | `MemoryManager` | `src/persistence/jsonRecord.js` |
| Beacon state | Single envelope at `BEACON_DATA_FILE` | `BeaconStore` | `src/persistence/jsonRecord.js` |
| Pillar registry state | Single envelope at `PILLAR_DATA_FILE` | `PillarStore` | `src/persistence/jsonRecord.js` |
| Code-server sessions | `session.json` beneath each task's code-server state directory | `CodeServerManager` | `src/persistence/jsonRecord.js` |
| Self-update checkpoints | One file per checkpoint in the configured checkpoint directory | self-update checkpoint helpers | `src/persistence/jsonRecord.js` |

Disk-only version fields are not exposed through normal REST responses, runtime summaries, connector data objects, or self-update checkpoint results.

## Configuration and non-JSON storage

- LLM profiles are operator configuration supplied through `LLM_PROFILES_JSON`; Ender reads but does not persist or migrate them.
- `shared/contracts.json` is a bundled static contract definition, not mutable runtime state.
- Beacon and Pillar PostgreSQL mode uses the schema managed by `src/cloud/postgresStore.js`, not the JSON record registry.
- Workspace files, repositories, logs, and code-server data/extensions directories are owned by their respective external tools and are not Ender JSON records.

## Change policy

When changing a persisted shape:

1. Increment only the affected record family's current version.
2. Add a sequential migration from the previous version.
3. Preserve loaders for all supported legacy versions.
4. Add legacy, current, future-version, malformed-record, and round-trip coverage.
5. Never overwrite a record whose version is newer than the running build supports.
