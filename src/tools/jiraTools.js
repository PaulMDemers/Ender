const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

function jiraAuthHeader(jiraConfig) {
  if (!jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken) {
    return null;
  }
  const raw = `${jiraConfig.email}:${jiraConfig.apiToken}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function requestJira(jiraConfig, pathname, init = {}) {
  const auth = jiraAuthHeader(jiraConfig);
  if (!auth) {
    return {
      ok: false,
      error: "jira_not_configured",
      message: "Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to enable Jira tools"
    };
  }

  const base = jiraConfig.baseUrl.endsWith("/") ? jiraConfig.baseUrl : `${jiraConfig.baseUrl}/`;
  const url = new URL(pathname, base);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }

  return {
    ok: res.ok,
    status: res.status,
    body
  };
}

async function resolveTransitionId(jiraConfig, issueKey, transitionNameOrId) {
  if (/^\d+$/.test(String(transitionNameOrId))) {
    return String(transitionNameOrId);
  }

  const transitionsResp = await requestJira(
    jiraConfig,
    `rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
  );
  if (!transitionsResp.ok || !transitionsResp.body || !Array.isArray(transitionsResp.body.transitions)) {
    return null;
  }

  const wanted = String(transitionNameOrId).toLowerCase();
  const found = transitionsResp.body.transitions.find((t) =>
    String(t.name || "").toLowerCase() === wanted
  );
  return found ? String(found.id) : null;
}

function ensureEnderPrefix(text) {
  const value = String(text || "").trim();
  if (!value) return "[Ender]";
  return value.startsWith("[Ender]") ? value : `[Ender] ${value}`;
}

function createJiraTools(jiraConfig, { requestApproval, onLog } = {}) {
  const jira_get_board_issues = tool(
    async ({ boardId, startAt, maxResults, jql }) => {
      const params = new URLSearchParams();
      params.set("startAt", String(startAt || 0));
      params.set("maxResults", String(maxResults || 50));
      if (jql) params.set("jql", jql);

      const response = await requestJira(
        jiraConfig,
        `rest/agile/1.0/board/${encodeURIComponent(String(boardId))}/issue?${params.toString()}`
      );
      return JSON.stringify(response);
    },
    {
      name: "jira_get_board_issues",
      description: "Get issues on a Jira board",
      schema: z.object({
        boardId: z.union([z.string(), z.number()]),
        startAt: z.number().int().nonnegative().nullable(),
        maxResults: z.number().int().positive().max(100).nullable(),
        jql: z.string().nullable()
      })
    }
  );

  const jira_get_issue = tool(
    async ({ issueKey, fields }) => {
      const params = new URLSearchParams();
      if (fields && fields.length) params.set("fields", fields.join(","));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const response = await requestJira(jiraConfig, `rest/api/3/issue/${encodeURIComponent(issueKey)}${suffix}`);
      return JSON.stringify(response);
    },
    {
      name: "jira_get_issue",
      description: "Get details for a Jira issue",
      schema: z.object({
        issueKey: z.string().min(1),
        fields: z.array(z.string()).nullable()
      })
    }
  );

  const jira_transition_issue = tool(
    async ({ issueKey, transition }) => {
      const transitionId = await resolveTransitionId(jiraConfig, issueKey, transition);
      if (!transitionId) {
        return JSON.stringify({
          ok: false,
          error: "transition_not_found",
          message: `Unable to resolve transition '${transition}' for issue ${issueKey}`
        });
      }

      onLog?.({ level: "warn", data: `jira transition approval required: ${issueKey} -> ${transition}` });
      const approved = await requestApproval?.({
        type: "jira_transition",
        title: "Approve Jira transition",
        description: `Allow Ender to transition ${issueKey} to ${transition}?`,
        details: { issueKey, transition, transitionId }
      });

      if (!approved) {
        return JSON.stringify({
          ok: false,
          error: "approval_denied",
          message: "jira transition denied by user"
        });
      }

      const response = await requestJira(jiraConfig, `rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: transitionId } })
      });
      return JSON.stringify(response);
    },
    {
      name: "jira_transition_issue",
      description: "Update Jira issue status by transition name or ID",
      schema: z.object({
        issueKey: z.string().min(1),
        transition: z.string().min(1)
      })
    }
  );

  const jira_comment_issue = tool(
    async ({ issueKey, comment }) => {
      const finalComment = ensureEnderPrefix(comment);
      const response = await requestJira(jiraConfig, `rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: finalComment }]
              }
            ]
          }
        })
      });
      return JSON.stringify(response);
    },
    {
      name: "jira_comment_issue",
      description: "Add a comment to a Jira issue",
      schema: z.object({
        issueKey: z.string().min(1),
        comment: z.string().min(1)
      })
    }
  );

  return [jira_get_board_issues, jira_get_issue, jira_transition_issue, jira_comment_issue];
}

module.exports = { createJiraTools, requestJira };
