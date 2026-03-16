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

const googleDriveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search_files"),
    query: z.string().nullable().optional(),
    nameContains: z.string().nullable().optional(),
    folderId: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    trashed: z.boolean().nullable().optional(),
    pageSize: z.number().int().positive().max(100).nullable().optional(),
    pageToken: z.string().nullable().optional()
  }),
  z.object({
    action: z.literal("get_file"),
    fileId: z.string().min(1),
    fields: z.string().nullable().optional()
  }),
  z.object({
    action: z.literal("read_text_file"),
    fileId: z.string().min(1),
    maxChars: z.number().int().positive().max(1000000).nullable().optional()
  }),
  z.object({
    action: z.literal("export_file"),
    fileId: z.string().min(1),
    mimeType: z.string().nullable().optional(),
    maxChars: z.number().int().positive().max(1000000).nullable().optional()
  }),
  z.object({
    action: z.literal("upload_text_file"),
    name: z.string().min(1),
    content: z.string().min(1),
    folderId: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional()
  }),
  z.object({
    action: z.literal("update_text_file"),
    fileId: z.string().min(1),
    content: z.string().min(1),
    name: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional()
  })
]);

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
      description: "Search Google Drive files, inspect metadata, read text files, export Google Workspace files, upload plain text files, or update existing plain text files in Drive.",
      schema: googleDriveSchema
    }
  );

  return [google_drive];
}

module.exports = { createGoogleDriveTools, requestGoogleDrive };
