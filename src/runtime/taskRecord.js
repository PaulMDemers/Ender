// @ts-check

const TASK_RECORD_VERSION = 1;

const TASK_RECORD_MIGRATIONS = new Map([
  [0, (record) => ({ ...record, recordVersion: 1 })]
]);

function getTaskRecordVersion(record) {
  if (record?.recordVersion === undefined || record?.recordVersion === null) return 0;
  const version = record.recordVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error("Task recordVersion must be a non-negative integer");
  }
  return version;
}

function migrateTaskRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Task record must be a JSON object");
  }

  const fromVersion = getTaskRecordVersion(input);
  if (fromVersion > TASK_RECORD_VERSION) {
    throw new Error(
      `Unsupported task record version ${fromVersion}; this Ender build supports up to ${TASK_RECORD_VERSION}`
    );
  }

  let record = { ...input };
  let version = fromVersion;
  while (version < TASK_RECORD_VERSION) {
    const migrate = TASK_RECORD_MIGRATIONS.get(version);
    if (!migrate) throw new Error(`No task record migration is available from version ${version}`);
    record = migrate(record);
    version = getTaskRecordVersion(record);
  }

  return {
    record,
    fromVersion,
    version,
    migrated: fromVersion !== version
  };
}

module.exports = {
  TASK_RECORD_VERSION,
  getTaskRecordVersion,
  migrateTaskRecord
};
