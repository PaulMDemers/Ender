const blankWorkflow = {
  id: "blank_workflow",
  name: "Blank Workflow",
  description: "Starter template for building a new multi-step workflow.",

  async createInitialState(_input, _context) {
    return {
      stage: "first_step",
      values: {},
      debug: []
    };
  },

  getCurrentStep(session) {
    const stage = session.state.stage || "first_step";

    if (stage === "first_step") {
      return {
        id: "first_step",
        type: "form",
        title: "First step",
        description: "Replace this starter step with your own workflow inputs.",
        submitLabel: "Continue",
        fields: [
          {
            id: "exampleValue",
            label: "Example field",
            type: "text",
            required: false,
            placeholder: "Replace me"
          }
        ]
      };
    }

    return {
      id: "complete",
      type: "complete",
      title: "Workflow complete",
      description: session.state.startedTaskId
        ? `Started task ${session.state.startedTaskId}`
        : "Workflow complete"
    };
  },

  async advance(session, input, { taskManager }) {
    const stage = session.state.stage || "first_step";

    if (stage === "first_step") {
      session.state.values = {
        ...(session.state.values || {}),
        exampleValue: String(input.exampleValue || "").trim()
      };

      // Replace this with your real transition logic or task start.
      // You can return step UI as:
      // - type: "form" with "fields"
      // - type: "select" with "options" and optional "filters"
      // - type: "complete"
      // Example:
      // const started = taskManager.start("Do the work", "/path/to/workspace");
      // if (!started.ok) return { ok: false, error: started.error || "Unable to start task" };
      // session.state.startedTaskId = started.id;

      session.state.stage = "complete";
      session.status = "completed";
      return { ok: true, startedTaskId: session.state.startedTaskId || null };
    }

    return { ok: false, error: "Workflow is already complete" };
  }
};

module.exports = { blankWorkflow };
