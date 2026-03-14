const path = require("node:path");

function createSafeJoin(rootDir) {
  const root = path.resolve(rootDir);
  const rooted = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  return (userPath) => {
    if (typeof userPath !== "string" || !userPath.trim()) {
      throw new Error("Invalid path");
    }
    const full = path.resolve(root, userPath);
    if (full !== root && !full.startsWith(rooted)) {
      throw new Error("Path escapes workspace root");
    }
    return full;
  };
}

module.exports = { createSafeJoin };
