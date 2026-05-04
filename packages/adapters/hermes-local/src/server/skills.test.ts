import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveHermesPaperclipSkillsRoot,
  syncHermesSkills,
} from "./skills.js";

interface Fixture {
  hermesHome: string;
  paperclipRoot: string;
  cleanup: () => Promise<void>;
  configWith: (params: {
    desiredSkills?: string[];
    runtimeSkills: Array<{ slug: string; description?: string; body?: string; required?: boolean }>;
  }) => Promise<Record<string, unknown>>;
}

async function setup(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-skills-"));
  const hermesHome = path.join(root, "hermes-home");
  const sourceRoot = path.join(root, "source-skills");
  await fs.mkdir(hermesHome, { recursive: true });
  await fs.mkdir(sourceRoot, { recursive: true });

  const configWith: Fixture["configWith"] = async ({ desiredSkills, runtimeSkills }) => {
    const paperclipRuntimeSkills = [];
    for (const skill of runtimeSkills) {
      const dir = path.join(sourceRoot, skill.slug);
      await fs.mkdir(dir, { recursive: true });
      const description = skill.description ?? `Test description for ${skill.slug}.`;
      const body = skill.body ?? `# ${skill.slug}\n\nBody content for ${skill.slug}.\n`;
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        `---\nname: ${skill.slug}\ndescription: ${description}\n---\n\n${body}`,
        "utf8",
      );
      paperclipRuntimeSkills.push({
        key: `paperclipai/paperclip/${skill.slug}`,
        runtimeName: skill.slug,
        source: dir,
        required: Boolean(skill.required),
      });
    }
    const config: Record<string, unknown> = {
      hermesHome,
      paperclipRuntimeSkills,
    };
    if (desiredSkills) {
      config.paperclipSkillSync = { desiredSkills };
    }
    return config;
  };

  return {
    hermesHome,
    paperclipRoot: path.join(hermesHome, "skills", "paperclip"),
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
    configWith,
  };
}

describe("syncHermesSkills", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await setup();
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("writes desired skills as SKILL.md with the required Hermes frontmatter", async () => {
    const config = await fixture.configWith({
      desiredSkills: ["paperclipai/paperclip/skill-a"],
      runtimeSkills: [{ slug: "skill-a", description: "Sync this one." }],
    });
    expect(resolveHermesPaperclipSkillsRoot(config)).toBe(fixture.paperclipRoot);

    const snapshot = await syncHermesSkills(
      { agentId: "a", companyId: "c", adapterType: "hermes_local", config },
      [],
    );

    const written = await fs.readFile(
      path.join(fixture.paperclipRoot, "skill-a", "SKILL.md"),
      "utf8",
    );
    expect(written.startsWith("---\n")).toBe(true);
    expect(written).toContain('name: "skill-a"');
    expect(written).toContain('description: "Sync this one."');
    expect(written).toContain('version: "0.0.0"');
    expect(written).toContain('license: "MIT"');
    expect(written).toContain('platforms: ["linux", "macos", "windows"]');
    expect(written).toContain("metadata:");
    expect(written).toContain('companySkillId: "paperclipai/paperclip/skill-a"');
    expect(written).toContain("syncedAt:");
    expect(written).toMatch(/sourceRef: ".*skill-a"/);
    expect(written).toContain("Body content for skill-a.");

    expect(snapshot.adapterType).toBe("hermes_local");
    expect(snapshot.mode).toBe("persistent");
    expect(snapshot.desiredSkills).toEqual(["paperclipai/paperclip/skill-a"]);
  });

  it("reconciles by deleting paperclip/<slug> folders that drop out of the desired set", async () => {
    const config1 = await fixture.configWith({
      desiredSkills: ["paperclipai/paperclip/a", "paperclipai/paperclip/b"],
      runtimeSkills: [{ slug: "a" }, { slug: "b" }],
    });
    await syncHermesSkills(
      { agentId: "agent", companyId: "co", adapterType: "hermes_local", config: config1 },
      [],
    );
    expect(
      (await fs.stat(path.join(fixture.paperclipRoot, "a"))).isDirectory(),
    ).toBe(true);
    expect(
      (await fs.stat(path.join(fixture.paperclipRoot, "b"))).isDirectory(),
    ).toBe(true);

    const config2 = await fixture.configWith({
      desiredSkills: ["paperclipai/paperclip/a"],
      runtimeSkills: [{ slug: "a" }, { slug: "b" }],
    });
    await syncHermesSkills(
      { agentId: "agent", companyId: "co", adapterType: "hermes_local", config: config2 },
      [],
    );

    await expect(
      fs.stat(path.join(fixture.paperclipRoot, "a")),
    ).resolves.toMatchObject({});
    await expect(
      fs.stat(path.join(fixture.paperclipRoot, "b")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never touches user-curated folders or files outside paperclip/", async () => {
    const skillsRoot = path.join(fixture.hermesHome, "skills");
    const userSkillDir = path.join(skillsRoot, "user-skill");
    await fs.mkdir(userSkillDir, { recursive: true });
    await fs.writeFile(path.join(userSkillDir, "SKILL.md"), "user content", "utf8");
    await fs.writeFile(path.join(skillsRoot, "README.md"), "user readme", "utf8");

    const config = await fixture.configWith({
      desiredSkills: ["paperclipai/paperclip/managed"],
      runtimeSkills: [{ slug: "managed" }],
    });

    await syncHermesSkills(
      { agentId: "a", companyId: "c", adapterType: "hermes_local", config },
      [],
    );

    expect(
      await fs.readFile(path.join(userSkillDir, "SKILL.md"), "utf8"),
    ).toBe("user content");
    expect(
      await fs.readFile(path.join(skillsRoot, "README.md"), "utf8"),
    ).toBe("user readme");
    expect(
      (await fs.stat(path.join(fixture.paperclipRoot, "managed"))).isDirectory(),
    ).toBe(true);
  });
});
