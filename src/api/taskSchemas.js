// @ts-check

const { z } = require("zod");

const memoryModeValues = ["auto", "manual", "off"];
const imageDetailValues = ["auto", "low", "high"];

const optionalStringSchema = z.string().trim().nullable().optional().transform((value) => value || "");
const optionalIdentifierSchema = optionalStringSchema.transform((value) => value || null);

const textContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().trim().min(1)
});

const imageUrlValueSchema = z.union([
  z.string().trim().min(1),
  z.object({
    url: z.string().trim().min(1),
    detail: z.enum(imageDetailValues).nullable().optional()
  })
]);

const imageContentBlockSchema = z.object({
  type: z.literal("image_url"),
  image_url: imageUrlValueSchema,
  detail: z.enum(imageDetailValues).nullable().optional()
});

const taskContentBlockSchema = z.discriminatedUnion("type", [
  textContentBlockSchema,
  imageContentBlockSchema
]);

const createTaskSchema = z.object({
  goal: z.string().trim().min(1),
  workspace: optionalStringSchema,
  projectId: optionalIdentifierSchema,
  llmProfileId: optionalIdentifierSchema,
  memoryMode: z.enum(memoryModeValues).nullable().optional().transform((value) => value || "auto")
});

const continueTaskSchema = z.object({
  prompt: z.string().default(""),
  content: z.array(taskContentBlockSchema).optional(),
  llmProfileId: optionalIdentifierSchema,
  memoryMode: z.enum(memoryModeValues).nullable().optional().transform((value) => value || null)
}).superRefine((value, ctx) => {
  if (!value.prompt.trim() && !value.content?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Provide a prompt or at least one content block."
    });
  }
});

const approvalDecisionSchema = z.object({
  approved: z.boolean()
});

const deleteTaskSchema = z.object({
  deleteWorkspace: z.boolean().optional().default(false)
});

const taskLogsQuerySchema = z.object({
  from: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/).transform((value) => Number(value))
  ]).optional().default(0)
});

module.exports = {
  approvalDecisionSchema,
  continueTaskSchema,
  createTaskSchema,
  deleteTaskSchema,
  taskContentBlockSchema,
  taskLogsQuerySchema
};
