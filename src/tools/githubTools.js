const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

function normalizeGitHubApiBase(baseUrl) {
  const raw = String(baseUrl || "https://github.com").trim();
  const root = raw.endsWith("/") ? raw : `${raw}/`;
  const url = new URL(root);

  if (url.hostname === "github.com") {
    return "https://api.github.com/";
  }

  return new URL("api/v3/", root).toString();
}

function buildHeaders(token) {
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function requestGitHub({ baseUrl, token }, pathname, init = {}) {
  const headers = buildHeaders(token);
  if (!headers) {
    return { ok: false, error: "github_not_configured", message: "Set GITHUB_TOKEN to enable GitHub tools" };
  }

  const apiBase = normalizeGitHubApiBase(baseUrl);
  const url = new URL(pathname, apiBase);
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

function createGitHubTools(githubConfig) {
  const github_list_repos = tool(
    async ({ visibility, affiliation, type, sort, perPage, page }) => {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage || 50));
      params.set("page", String(page || 1));
      if (visibility) params.set("visibility", visibility);
      if (affiliation) params.set("affiliation", affiliation);
      if (type) params.set("type", type);
      if (sort) params.set("sort", sort);

      const response = await requestGitHub(githubConfig, `user/repos?${params.toString()}`);
      return JSON.stringify(response);
    },
    {
      name: "github_list_repos",
      description: "List accessible GitHub repositories for the authenticated user",
      schema: z.object({
        visibility: z.enum(["all", "public", "private"]).nullable(),
        affiliation: z.string().nullable(),
        type: z.enum(["all", "owner", "member"]).nullable(),
        sort: z.enum(["created", "updated", "pushed", "full_name"]).nullable(),
        perPage: z.number().int().positive().max(100).nullable(),
        page: z.number().int().positive().nullable()
      })
    }
  );

  const github_list_pull_requests = tool(
    async ({ owner, repo, state, head, base, perPage, page }) => {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage || 50));
      params.set("page", String(page || 1));
      params.set("state", state || "open");
      if (head) params.set("head", head);
      if (base) params.set("base", base);

      const response = await requestGitHub(githubConfig, `repos/${owner}/${repo}/pulls?${params.toString()}`);
      return JSON.stringify(response);
    },
    {
      name: "github_list_pull_requests",
      description: "List pull requests for a GitHub repository",
      schema: z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        state: z.enum(["open", "closed", "all"]).nullable(),
        head: z.string().nullable(),
        base: z.string().nullable(),
        perPage: z.number().int().positive().max(100).nullable(),
        page: z.number().int().positive().nullable()
      })
    }
  );

  const github_create_pull_request = tool(
    async ({ owner, repo, title, head, base, body, draft, maintainerCanModify }) => {
      const response = await requestGitHub(githubConfig, `repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title,
          head,
          base,
          body,
          draft: Boolean(draft),
          maintainer_can_modify: maintainerCanModify == null ? true : Boolean(maintainerCanModify)
        })
      });
      return JSON.stringify(response);
    },
    {
      name: "github_create_pull_request",
      description: "Create a pull request in GitHub",
      schema: z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        title: z.string().min(1),
        head: z.string().min(1),
        base: z.string().min(1),
        body: z.string().nullable(),
        draft: z.boolean().nullable(),
        maintainerCanModify: z.boolean().nullable()
      })
    }
  );

  const github_comment_pull_request = tool(
    async ({ owner, repo, pullNumber, body }) => {
      const response = await requestGitHub(githubConfig, `repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      return JSON.stringify(response);
    },
    {
      name: "github_comment_pull_request",
      description: "Add a comment to a GitHub pull request",
      schema: z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        pullNumber: z.union([z.string(), z.number()]),
        body: z.string().min(1)
      })
    }
  );

  return [
    github_list_repos,
    github_list_pull_requests,
    github_create_pull_request,
    github_comment_pull_request
  ];
}

module.exports = { createGitHubTools, requestGitHub, normalizeGitHubApiBase };
