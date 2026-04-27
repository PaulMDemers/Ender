// @ts-check

const { z } = require("zod");
const contractDefinitions = require("../../shared/contracts.json");

function toEnumValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Expected at least one enum value");
  }
  return /** @type {[string, ...string[]]} */ ([...values.map((value) => String(value))]);
}

const scheduleTargetKindValues = Object.freeze([...contractDefinitions.scheduleTargetKinds]);
const workflowModeValues = Object.freeze([...contractDefinitions.workflowModes]);
const workflowStepTypeValues = Object.freeze([...contractDefinitions.workflowStepTypes]);

const scheduleTargetKindSchema = z.enum(toEnumValues(scheduleTargetKindValues));
const workflowModeSchema = z.enum(toEnumValues(workflowModeValues));
const workflowStepTypeSchema = z.enum(toEnumValues(workflowStepTypeValues));

const scheduleTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prompt"),
    prompt: z.string().trim().min(1),
    workspace: z.string().trim().nullable().optional(),
    projectId: z.string().trim().nullable().optional(),
    llmProfileId: z.string().trim().nullable().optional(),
    memoryMode: z.enum(["auto", "manual", "off"]).optional()
  }),
  z.object({
    kind: z.literal("thread"),
    threadId: z.string().trim().min(1),
    prompt: z.string().trim().min(1)
  }),
  z.object({
    kind: z.literal("workflow"),
    workflowId: z.string().trim().min(1),
    inputs: z.array(z.record(z.string(), z.unknown())).default([])
  })
]);

const scheduleInputSchema = z.object({
  name: z.string().trim().min(1),
  cron: z.string().trim().min(1),
  timezone: z.string().trim().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  createdByTaskId: z.string().trim().nullable().optional(),
  target: scheduleTargetSchema
});

const workflowStepSchema = z.object({
  id: z.string().trim().min(1),
  type: workflowStepTypeSchema
}).passthrough();

const workflowSessionSchema = z.object({
  id: z.string().trim().min(1),
  workflowId: z.string().trim().min(1),
  workflowName: z.string().trim().min(1),
  status: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  startedTaskId: z.string().trim().nullable(),
  mode: workflowModeSchema,
  resumedFromDisk: z.boolean(),
  canGoBack: z.boolean(),
  bootstrapError: z.string().trim().nullable(),
  debug: z.array(z.unknown()),
  currentStep: workflowStepSchema
});

module.exports = {
  contractDefinitions,
  scheduleTargetKindValues,
  workflowModeValues,
  workflowStepTypeValues,
  scheduleTargetKindSchema,
  workflowModeSchema,
  workflowStepTypeSchema,
  scheduleTargetSchema,
  scheduleInputSchema,
  workflowStepSchema,
  workflowSessionSchema
};
