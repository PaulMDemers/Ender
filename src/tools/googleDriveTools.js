const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/";
const GOOGLE_DRIVE_UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3/";

function googleDriveHeaders(accessToken, extra = {}) {
  if (!accessToken) return null;
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra
  };
}

async function parseDriveResponse(res, { expectText = false } = {}) {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();

  if (expectText) {
    const text = await res.text();
    return sanitizeJsonValue({
      ok: res.ok,
      status: res.status,
      contentType,
      body: text
    });
  }

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
    contentType,
    body
  });
}

async function requestGoogleDrive(googleDriveConfig, pathname, init = {}, options = {}) {
  const headers = googleDriveHeaders(googleDriveConfig.accessToken, init.headers || {});
  if (!headers) {
    return {
      ok: false,
      error: "google_drive_not_configured",
      message: "Set GOOGLE_DRIVE_ACCESS_TOKEN to enable Google Drive tools"
    };
  }

  const url = new URL(pathname, GOOGLE_DRIVE_API_BASE);
  const res = await fetch(url, {
    ...init,
    headers
  });

  return parseDriveResponse(res, options);
}

async function requestGoogleDriveUpload(googleDriveConfig, pathname, init = {}, options = {}) {
  const headers = googleDriveHeaders(googleDriveConfig.accessToken, init.headers || {});
  if (!headers) {
    return {
      ok: false,
      error: "google_drive_not_configured",
      message: "Set GOOGLE_DRIVE_ACCESS_TOKEN to enable Google Drive tools"
    };
  }

  const url = new URL(pathname, GOOGLE_DRIVE_UPLOAD_API_BASE);
  const res = await fetch(url, {
    ...init,
    headers
  });

  return parseDriveResponse(res, options);
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isTextLikeContentType(contentType) {
  return contentType.startsWith("text/")
    || contentType.includes("json")
    || contentType.includes("xml")
    || contentType.includes("javascript")
    || contentType.includes("yaml");
}

const googleDriveSchema = z.object({
  action: z.enum([
    "search_files",
    "get_file",
    "read_text_file",
    "export_file",
    "upload_text_file",
    "update_text_file"
  ]),
  query: z.string().nullable().default(null),
  nameContains: z.string().nullable().default(null),
  folderId: z.string().nullable().default(null),
  mimeType: z.string().nullable().default(null),
  trashed: z.boolean().nullable().default(null),
  pageSize: z.number().int().positive().max(100).nullable().default(null),
  pageToken: z.string().nullable().default(null),
  fileId: z.string().min(1).nullable().default(null),
  fields: z.string().nullable().default(null),
  maxChars: z.number().int().positive().max(1000000).nullable().default(null),
  name: z.string().min(1).nullable().default(null),
  content: z.string().min(1).nullable().default(null)
}).superRefine((input, ctx) => {
  if (
    (input.action === "get_file"
      || input.action === "read_text_file"
      || input.action === "export_file"
      || input.action === "update_text_file")
    && !input.fileId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileId"],
      message: "fileId is required for this action"
    });
  }

  if (input.action === "upload_text_file") {
    if (!input.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "name is required for upload_text_file"
      });
    }
    if (!input.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required for upload_text_file"
      });
    }
  }

  if (input.action === "update_text_file" && !input.content) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["content"],
      message: "content is required for update_text_file"
    });
  }
});

function createGoogleDriveTools(googleDriveConfig, { requestApproval, onLog } = {}) {
  const google_drive = tool(
    async (input) => {
      if (input.action === "search_files") {
        const qParts = [];
        if (input.query) qParts.push(String(input.query));
        if (input.nameContains) qParts.push(`name contains '${escapeDriveQuery(input.nameContains)}'`);
        if (input.folderId) qParts.push(`'${escapeDriveQuery(input.folderId)}' in parents`);
        if (input.mimeType) qParts.push(`mimeType='${escapeDriveQuery(input.mimeType)}'`);
        if (input.trashed == null) {
          qParts.push("trashed=false");
        } else {
          qParts.push(`trashed=${input.trashed ? "true" : "false"}`);
        }

        const params = new URLSearchParams();
        if (qParts.length) params.set("q", qParts.join(" and "));
        params.set("pageSize", String(input.pageSize || 25));
        params.set("supportsAllDrives", "true");
        params.set("includeItemsFromAllDrives", "true");
        params.set(
          "fields",
          "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size,parents,driveId)"
        );
        if (input.pageToken) params.set("pageToken", input.pageToken);

        const response = await requestGoogleDrive(googleDriveConfig, `files?${params.toString()}`);
        return JSON.stringify(response);
      }

      if (input.action === "get_file") {
        const params = new URLSearchParams();
        params.set("supportsAllDrives", "true");
        params.set("fields", input.fields || "*");
        const response = await requestGoogleDrive(
          googleDriveConfig,
          `files/${encodeURIComponent(input.fileId)}?${params.toString()}`
        );
        return JSON.stringify(response);
      }

      if (input.action === "read_text_file") {
        const response = await requestGoogleDrive(
          googleDriveConfig,
          `files/${encodeURIComponent(input.fileId)}?alt=media&supportsAllDrives=true`,
          {},
          { expectText: true }
        );

        if (response.ok && !isTextLikeContentType(response.contentType || "")) {
          return JSON.stringify({
            ok: false,
            error: "binary_file",
            message: `File content type ${response.contentType || "unknown"} does not look like plain text. Use get_file to inspect metadata or export_file for Google Workspace docs.`
          });
        }

        if (response.ok && input.maxChars) {
          response.body = String(response.body || "").slice(0, input.maxChars);
        }

        return JSON.stringify(response);
      }

      if (input.action === "export_file") {
        const response = await requestGoogleDrive(
          googleDriveConfig,
          `files/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent(input.mimeType || "text/plain")}`,
          {},
          { expectText: true }
        );

        if (response.ok && input.maxChars) {
          response.body = String(response.body || "").slice(0, input.maxChars);
        }

        return JSON.stringify(response);
      }

      if (input.action === "upload_text_file") {
        onLog?.({ level: "warn", data: `google drive upload approval required: ${input.name}` });
        const approved = await requestApproval?.({
          type: "google_drive_upload",
          title: "Approve Google Drive file upload",
          description: `Allow Ender to upload Google Drive file "${input.name}"?`,
          details: {
            name: input.name,
            folderId: input.folderId || null,
            mimeType: input.mimeType || "text/plain"
          }
        });

        if (!approved) {
          return JSON.stringify({
            ok: false,
            error: "approval_denied",
            message: "google drive upload denied by user"
          });
        }

        const form = new FormData();
        const metadata = { name: input.name };
        if (input.folderId) metadata.parents = [input.folderId];
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", new Blob([input.content], { type: input.mimeType || "text/plain" }));

        const response = await requestGoogleDriveUpload(
          googleDriveConfig,
          "files?uploadType=multipart&supportsAllDrives=true",
          {
            method: "POST",
            body: form
          }
        );
        return JSON.stringify(response);
      }

      onLog?.({ level: "warn", data: `google drive update approval required: ${input.fileId}` });
      const approved = await requestApproval?.({
        type: "google_drive_update",
        title: "Approve Google Drive file update",
        description: `Allow Ender to overwrite Google Drive file ${input.fileId}?`,
        details: {
          fileId: input.fileId,
          name: input.name || null,
          mimeType: input.mimeType || "text/plain"
        }
      });

      if (!approved) {
        return JSON.stringify({
          ok: false,
          error: "approval_denied",
          message: "google drive update denied by user"
        });
      }

      const form = new FormData();
      const metadata = {};
      if (input.name) metadata.name = input.name;
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", new Blob([input.content], { type: input.mimeType || "text/plain" }));

      const response = await requestGoogleDriveUpload(
        googleDriveConfig,
        `files/${encodeURIComponent(input.fileId)}?uploadType=multipart&supportsAllDrives=true`,
        {
          method: "PATCH",
          body: form
        }
      );

      return JSON.stringify(response);
    },
    {
      name: "google_drive",
      description: "Purpose: Search, inspect, read, export, upload, or update Drive files. When to use: When Drive content is relevant to the task. Constraints: action determines behavior. Side effects: search/get/read/export: no; upload/update: yes. Requires explicit user intent: read actions: no; upload/update: yes or clearly implied. Pagination: pageToken/pageSize for search. Output: file metadata, text content, export content, or write result.",
      schema: googleDriveSchema
    }
  );

  return [google_drive];
}

module.exports = { createGoogleDriveTools, requestGoogleDrive };
