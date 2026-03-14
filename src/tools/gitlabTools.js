const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

function buildHeaders(token) {
  if (!token) return null;
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json"
  };
}

async function requestGitLab({ baseUrl, token }, pathname, init = {}) {
  const headers = buildHeaders(token);
  if (!headers) {
    return { ok: false, error: "gitlab_not_configured", message: "Set GITLAB_TOKEN to enable GitLab tools" };
  }

  const url = new URL(pathname, `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}api/v4/`);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {})
    }
  });

  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }

  return {
    ok: res.ok,
    status: res.status,
    body
  };
}

function createGitLabTools(gitlabConfig) {
  const gitlab_list_projects = tool(
    async ({ membership, owned, search, perPage, page }) => {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage || 50));
      params.set("page", String(page || 1));
      if (membership) params.set("membership", "true");
      if (owned) params.set("owned", "true");
      if (search) params.set("search", search);

      const response = await requestGitLab(gitlabConfig, `projects?${params.toString()}`);
      return JSON.stringify(response);
    },
    {
      name: "gitlab_list_projects",
      description: "List accessible GitLab projects",
      schema: z.object({
        membership: z.boolean().nullable(),
        owned: z.boolean().nullable(),
        search: z.string().nullable(),
        perPage: z.number().int().positive().max(100).nullable(),
        page: z.number().int().positive().nullable()
      })
    }
  );

  const gitlab_list_merge_requests = tool(
    async ({ projectId, state, sourceBranch, targetBranch, perPage, page }) => {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage || 50));
      params.set("page", String(page || 1));
      params.set("state", state || "opened");
      if (sourceBranch) params.set("source_branch", sourceBranch);
      if (targetBranch) params.set("target_branch", targetBranch);

      const encodedProject = encodeURIComponent(String(projectId));
      const response = await requestGitLab(gitlabConfig, `projects/${encodedProject}/merge_requests?${params.toString()}`);
      return JSON.stringify(response);
    },
    {
      name: "gitlab_list_merge_requests",
      description: "List merge requests for a GitLab project",
      schema: z.object({
        projectId: z.union([z.string(), z.number()]),
        state: z.enum(["opened", "closed", "locked", "merged", "all"]).nullable(),
        sourceBranch: z.string().nullable(),
        targetBranch: z.string().nullable(),
        perPage: z.number().int().positive().max(100).nullable(),
        page: z.number().int().positive().nullable()
      })
    }
  );

  const gitlab_create_merge_request = tool(
    async ({ projectId, sourceBranch, targetBranch, title, description, draft, removeSourceBranch }) => {
      const encodedProject = encodeURIComponent(String(projectId));
      const payload = {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description,
        draft: Boolean(draft),
        remove_source_branch: Boolean(removeSourceBranch)
      };

      const response = await requestGitLab(gitlabConfig, `projects/${encodedProject}/merge_requests`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return JSON.stringify(response);
    },
    {
      name: "gitlab_create_merge_request",
      description: "Create a merge request in GitLab",
      schema: z.object({
        projectId: z.union([z.string(), z.number()]),
        sourceBranch: z.string().min(1),
        targetBranch: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullable(),
        draft: z.boolean().nullable(),
        removeSourceBranch: z.boolean().nullable()
      })
    }
  );

  const gitlab_comment_merge_request = tool(
    async ({ projectId, mergeRequestIid, body }) => {
      const encodedProject = encodeURIComponent(String(projectId));
      const response = await requestGitLab(
        gitlabConfig,
        `projects/${encodedProject}/merge_requests/${mergeRequestIid}/notes`,
        {
          method: "POST",
          body: JSON.stringify({ body })
        }
      );
      return JSON.stringify(response);
    },
    {
      name: "gitlab_comment_merge_request",
      description: "Comment on a GitLab merge request",
      schema: z.object({
        projectId: z.union([z.string(), z.number()]),
        mergeRequestIid: z.union([z.string(), z.number()]),
        body: z.string().min(1)
      })
    }
  );

  return [
    gitlab_list_projects,
    gitlab_list_merge_requests,
    gitlab_create_merge_request,
    gitlab_comment_merge_request
  ];
}

module.exports = { createGitLabTools };
