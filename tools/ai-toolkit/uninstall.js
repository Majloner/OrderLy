#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const pkg = require("./package.json");
const PACKAGE_NAME = pkg.name;
const BEGIN = `<!-- BEGIN ${PACKAGE_NAME} -->`;
const END = `<!-- END ${PACKAGE_NAME} -->`;
const MANIFEST = ".ai-toolkit-manifest.json";

function removeRulesBlock(content) {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    return content;
  }
  return (content.slice(0, start) + content.slice(end + END.length)).replace(/\n{3,}/g, "\n\n");
}

function pruneEmptyDirs(startDir, stopDir) {
  let dir = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  while (dir.startsWith(stop) && dir !== stop) {
    try {
      if (fs.readdirSync(dir).length > 0) {
        return;
      }
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

function main() {
  const projectRoot = process.env.PROJECT_ROOT || process.cwd();
  const manifestPath = path.join(projectRoot, ".claude", MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    console.log(`${PACKAGE_NAME}: no manifest found, nothing to uninstall`);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const parentDirs = new Set();
  for (const relPath of manifest.files || []) {
    if (relPath === "CLAUDE.md") {
      continue; // rules are removed surgically below, never the whole file
    }
    const absPath = path.join(projectRoot, relPath);
    fs.rmSync(absPath, { recursive: true, force: true });
    parentDirs.add(path.dirname(absPath));
  }
  for (const dir of parentDirs) {
    pruneEmptyDirs(dir, path.resolve(projectRoot));
  }

  const rulesPath = path.join(projectRoot, "CLAUDE.md");
  if (fs.existsSync(rulesPath)) {
    fs.writeFileSync(rulesPath, removeRulesBlock(fs.readFileSync(rulesPath, "utf8")));
  }

  fs.rmSync(manifestPath, { force: true });
  pruneEmptyDirs(path.dirname(manifestPath), projectRoot);
  console.log(`${PACKAGE_NAME}: uninstalled managed files`);
}

module.exports = { removeRulesBlock, main };

if (require.main === module) {
  main();
}
