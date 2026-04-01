const test = require("node:test");
const assert = require("node:assert/strict");

const contractDefinitions = require("../shared/contracts.json");
const {
  scheduleInputSchema,
  workflowModeValues,
  workflowSessionSchema,
  workflowStepTypeValues
} = require("../src/shared/contracts");

test("shared contract definitions expose the expected workflow and schedule enums", () => {
  assert.deepEqual(contractDefinitions.scheduleTargetKinds, ["prompt", "thread", "workflow"]);
  assert.deepEqual(workflowModeValues, ["interactive", "schedule_config", "scheduled_run"]);
  assert.deepEqual(workflowStepTypeValues, ["form", "select", "complete"]);
});

test("scheduleInputSchema validates workflow-backed schedules", () => {
  const parsed = scheduleInputSchema.parse({
    name: "Nightly workflow",
    cron: "0 2 * * *",
    timezone: "America/New_York",
    enabled: true,
    target: {
      kind: "workflow",
      workflowId: "jira_to_repo_task",
      inputs: [{ value: "ABC-123" }]
    }
  });

  assert.equal(parsed.target.kind, "workflow");
  assert.equal(parsed.target.workflowId, "jira_to_repo_task");
  assert.deepEqual(parsed.target.inputs, [{ value: "ABC-123" }]);
});

test("workflowSessionSchema validates serialized workflow sessions", () => {
  const parsed = workflowSessionSchema.parse({
    id: "session-1",
    workflowId: "jira_to_repo_task",
    workflowName: "Jira -> Repo -> Work",
    status: "active",
    createdAt: "2026-03-31T10:00:00.000Z",
    updatedAt: "2026-03-31T10:05:00.000Z",
    startedTaskId: null,
    mode: "interactive",
    resumedFromDisk: false,
    canGoBack: true,
    bootstrapError: null,
    debug: [],
    currentStep: {
      id: "repo",
      type: "form",
      title: "Clone repository"
    }
  });

  assert.equal(parsed.currentStep.type, "form");
  assert.equal(parsed.mode, "interactive");
});
