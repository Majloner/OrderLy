const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { applyRulesBlock, main: installMain } = require("../install.js");
const { removeRulesBlock, main: uninstallMain } = require("../uninstall.js");
const pkg = require("../package.json");

const BEGIN = `<!-- BEGIN ${pkg.name} -->`;
const END = `<!-- END ${pkg.name} -->`;
const RULES = "# Team rules\n\n- rule one\n- rule two";

describe("applyRulesBlock", () => {
  it("appends the block to an empty file", () => {
    const out = applyRulesBlock("", RULES);
    assert.ok(out.includes(BEGIN));
    assert.ok(out.includes(END));
    assert.ok(out.includes("rule one"));
  });

  it("appends the block after existing content, preserving it", () => {
    const out = applyRulesBlock("# Project\n\nExisting content.\n", RULES);
    assert.ok(out.startsWith("# Project"));
    assert.ok(out.includes("Existing content."));
    assert.ok(out.indexOf(BEGIN) > out.indexOf("Existing content."));
  });

  it("is idempotent: a second apply replaces the block instead of duplicating it", () => {
    const once = applyRulesBlock("# Project\n", RULES);
    const twice = applyRulesBlock(once, "# Team rules\n\n- updated rule");
    assert.equal(twice.split(BEGIN).length - 1, 1, "exactly one BEGIN sentinel");
    assert.equal(twice.split(END).length - 1, 1, "exactly one END sentinel");
    assert.ok(twice.includes("updated rule"));
    assert.ok(!twice.includes("rule one"), "old block content replaced");
  });

  it("preserves content after the block on update", () => {
    const withTail = applyRulesBlock("# Project\n", RULES) + "\nTrailing notes.\n";
    const updated = applyRulesBlock(withTail, "- new");
    assert.ok(updated.includes("Trailing notes."));
  });
});

describe("removeRulesBlock", () => {
  it("removes the managed block and keeps the rest", () => {
    const content = applyRulesBlock("# Project\n\nKeep me.\n", RULES);
    const out = removeRulesBlock(content);
    assert.ok(!out.includes(BEGIN));
    assert.ok(!out.includes("rule one"));
    assert.ok(out.includes("Keep me."));
  });

  it("is a no-op when no sentinels are present", () => {
    assert.equal(removeRulesBlock("# Plain file\n"), "# Plain file\n");
  });

  it("round-trips apply → remove without residue beyond whitespace", () => {
    const original = "# Project\n\nBody.\n";
    const out = removeRulesBlock(applyRulesBlock(original, RULES));
    assert.equal(out.replace(/\s+$/g, "\n"), original);
  });
});

describe("full install/uninstall cycle against a temp project root", () => {
  let tmpRoot;
  let savedProjectRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-toolkit-test-"));
    savedProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (savedProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = savedProjectRoot;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("installs skills, rules block and manifest", () => {
    installMain();

    const skillPath = path.join(tmpRoot, ".claude", "skills", "code-review", "SKILL.md");
    assert.ok(fs.existsSync(skillPath), "skill copied");

    const claudeMd = fs.readFileSync(path.join(tmpRoot, "CLAUDE.md"), "utf8");
    assert.ok(claudeMd.includes(BEGIN) && claudeMd.includes(END), "rules block injected");

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".claude", ".ai-toolkit-manifest.json"), "utf8"));
    assert.equal(manifest.package, pkg.name);
    assert.equal(manifest.version, pkg.version);
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
    assert.ok(manifest.files.includes("CLAUDE.md"));
  });

  it("re-install does not duplicate the rules block", () => {
    installMain();
    installMain();

    const claudeMd = fs.readFileSync(path.join(tmpRoot, "CLAUDE.md"), "utf8");
    assert.equal(claudeMd.split(BEGIN).length - 1, 1, "exactly one managed block");
  });

  it("uninstall leaves the project clean", () => {
    fs.writeFileSync(path.join(tmpRoot, "CLAUDE.md"), "# Consumer project\n\nOwn rules.\n");
    installMain();
    uninstallMain();

    assert.ok(!fs.existsSync(path.join(tmpRoot, ".claude", "skills", "code-review")), "skill removed");
    assert.ok(!fs.existsSync(path.join(tmpRoot, ".claude", ".ai-toolkit-manifest.json")), "manifest removed");

    const claudeMd = fs.readFileSync(path.join(tmpRoot, "CLAUDE.md"), "utf8");
    assert.ok(!claudeMd.includes(BEGIN), "rules block removed");
    assert.ok(claudeMd.includes("Own rules."), "consumer content preserved");
  });

  it("uninstall without a manifest is a safe no-op", () => {
    assert.doesNotThrow(() => uninstallMain());
  });
});
