const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_USER_AGENT = "ender-agent/0.1";
const DEFAULT_RAW_MAX_BYTES = 120000;
const MAX_RAW_MAX_BYTES = 1000000;
const DEFAULT_PAGE_MAX_CHARS = 12000;
const MAX_PAGE_MAX_CHARS = 60000;
const MAX_PAGE_FETCH_BYTES = 1500000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) throw new Error("url is required");
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Only HTTP(S) URLs are supported");
  }
  return u.toString();
}

function decodeHtmlEntities(input) {
  const text = String(input || "");
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16) || 32));
}

function normalizeWhitespace(input) {
  return String(input || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlToText(html) {
  const withoutScript = String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");

  const withBreaks = withoutScript
    .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(noTags));
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return normalizeWhitespace(decodeHtmlEntities(match[1]));
}

function resolveLink(href, baseUrl) {
  if (!href) return null;
  try {
    const absolute = new URL(href, baseUrl).toString();
    if (!/^https?:\/\//i.test(absolute)) return null;
    return absolute;
  } catch {
    return null;
  }
}

function extractLinks(html, baseUrl, limit = 60) {
  const items = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(String(html || ""))) !== null && items.length < limit) {
    const href = resolveLink(match[1], baseUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = normalizeWhitespace(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " ")));
    items.push({ url: href, text: label });
  }

  return items;
}

function parseSearchResults(html) {
  const links = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  let match;

  while ((match = pattern.exec(String(html || ""))) !== null && links.length < 12) {
    const href = resolveLink(match[1], "https://duckduckgo.com/");
    if (!href) continue;
    const title = normalizeWhitespace(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " ")));
    links.push({ title, url: href });
  }

  return links;
}

async function fetchText(url, maxBytes) {
  const res = await fetch(url, {
    headers: { "user-agent": DEFAULT_USER_AGENT }
  });
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const body = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    finalUrl: res.url || url,
    contentType,
    body,
    maxBytes,
    truncated: body.length > maxBytes
  };
}

function clampPositive(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function clampNonNegative(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toDataUrl(buffer, mimeType) {
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function isPathInside(parent, candidate) {
  const normalizedParent = path.resolve(parent);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedParent === normalizedCandidate) return true;
  return normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

function createWebTools(workdir) {
  const http_get = tool(
    async ({ url, maxBytes, offset }) => {
      const target = normalizeUrl(url);
      const effectiveMaxBytes = clampPositive(maxBytes, DEFAULT_RAW_MAX_BYTES, MAX_RAW_MAX_BYTES);
      const effectiveOffset = clampNonNegative(offset, 0);
      const response = await fetchText(target, effectiveMaxBytes + effectiveOffset);
      const fullBody = response.body || "";
      const body = fullBody.slice(effectiveOffset, effectiveOffset + effectiveMaxBytes);

      return JSON.stringify({
        ok: response.ok,
        status: response.status,
        url: response.finalUrl,
        contentType: response.contentType,
        offset: effectiveOffset,
        maxBytes: effectiveMaxBytes,
        totalBytes: fullBody.length,
        hasMore: effectiveOffset + body.length < fullBody.length,
        body
      });
    },
    {
      name: "http_get",
      description: "Fetch raw HTTP response text with paging via offset/maxBytes",
      schema: z.object({
        url: z.string().min(1),
        maxBytes: z.number().int().positive().max(MAX_RAW_MAX_BYTES).nullable(),
        offset: z.number().int().nonnegative().nullable()
      })
    }
  );

  const web_search = tool(
    async ({ query }) => {
      const q = encodeURIComponent(query);
      const url = `https://duckduckgo.com/html/?q=${q}`;
      const res = await fetch(url, {
        headers: { "user-agent": DEFAULT_USER_AGENT }
      });
      const text = await res.text();
      const items = parseSearchResults(text);
      return JSON.stringify({ ok: res.ok, status: res.status, query, items });
    },
    {
      name: "web_search",
      description: "Search the web and return top links",
      schema: z.object({ query: z.string().min(1) })
    }
  );

  const web_page_read = tool(
    async ({ url, maxChars, offset, includeLinks }) => {
      const target = normalizeUrl(url);
      const effectiveMaxChars = clampPositive(maxChars, DEFAULT_PAGE_MAX_CHARS, MAX_PAGE_MAX_CHARS);
      const effectiveOffset = clampNonNegative(offset, 0);
      const response = await fetchText(target, MAX_PAGE_FETCH_BYTES);
      const title = extractTitle(response.body);
      const text = stripHtmlToText(response.body);
      const chunk = text.slice(effectiveOffset, effectiveOffset + effectiveMaxChars);
      const links = includeLinks ? extractLinks(response.body, response.finalUrl) : [];

      return JSON.stringify({
        ok: response.ok,
        status: response.status,
        url: response.finalUrl,
        contentType: response.contentType,
        title,
        offset: effectiveOffset,
        maxChars: effectiveMaxChars,
        totalChars: text.length,
        hasMore: effectiveOffset + chunk.length < text.length,
        text: chunk,
        links
      });
    },
    {
      name: "web_page_read",
      description: "Fetch a webpage, extract readable text, and page through the content",
      schema: z.object({
        url: z.string().min(1),
        maxChars: z.number().int().positive().max(MAX_PAGE_MAX_CHARS).nullable(),
        offset: z.number().int().nonnegative().nullable(),
        includeLinks: z.boolean().nullable()
      })
    }
  );

  const image_ingest = tool(
    async ({ pathOrUrl }) => {
      const target = String(pathOrUrl || "").trim();
      if (!target) {
        return JSON.stringify({ ok: false, error: "path_or_url_required" });
      }

      let bytes;
      let source;
      let mimeType = "image/png";

      if (/^https?:\/\//i.test(target)) {
        const url = normalizeUrl(target);
        const res = await fetch(url, {
          headers: { "user-agent": DEFAULT_USER_AGENT }
        });
        const contentType = String(res.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("image/")) {
          return JSON.stringify({ ok: false, error: "not_image_content_type", contentType });
        }
        const raw = Buffer.from(await res.arrayBuffer());
        bytes = raw;
        source = res.url || url;
        mimeType = contentType.split(";")[0] || mimeType;
      } else {
        const resolved = path.resolve(workdir, target);
        if (!isPathInside(workdir, resolved)) {
          return JSON.stringify({ ok: false, error: "path_outside_workdir", path: resolved });
        }
        bytes = await fs.readFile(resolved);
        source = resolved;
        const ext = path.extname(resolved).toLowerCase();
        if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
        if (ext === ".webp") mimeType = "image/webp";
        if (ext === ".gif") mimeType = "image/gif";
      }

      if (bytes.length > MAX_IMAGE_BYTES) {
        return JSON.stringify({
          ok: false,
          error: "image_too_large",
          bytes: bytes.length,
          maxBytes: MAX_IMAGE_BYTES,
          source
        });
      }

      return {
        logSummary: JSON.stringify({
          ok: true,
          source,
          bytes: bytes.length,
          mimeType
        }),
        toolMessageContent: [
          {
            type: "text",
            text: `Image loaded from ${source} (${bytes.length} bytes, ${mimeType}).`
          },
          {
            type: "image_url",
            image_url: { url: toDataUrl(bytes, mimeType) }
          }
        ],
        fingerprint: `image:${source}:${bytes.length}`
      };
    },
    {
      name: "image_ingest",
      description: "Load an image file or image URL and attach it so the model can inspect pixels",
      schema: z.object({
        pathOrUrl: z.string().min(1)
      })
    }
  );

  const browser_snapshot_page = tool(
    async ({ url, width, height, waitMs, quality }) => {
      const playwright = await loadPlaywright();
      if (!playwright || !playwright.chromium) {
        return JSON.stringify({
          ok: false,
          error: "playwright_not_installed",
          message: "Install playwright and browser binaries to enable browser_snapshot_page"
        });
      }

      const target = normalizeUrl(url);
      const viewportWidth = clampPositive(width, 1280, 2000);
      const viewportHeight = clampPositive(height, 800, 2000);
      const settleMs = clampNonNegative(waitMs, 1000);
      const jpegQuality = clampPositive(quality, 50, 90);
      const snapshotsDir = path.resolve(workdir, ".ender-snapshots");
      await fs.mkdir(snapshotsDir, { recursive: true });
      const fileName = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
      const filePath = path.join(snapshotsDir, fileName);

      let browser;
      try {
        browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage({
          viewport: { width: viewportWidth, height: viewportHeight }
        });
        await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
        if (settleMs > 0) {
          await page.waitForTimeout(settleMs);
        }

        await page.screenshot({
          path: filePath,
          fullPage: true,
          type: "jpeg",
          quality: jpegQuality
        });
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      const bytes = await fs.readFile(filePath);
      if (bytes.length > MAX_IMAGE_BYTES) {
        return JSON.stringify({
          ok: false,
          error: "snapshot_too_large",
          bytes: bytes.length,
          maxBytes: MAX_IMAGE_BYTES,
          path: filePath,
          message: "Try lower quality or narrower width"
        });
      }

      return {
        logSummary: JSON.stringify({
          ok: true,
          url: target,
          path: filePath,
          bytes: bytes.length,
          width: viewportWidth,
          height: viewportHeight
        }),
        toolMessageContent: [
          {
            type: "text",
            text: `Full-page snapshot captured for ${target}. Local path: ${filePath}`
          },
          {
            type: "image_url",
            image_url: { url: toDataUrl(bytes, "image/jpeg") }
          }
        ],
        fingerprint: `snapshot:${target}:${bytes.length}`
      };
    },
    {
      name: "browser_snapshot_page",
      description: "Use headless Chromium to capture a full-page snapshot and attach it for model analysis",
      schema: z.object({
        url: z.string().min(1),
        width: z.number().int().positive().max(2000).nullable(),
        height: z.number().int().positive().max(2000).nullable(),
        waitMs: z.number().int().nonnegative().max(10000).nullable(),
        quality: z.number().int().min(20).max(90).nullable()
      })
    }
  );

  return [http_get, web_search, web_page_read, image_ingest, browser_snapshot_page];
}

module.exports = { createWebTools };
