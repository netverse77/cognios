import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
  type PaperclipSkillEntry,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

const HERMES_PAPERCLIP_NAMESPACE = "paperclip";
const HERMES_PAPERCLIP_SKILL_VERSION = "0.0.0";
const HERMES_PAPERCLIP_SKILL_LICENSE = "MIT";
const HERMES_PAPERCLIP_SKILL_PLATFORMS = ["linux", "macos", "windows"] as const;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveHermesPaperclipSkillsRoot(config: Record<string, unknown>): string {
  const configuredHome = asString(config.hermesHome);
  const home = configuredHome ? path.resolve(configuredHome) : path.join(os.homedir(), ".hermes");
  return path.join(home, "skills", HERMES_PAPERCLIP_NAMESPACE);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function clampSkillName(slug: string): string {
  const trimmed = slug.trim();
  return truncate(trimmed.length > 0 ? trimmed : "skill", MAX_NAME_LENGTH);
}

function extractSourceFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: "", body: raw };
  const closing = raw.indexOf("\n---", 3);
  if (closing < 0) return { frontmatter: "", body: raw };
  const afterFence = raw.indexOf("\n", closing + 4);
  const frontmatter = raw.slice(3, closing).replace(/^\s*\n/, "");
  const body = afterFence < 0 ? "" : raw.slice(afterFence + 1);
  return { frontmatter, body };
}

function readDescriptionFromFrontmatter(frontmatter: string): string | null {
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = /^description\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const head = (match[1] ?? "").trim();
    if (head === "" || head === ">" || head === "|" || head === ">-" || head === "|-") {
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j] ?? "";
        if (next.length === 0) {
          collected.push("");
          continue;
        }
        if (!/^\s/.test(next)) break;
        collected.push(next.trim());
      }
      const joined = collected.join(" ").replace(/\s+/g, " ").trim();
      return joined.length > 0 ? joined : null;
    }
    return head.replace(/^['"]|['"]$/g, "").trim() || null;
  }
  return null;
}

async function loadSourceSkillMarkdown(
  sourceDir: string,
): Promise<{ description: string | null; body: string }> {
  try {
    const raw = await fs.readFile(path.join(sourceDir, "SKILL.md"), "utf8");
    const { frontmatter, body } = extractSourceFrontmatter(raw);
    return { description: readDescriptionFromFrontmatter(frontmatter), body };
  } catch {
    return { description: null, body: "" };
  }
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderHermesSkillFrontmatter(input: {
  slug: string;
  description: string;
  companySkillId: string;
  syncedAt: string;
  sourceRef: string;
}): string {
  const name = clampSkillName(input.slug);
  const description = truncate(input.description, MAX_DESCRIPTION_LENGTH);
  const platforms = HERMES_PAPERCLIP_SKILL_PLATFORMS.map((p) => `"${p}"`).join(", ");
  return [
    "---",
    `name: "${escapeYamlString(name)}"`,
    `description: "${escapeYamlString(description)}"`,
    `version: "${HERMES_PAPERCLIP_SKILL_VERSION}"`,
    `license: "${HERMES_PAPERCLIP_SKILL_LICENSE}"`,
    `platforms: [${platforms}]`,
    "metadata:",
    "  paperclip:",
    `    companySkillId: "${escapeYamlString(input.companySkillId)}"`,
    `    syncedAt: "${escapeYamlString(input.syncedAt)}"`,
    `    sourceRef: "${escapeYamlString(input.sourceRef)}"`,
    "---",
    "",
  ].join("\n");
}

async function materializeSkill(
  paperclipRoot: string,
  entry: PaperclipSkillEntry,
  syncedAt: string,
): Promise<void> {
  const targetDir = path.join(paperclipRoot, entry.runtimeName);
  await fs.mkdir(targetDir, { recursive: true });
  const { description, body } = await loadSourceSkillMarkdown(entry.source);
  const fallbackDescription = `Paperclip skill ${entry.runtimeName} synced into Hermes from ${entry.key}.`;
  const frontmatter = renderHermesSkillFrontmatter({
    slug: entry.runtimeName,
    description: description ?? fallbackDescription,
    companySkillId: entry.key,
    syncedAt,
    sourceRef: entry.source,
  });
  const trimmedBody = body.replace(/^\s+/, "");
  const content = trimmedBody.length > 0 ? `${frontmatter}${trimmedBody}` : frontmatter;
  await fs.writeFile(path.join(targetDir, "SKILL.md"), content, "utf8");
}

async function reconcileExistingPaperclipFolders(
  paperclipRoot: string,
  desiredRuntimeNames: Set<string>,
): Promise<void> {
  const existing = await fs
    .readdir(paperclipRoot, { withFileTypes: true })
    .catch(() => [] as Array<{ name: string; isDirectory(): boolean }>);
  for (const dirent of existing) {
    if (!dirent.isDirectory()) continue;
    if (desiredRuntimeNames.has(dirent.name)) continue;
    await fs.rm(path.join(paperclipRoot, dirent.name), { recursive: true, force: true });
  }
}

async function buildHermesSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const availableByKey = new Map(availableEntries.map((entry) => [entry.key, entry]));
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const desiredSet = new Set(desiredSkills);
  const paperclipRoot = resolveHermesPaperclipSkillsRoot(config);

  const entries: AdapterSkillEntry[] = availableEntries.map((entry) => {
    const desired = desiredSet.has(entry.key);
    return {
      key: entry.key,
      runtimeName: entry.runtimeName,
      desired,
      managed: true,
      state: desired ? "configured" : "available",
      origin: entry.required ? "paperclip_required" : "company_managed",
      originLabel: entry.required ? "Required by Paperclip" : "Managed by Paperclip",
      readOnly: false,
      sourcePath: entry.source,
      targetPath: desired ? path.join(paperclipRoot, entry.runtimeName, "SKILL.md") : null,
      detail: desired
        ? "Materialized into the Paperclip-managed Hermes skills namespace on the next sync."
        : null,
      required: Boolean(entry.required),
      requiredReason: entry.requiredReason ?? null,
    };
  });
  const warnings: string[] = [];

  for (const desiredSkill of desiredSkills) {
    if (availableByKey.has(desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available from the Paperclip skills directory.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
      sourcePath: null,
      targetPath: null,
      detail: "Paperclip cannot find this skill in the local runtime skills directory.",
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));

  return {
    adapterType: "hermes_local",
    supported: true,
    mode: "persistent",
    desiredSkills,
    entries,
    warnings,
  };
}

export async function listHermesSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildHermesSkillSnapshot(ctx.config);
}

export async function syncHermesSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const availableByKey = new Map(availableEntries.map((entry) => [entry.key, entry]));
  const desiredKeys = resolvePaperclipDesiredSkillNames(ctx.config, availableEntries);
  const desiredEntries = desiredKeys
    .map((key) => availableByKey.get(key))
    .filter((entry): entry is PaperclipSkillEntry => Boolean(entry));
  const desiredRuntimeNames = new Set(desiredEntries.map((entry) => entry.runtimeName));
  const paperclipRoot = resolveHermesPaperclipSkillsRoot(ctx.config);

  await fs.mkdir(paperclipRoot, { recursive: true });
  const syncedAt = new Date().toISOString();
  for (const entry of desiredEntries) {
    await materializeSkill(paperclipRoot, entry, syncedAt);
  }
  await reconcileExistingPaperclipFolders(paperclipRoot, desiredRuntimeNames);

  return buildHermesSkillSnapshot(ctx.config);
}

export function resolveHermesDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; required?: boolean }>,
) {
  return resolvePaperclipDesiredSkillNames(config, availableEntries);
}
