const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function normalizeConfluenceBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return null;
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  const url = new URL(withSlash);

  if (!url.pathname.endsWith("/wiki/") && url.pathname !== "/wiki") {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/wiki/`;
  } else if (url.pathname === "/wiki") {
    url.pathname = "/wiki/";
  }

  return url.toString();
}

function confluenceAuthHeader(confluenceConfig) {
  if (!confluenceConfig.baseUrl || !confluenceConfig.email || !confluenceConfig.apiToken) {
    return null;
  }
  const raw = `${confluenceConfig.email}:${confluenceConfig.apiToken}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function requestConfluence(confluenceConfig, pathname, init = {}) {
  const auth = confluenceAuthHeader(confluenceConfig);
  const base = normalizeConfluenceBaseUrl(confluenceConfig.baseUrl);
  if (!auth || !base) {
    return {
      ok: false,
      error: "confluence_not_configured",
      message: "Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN to enable Confluence tools"
    };
  }

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
    // keep raw text
  }

  return sanitizeJsonValue({
    ok: res.ok,
    status: res.status,
    body
  });
}

function escapeCqlText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const confluenceIdSchema = z.union([z.string(), z.number()]);
const confluenceSchema = z.object({
  action: z.enum(["search_pages", "get_page", "create_page", "update_page"]),
  query: z.string().nullable().default(null),
  cql: z.string().nullable().default(null),
  limit: z.number().int().positive().max(100).nullable().default(null),
  start: z.number().int().nonnegative().nullable().default(null),
  pageId: confluenceIdSchema.nullable().default(null),
  spaceKey: z.string().min(1).nullable().default(null),
  title: z.string().nullable().default(null),
  content: z.string().min(1).nullable().default(null),
  parentPageId: confluenceIdSchema.nullable().default(null),
  version: z.number().int().positive().nullable().default(null)
}).superRefine((input, ctx) => {
  if ((input.action === "get_page" || input.action === "update_page") && input.pageId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pageId"],
      message: "pageId is required for this action"
    });
  }

  if (input.action === "create_page") {
    if (!input.spaceKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spaceKey"],
        message: "spaceKey is required for create_page"
      });
    }
    if (input.title == null || String(input.title).trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: "title is required for create_page"
      });
    }
    if (!input.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required for create_page"
      });
    }
  }

  if (input.action === "update_page") {
    if (!input.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required for update_page"
      });
    }
  }
});

function createConfluenceTools(confluenceConfig, { requestApproval, onLog } = {}) {
  const confluence = tool(
    async (input) => {
      if (input.action === "search_pages") {
        const cql = String(input.cql || "").trim()
          || (String(input.query || "").trim()
            ? `type=page AND text~"${escapeCqlText(input.query)}"`
            : "");
        if (!cql) {
          return JSON.stringify({
            ok: false,
            error: "query_required",
            message: "Provide query or cql for confluence search_pages"
          });
        }

        const params = new URLSearchParams();
        params.set("cql", cql);
        params.set("limit", String(input.limit || 10));
        params.set("start", String(input.start || 0));
        params.set("expand", "content.space,content.version");
        const response = await requestConfluence(confluenceConfig, `rest/api/search?${params.toString()}`);
        return JSON.stringify(response);
      }

      if (input.action === "get_page") {
        const response = await requestConfluence(
          confluenceConfig,
          `rest/api/content/${encodeURIComponent(String(input.pageId))}?expand=body.storage,version,space,history.lastUpdated`
        );
        return JSON.stringify(response);
      }

      if (input.action === "create_page") {
        onLog?.({ level: "warn", data: `confluence page create approval required: ${input.spaceKey}/${input.title}` });
        const approved = await requestApproval?.({
          type: "confluence_create_page",
          title: "Approve Confluence page creation",
          description: `Allow Ender to create Confluence page "${input.title}" in space ${input.spaceKey}?`,
          details: {
            spaceKey: input.spaceKey,
            title: input.title,
            parentPageId: input.parentPageId || null
          }
        });

        if (!approved) {
          return JSON.stringify({
            ok: false,
            error: "approval_denied",
            message: "confluence page creation denied by user"
          });
        }

        const payload = {
          type: "page",
          title: input.title,
          space: { key: input.spaceKey },
          body: {
            storage: {
              value: input.content,
              representation: "storage"
            }
          }
        };

        if (input.parentPageId) {
          payload.ancestors = [{ id: String(input.parentPageId) }];
        }

        const response = await requestConfluence(confluenceConfig, "rest/api/content", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        return JSON.stringify(response);
      }

      const pageId = encodeURIComponent(String(input.pageId));
      const existing = await requestConfluence(
        confluenceConfig,
        `rest/api/content/${pageId}?expand=version,space`
      );
      if (!existing.ok) {
        return JSON.stringify(existing);
      }

      const currentPage = existing.body || {};
      const nextVersion = input.version || (Number(currentPage?.version?.number || 0) + 1);
      const title = String(input.title || currentPage.title || "").trim();
      const spaceKey = currentPage?.space?.key;

      if (!title || !spaceKey || !nextVersion) {
        return JSON.stringify({
          ok: false,
          error: "page_update_context_missing",
          message: "Unable to resolve current page title, space, or version for update"
        });
      }

      onLog?.({ level: "warn", data: `confluence page update approval required: ${currentPage.id || input.pageId}/${title}` });
      const approved = await requestApproval?.({
        type: "confluence_update_page",
        title: "Approve Confluence page update",
        description: `Allow Ender to update Confluence page "${title}"?`,
        details: {
          pageId: String(input.pageId),
          title,
          version: nextVersion
        }
      });

      if (!approved) {
        return JSON.stringify({
          ok: false,
          error: "approval_denied",
          message: "confluence page update denied by user"
        });
      }

      const response = await requestConfluence(confluenceConfig, `rest/api/content/${pageId}`, {
        method: "PUT",
        body: JSON.stringify({
          id: String(input.pageId),
          type: "page",
          title,
          space: { key: spaceKey },
          version: { number: nextVersion },
          body: {
            storage: {
              value: input.content,
              representation: "storage"
            }
          }
        })
      });
      return JSON.stringify(response);
    },
    {
      name: "confluence",
      description: "Search Confluence pages, read a page, create a page, or update an existing page in Confluence. Use action=search_pages for discovery, action=get_page to read a page including storage body, action=create_page to publish documentation, and action=update_page to overwrite page content.",
      schema: confluenceSchema
    }
  );

  return [confluence];
}

module.exports = { createConfluenceTools, requestConfluence, normalizeConfluenceBaseUrl };
