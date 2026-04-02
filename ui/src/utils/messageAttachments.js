const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 512 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "html",
  "css",
  "scss",
  "xml",
  "yml",
  "yaml",
  "csv",
  "sql",
  "py",
  "rb",
  "java",
  "kt",
  "go",
  "rs",
  "sh",
  "bash",
  "zsh",
  "ini",
  "toml",
  "env",
  "log"
]);

function createAttachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function isImageFile(file) {
  return String(file?.type || "").toLowerCase().startsWith("image/");
}

function isTextLikeFile(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("text/")) return true;
  if (type.includes("json") || type.includes("xml") || type.includes("yaml")) return true;
  return TEXT_EXTENSIONS.has(getExtension(file?.name));
}

function inferFenceLanguage(file) {
  const ext = getExtension(file?.name);
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "yml") return "yaml";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "sh";
  return ext;
}

function readFile(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name || "attachment"}.`));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    if (mode === "data-url") {
      reader.readAsDataURL(file);
      return;
    }
    reader.readAsText(file);
  });
}

async function prepareImageAttachment(file) {
  if ((file?.size || 0) > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than 2 MB.`);
  }

  const dataUrl = await readFile(file, "data-url");
  const summary = `${file.name} (${file.type || "image"}, ${formatBytes(file.size)})`;

  return {
    id: createAttachmentId(),
    name: file.name,
    mimeType: file.type || "image/*",
    size: file.size || 0,
    sizeLabel: formatBytes(file.size),
    kind: "image",
    previewUrl: dataUrl,
    blocks: [
      { type: "text", text: `Attached image: ${summary}` },
      { type: "image_url", image_url: { url: dataUrl, detail: "auto" } }
    ]
  };
}

async function prepareTextAttachment(file) {
  if ((file?.size || 0) > MAX_TEXT_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 512 KB.`);
  }

  const text = await readFile(file, "text");
  const language = inferFenceLanguage(file);
  const summary = `${file.name} (${file.type || "text/plain"}, ${formatBytes(file.size)})`;
  const fence = language ? `\`\`\`${language}` : "```";

  return {
    id: createAttachmentId(),
    name: file.name,
    mimeType: file.type || "text/plain",
    size: file.size || 0,
    sizeLabel: formatBytes(file.size),
    kind: "text",
    blocks: [
      {
        type: "text",
        text: `Attached file: ${summary}\n\n${fence}\n${text}\n\`\`\``
      }
    ]
  };
}

function prepareBinaryAttachment(file) {
  const summary = `${file.name} (${file.type || "binary"}, ${formatBytes(file.size)})`;
  return {
    id: createAttachmentId(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size || 0,
    sizeLabel: formatBytes(file.size),
    kind: "file",
    blocks: [
      {
        type: "text",
        text: `Attached file: ${summary}\n\nBinary file attached. Its contents were not inlined into the prompt.`
      }
    ]
  };
}

async function prepareSingleAttachment(file) {
  if (isImageFile(file)) {
    return prepareImageAttachment(file);
  }
  if (isTextLikeFile(file)) {
    return prepareTextAttachment(file);
  }
  return prepareBinaryAttachment(file);
}

export async function prepareMessageAttachments(fileList, options = {}) {
  const files = Array.from(fileList || []);
  const existingCount = Number(options.existingCount) || 0;
  const remainingSlots = Math.max(0, MAX_ATTACHMENTS - existingCount);
  const items = [];
  const errors = [];

  if (!remainingSlots) {
    return {
      items,
      errors: [`You can attach up to ${MAX_ATTACHMENTS} files per message.`]
    };
  }

  if (files.length > remainingSlots) {
    errors.push(`Only ${remainingSlots} more attachment${remainingSlots === 1 ? "" : "s"} can be added to this message.`);
  }

  for (const file of files.slice(0, remainingSlots)) {
    try {
      items.push(await prepareSingleAttachment(file));
    } catch (error) {
      errors.push(error?.message || `Failed to prepare ${file?.name || "attachment"}.`);
    }
  }

  return { items, errors };
}

export { MAX_ATTACHMENTS };
