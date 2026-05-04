import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  readHermesLocalSkillImports,
  resolveHermesHomeFromConfig,
} from "../services/company-skills.js";

const cleanupDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs, (dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.add(dir);
  return dir;
}

async function writeSkillFile(skillDir: string, name: string, description = `${name} desc`) {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody for ${name}.\n`,
    "utf8",
  );
}

const COMPANY_ID = "44444444-4444-4444-8444-444444444444";

describe("readHermesLocalSkillImports", () => {
  it("imports SKILL.md from non-paperclip namespaces and skips paperclip/*", async () => {
    const hermesHome = await makeTempDir("hermes-home-import-");
    const skillsRoot = path.join(hermesHome, "skills");
    await writeSkillFile(path.join(skillsRoot, "claude-local", "review-helper"), "review-helper");
    await writeSkillFile(path.join(skillsRoot, "claude-local", "deploy-checklist"), "deploy-checklist");
    await writeSkillFile(path.join(skillsRoot, "user-skill"), "user-skill");
    // The paperclip-namespaced skill must NOT be imported (would round-trip).
    await writeSkillFile(path.join(skillsRoot, "paperclip", "internal-helper"), "internal-helper");

    const imported = await readHermesLocalSkillImports(COMPANY_ID, hermesHome);

    const slugs = imported.map((skill) => skill.slug).sort();
    expect(slugs).toEqual(["deploy-checklist", "review-helper", "user-skill"]);
    expect(slugs).not.toContain("internal-helper");
  });

  it("annotates each imported skill with hermes_local source metadata", async () => {
    const hermesHome = await makeTempDir("hermes-home-meta-");
    await writeSkillFile(path.join(hermesHome, "skills", "tools", "lint-it"), "lint-it", "Lints the world.");

    const [skill] = await readHermesLocalSkillImports(COMPANY_ID, hermesHome);

    expect(skill).toBeDefined();
    expect(skill.sourceType).toBe("hermes_local");
    expect(skill.trustLevel).toBe("markdown_only");
    expect(skill.sourceLocator).toBe("tools/lint-it");
    expect(skill.metadata).toMatchObject({
      sourceKind: "hermes_local",
      hermesHome,
      hermesNamespace: "tools",
      hermesRelativePath: "tools/lint-it",
    });
    expect(skill.key.startsWith("hermes_local/")).toBe(true);
    expect(skill.description).toBe("Lints the world.");
    expect(skill.fileInventory.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  it("returns no imports when the only skills are under paperclip/*", async () => {
    const hermesHome = await makeTempDir("hermes-home-only-paperclip-");
    await writeSkillFile(path.join(hermesHome, "skills", "paperclip", "managed"), "managed");

    const imported = await readHermesLocalSkillImports(COMPANY_ID, hermesHome);
    expect(imported).toEqual([]);
  });

  it("rejects when the hermes skills directory is missing", async () => {
    const hermesHome = await makeTempDir("hermes-home-missing-");
    await expect(readHermesLocalSkillImports(COMPANY_ID, hermesHome)).rejects.toThrow(
      /Hermes skills directory does not exist/,
    );
  });
});

describe("resolveHermesHomeFromConfig", () => {
  it("prefers config.hermesHome when set", () => {
    const resolved = resolveHermesHomeFromConfig({ hermesHome: "/tmp/h" });
    expect(resolved).toBe(path.resolve("/tmp/h"));
  });

  it("falls back to HERMES_HOME env when config does not provide a value", () => {
    const previous = process.env.HERMES_HOME;
    process.env.HERMES_HOME = "/var/hermes-env";
    try {
      const resolved = resolveHermesHomeFromConfig({});
      expect(resolved).toBe(path.resolve("/var/hermes-env"));
    } finally {
      if (previous === undefined) {
        delete process.env.HERMES_HOME;
      } else {
        process.env.HERMES_HOME = previous;
      }
    }
  });

  it("defaults to ~/.hermes when nothing is configured", () => {
    const previous = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const resolved = resolveHermesHomeFromConfig(null);
      expect(resolved).toBe(path.join(os.homedir(), ".hermes"));
    } finally {
      if (previous !== undefined) process.env.HERMES_HOME = previous;
    }
  });
});
