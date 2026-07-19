// @ts-check

const PERSISTED_RECORD_VERSIONS = Object.freeze({
  workflowSession: 1,
  schedule: 1,
  taskLedgerEntry: 1,
  project: 1,
  memory: 1,
  beaconStore: 1,
  pillarStore: 1,
  codeServerSession: 1,
  selfUpdateCheckpoint: 1
});

const PERSISTED_RECORD_MIGRATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(PERSISTED_RECORD_VERSIONS).map(([kind, version]) => [
      kind,
      new Map([[0, (record) => ({ ...record, recordVersion: version })]])
    ])
  )
);

function currentPersistedRecordVersion(kind) {
  const version = PERSISTED_RECORD_VERSIONS[kind];
  if (!version) throw new Error(`Unknown persisted record kind: ${kind}`);
  return version;
}

function getPersistedRecordVersion(record, kind) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${kind} record must be a JSON object`);
  }
  if (record.recordVersion === undefined || record.recordVersion === null) return 0;
  const version = record.recordVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error(`${kind} recordVersion must be a non-negative integer`);
  }
  return version;
}

function migratePersistedRecord(input, kind) {
  const currentVersion = currentPersistedRecordVersion(kind);
  const fromVersion = getPersistedRecordVersion(input, kind);
  if (fromVersion > currentVersion) {
    throw new Error(
      `Unsupported ${kind} record version ${fromVersion}; this Ender build supports up to ${currentVersion}`
    );
  }

  let record = { ...input };
  let version = fromVersion;
  const migrations = PERSISTED_RECORD_MIGRATIONS[kind];
  while (version < currentVersion) {
    const migrate = migrations?.get(version);
    if (!migrate) throw new Error(`No ${kind} record migration is available from version ${version}`);
    record = migrate(record);
    version = getPersistedRecordVersion(record, kind);
  }

  return {
    record,
    fromVersion,
    version,
    migrated: fromVersion !== version
  };
}

function versionPersistedRecord(kind, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${kind} record must be a JSON object`);
  }
  return {
    ...record,
    recordVersion: currentPersistedRecordVersion(kind)
  };
}

module.exports = {
  PERSISTED_RECORD_VERSIONS,
  currentPersistedRecordVersion,
  getPersistedRecordVersion,
  migratePersistedRecord,
  versionPersistedRecord
};
