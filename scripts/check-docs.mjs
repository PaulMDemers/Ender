import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const rootMarkdown = fs.readdirSync(rootDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => path.join(rootDir, entry.name));

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return entry.isFile() && entry.name.endsWith(".md") ? [target] : [];
  });
}

const files = [
  ...rootMarkdown,
  ...markdownFiles(path.join(rootDir, "docs")),
  ...markdownFiles(path.join(rootDir, "knowledge")),
  ...markdownFiles(path.join(rootDir, "wiki")),
  ...markdownFiles(path.join(rootDir, "raw"))
].sort();
const maintainedRoots = new Set(["docs", "knowledge"]);
const failures = [];
const localLinkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;
const npmRunPattern = /\bnpm run ([a-zA-Z0-9:_-]+)/g;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relativeFile = path.relative(rootDir, file);

  for (const match of source.matchAll(localLinkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(rawTarget)) continue;

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]);
    } catch {
      failures.push(`${relativeFile}: invalid encoded link target ${rawTarget}`);
      continue;
    }
    if (!decodedTarget) continue;

    const resolved = path.resolve(path.dirname(file), decodedTarget);
    if (!fs.existsSync(resolved)) {
      failures.push(`${relativeFile}: missing local link target ${rawTarget}`);
    }
  }

  const topLevelDirectory = relativeFile.split(path.sep)[0];
  const validatesCommands = !relativeFile.includes(path.sep) || maintainedRoots.has(topLevelDirectory);
  if (!validatesCommands) continue;

  for (const match of source.matchAll(npmRunPattern)) {
    const scriptName = match[1];
    if (!Object.hasOwn(packageJson.scripts, scriptName)) {
      failures.push(`${relativeFile}: references unknown root npm script ${scriptName}`);
    }
  }
}

const requiredLinks = [
  ["README.md", "docs/README.md"],
  ["README.md", "RELEASE_READINESS.md"],
  ["docs/README.md", "guides/troubleshooting.md"],
  ["docs/README.md", "../RELEASE_READINESS.md"],
  ["RELEASE_READINESS.md", "docs/guides/troubleshooting.md"]
];

for (const [fileName, target] of requiredLinks) {
  const source = fs.readFileSync(path.join(rootDir, fileName), "utf8");
  if (!source.includes(`](${target})`)) {
    failures.push(`${fileName}: must link to ${target}`);
  }
}

if (failures.length) {
  console.error(`Documentation check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed for ${files.length} Markdown files.`);
}
