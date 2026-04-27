const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function createProjectTools(projectManager, { onLog } = {}) {
  const project_search = tool(
    async ({ query }) => JSON.stringify({ ok: true, items: projectManager.list(query || "") }),
    {
      name: "project_search",
      description: "Purpose: Search Ender projects by name, alias, description, repo URL, or workspace. When to use: Before starting work on a named project. Side effects: no.",
      schema: z.object({
        query: z.string().nullable()
      })
    }
  );

  const project_create = tool(
    async ({ name, repoUrl, description, aliases, resources, directory }) => {
      const result = await projectManager.create({ name, repoUrl, description, aliases, resources, directory });
      if (result.ok) onLog?.({ level: "info", data: `created project ${result.project.id}` });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "project_create",
      description: "Purpose: Create a durable Ender project record. When to use: When the user gives a reusable project/repo/site context that should be available to future threads. Side effects: yes.",
      schema: z.object({
        name: z.string().min(1),
        repoUrl: z.string().nullable(),
        description: z.string().nullable(),
        aliases: z.array(z.string()).nullable(),
        resources: z.array(z.object({
          kind: z.string().nullable(),
          label: z.string().nullable(),
          url: z.string().nullable()
        })).nullable(),
        directory: z.string().nullable()
      })
    }
  );

  const project_ensure_workspace = tool(
    async ({ projectId }) => {
      const result = await projectManager.ensureWorkspace(projectId);
      if (result.ok) onLog?.({ level: "info", data: `project workspace ready ${result.workspacePath}` });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "project_ensure_workspace",
      description: "Purpose: Ensure a project has a local workspace, cloning its repo if missing. When to use: Before working on a known Ender project. Side effects: yes, may clone a repository.",
      schema: z.object({
        projectId: z.string().min(1)
      })
    }
  );

  return [project_search, project_create, project_ensure_workspace];
}

module.exports = { createProjectTools };
