import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { validateStageOps } from "./stage-share.js";
import { validateSockets, type AssemblySocket } from "./stage-sockets.js";
import type { StageOp } from "./stage-state.js";
import { writeAtomicFile } from "./atomic-file.js";

export const LIBRARY_FORMAT = "buildkit-library" as const;
export const LIBRARY_VERSION = 2 as const;
export const LIBRARY_EXTENSION = ".json";
export const RECENT_LIBRARY_LIMIT = 20;
const CATEGORIES_FILE = "categories.json";
const MAX_PREVIEW_BYTES = 512 * 1024;

export type LibraryOrigin = "user" | "ai";
export type LibraryKind = "saved" | "recent";
export type LibraryCategory = { id: string; name: string; createdBy: LibraryOrigin };

export type LibraryPreset = {
  format: typeof LIBRARY_FORMAT;
  version: typeof LIBRARY_VERSION;
  name: string;
  created: string;
  updated: string;
  ops: StageOp[];
  sockets?: AssemblySocket[];
  preview?: string;
  origin: LibraryOrigin;
  kind: LibraryKind;
  category: string | null;
};

export type LibraryEntry = LibraryPreset & { file: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Vec3 = [number, number, number];

function vec3(value: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)))
    ? value.map(Number) as Vec3
    : [...fallback];
}

export function libraryPreview(ops: StageOp[]) {
  const parts: { pos: Vec3; size: Vec3; color?: Vec3 }[] = [];
  for (const op of ops) {
    const args = op.args;
    if (args.kind === "prop" && Array.isArray(args.parts)) {
      const center = Array.isArray(args.center) ? args.center : [];
      for (const value of args.parts) {
        if (!isRecord(value)) continue;
        const pos = vec3(value.pos);
        parts.push({
          pos: pos.map((item, index) => Number(center[index] || 0) + item) as Vec3,
          size: vec3(value.size, [1, 1, 1]),
          color: vec3(value.color, [150, 150, 150]),
        });
      }
    } else if (Array.isArray(args.center)) {
      parts.push({ pos: vec3(args.center), size: vec3(args.size, [4, 4, 4]) });
    }
  }
  if (!parts.length) return null;
  const minX = Math.min(...parts.map((part) => part.pos[0] - part.size[0] / 2));
  const maxX = Math.max(...parts.map((part) => part.pos[0] + part.size[0] / 2));
  const minZ = Math.min(...parts.map((part) => part.pos[2] - part.size[2] / 2));
  const maxZ = Math.max(...parts.map((part) => part.pos[2] + part.size[2] / 2));
  return {
    minX, maxX, minZ, maxZ,
    parts: parts.map(({ pos, size, color }) => ({ x: pos[0], z: pos[2], w: size[0], h: size[2], color })),
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`library ${field} must be a non-empty string`);
  return value.trim();
}

function validateOrigin(value: unknown): LibraryOrigin {
  if (value !== "user" && value !== "ai") throw new Error("library origin must be user or ai");
  return value;
}

function validateKind(value: unknown): LibraryKind {
  if (value !== "saved" && value !== "recent") throw new Error("library kind must be saved or recent");
  return value;
}

function validateCategory(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value, "category");
}

function categoryId(name: string): string {
  const id = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return id || "category";
}

function validateCategories(value: unknown): LibraryCategory[] {
  if (!Array.isArray(value)) throw new Error("library categories must be an array");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("library category must be an object");
    const category = {
      id: requiredString(item.id, "category id"),
      name: requiredString(item.name, "category name"),
      createdBy: validateOrigin(item.createdBy),
    };
    if (ids.has(category.id)) throw new Error(`duplicate library category id: ${category.id}`);
    ids.add(category.id);
    return category;
  });
}

export function sanitizeLibraryFilename(value: string): string {
  const stem = value.replace(/\.json$/i, "").trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "").replace(/^\.+/g, "").replace(/\.{2,}/g, "-").slice(0, 96);
  const safe = stem || "preset";
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe.split(".", 1)[0]) ? `_${safe}` : safe;
  return `${reserved}${LIBRARY_EXTENSION}`;
}

export function validateLibraryPreset(value: unknown): LibraryPreset {
  if (!isRecord(value)) throw new Error("Invalid library preset: expected an object");
  if (value.format !== LIBRARY_FORMAT) throw new Error(`Unsupported library format: ${String(value.format)}`);
  const legacy = value.version === 1;
  if (!legacy && value.version !== LIBRARY_VERSION) throw new Error(`Unsupported library version: ${String(value.version)}`);
  const name = requiredString(value.name, "name");
  const created = requiredString(value.created, "created");
  const updated = requiredString(value.updated, "updated");
  const ops = validateStageOps(value.ops, "buildkit-library");
  let preview: string | undefined;
  if (value.preview !== undefined) {
    if (typeof value.preview !== "string") throw new Error("library preview must be a string");
    if (Buffer.byteLength(value.preview, "utf8") > MAX_PREVIEW_BYTES) throw new Error(`library preview exceeds ${MAX_PREVIEW_BYTES} bytes`);
    preview = value.preview;
  }
  const sockets = value.sockets === undefined ? undefined : validateSockets(value.sockets);
  const origin = legacy ? "user" : validateOrigin(value.origin);
  const kind = legacy ? "saved" : validateKind(value.kind);
  const category = legacy ? null : validateCategory(value.category);
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    name,
    created,
    updated,
    ops,
    origin,
    kind,
    category,
    ...(sockets === undefined ? {} : { sockets }),
    ...(preview === undefined ? {} : { preview }),
  };
}

export function encodeLibraryPreset(input: {
  name: string; ops: unknown; created?: string; updated?: string; preview?: unknown;
  sockets?: unknown; origin?: LibraryOrigin; kind?: LibraryKind; category?: string | null;
}): string {
  const now = new Date().toISOString();
  return JSON.stringify(validateLibraryPreset({
    format: LIBRARY_FORMAT, version: LIBRARY_VERSION, name: input.name,
    created: input.created ?? now, updated: input.updated ?? now, ops: input.ops,
    origin: input.origin ?? "user", kind: input.kind ?? "saved", category: input.category ?? null,
    ...(input.sockets === undefined ? {} : { sockets: input.sockets }),
    ...(input.preview === undefined ? {} : { preview: input.preview }),
  }));
}

export function decodeLibraryPreset(serializedOrData: unknown): LibraryPreset {
  let data = serializedOrData;
  if (typeof serializedOrData === "string") {
    try {
      data = JSON.parse(serializedOrData);
    } catch (error) {
      throw new Error(`Invalid library JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return validateLibraryPreset(data);
}

export class LibraryStore {
  readonly directory: string;
  private entries = new Map<string, LibraryEntry>();
  private categories: LibraryCategory[] = [];
  private categoryTail: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await this.discover();
  }

  async discover(): Promise<LibraryEntry[]> {
    await mkdir(this.directory, { recursive: true });
    try {
      this.categories = validateCategories(JSON.parse(await readFile(path.join(this.directory, CATEGORIES_FILE), "utf8")));
    } catch (error: any) {
      if (error?.code !== "ENOENT") console.error(`[buildkit] ignoring invalid library categories: ${error instanceof Error ? error.message : String(error)}`);
      this.categories = [];
    }
    const next = new Map<string, LibraryEntry>();
    for (const item of await readdir(this.directory, { withFileTypes: true })) {
      if (!item.isFile() || item.name === CATEGORIES_FILE || path.extname(item.name).toLowerCase() !== LIBRARY_EXTENSION) continue;
      try {
        const value = decodeLibraryPreset(await readFile(path.join(this.directory, item.name), "utf8"));
        next.set(item.name, { ...value, file: item.name });
      } catch (error) {
        console.error(`[buildkit] ignoring invalid library preset ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.entries = next;
    return this.list();
  }

  list(): LibraryEntry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  }

  listCategories(): LibraryCategory[] {
    return this.categories.map((category) => ({ ...category }));
  }

  async createCategory(name: string, createdBy: LibraryOrigin): Promise<LibraryCategory> {
    return this.queueCategory(async () => {
      const cleanName = requiredString(name, "category name");
      validateOrigin(createdBy);
      const existing = this.categories.find((item) => item.name.toLowerCase() === cleanName.toLowerCase());
      if (existing) return { ...existing };
      const base = categoryId(cleanName);
      let id = base;
      for (let suffix = 2; this.categories.some((item) => item.id === id); suffix += 1) id = `${base}-${suffix}`;
      const category = { id, name: cleanName, createdBy };
      this.categories.push(category);
      await this.writeCategories();
      return { ...category };
    });
  }

  async deleteCategory(id: string): Promise<boolean> {
    return this.queueCategory(async () => {
      const cleanId = requiredString(id, "category id");
      if (!this.categories.some((item) => item.id === cleanId)) return false;
      for (const entry of this.entries.values()) {
        if (entry.category !== cleanId) continue;
        const encoded = encodeLibraryPreset({ ...entry, category: null });
        await writeAtomicFile(path.join(this.directory, entry.file), `${encoded}\n`);
        this.entries.set(entry.file, { ...validateLibraryPreset(JSON.parse(encoded)), file: entry.file });
      }
      this.categories = this.categories.filter((item) => item.id !== cleanId);
      await this.writeCategories();
      return true;
    });
  }

  async save(input: {
    name: string; ops: unknown; preview?: unknown; filename?: string; created?: string;
    sockets?: unknown; origin?: LibraryOrigin; kind?: LibraryKind; category?: string | null;
  }): Promise<LibraryEntry> {
    const filename = sanitizeLibraryFilename(input.filename ?? input.name);
    if (filename === CATEGORIES_FILE) throw new Error("reserved library filename");
    const existing = this.entries.get(filename);
    const now = new Date().toISOString();
    let category: string | null = input.category ?? existing?.category ?? null;
    if (category !== null) {
      const clean = validateCategory(category)!;
      const known = this.categories.find((item) => item.id === clean || item.name.toLowerCase() === clean.toLowerCase());
      category = known?.id ?? (await this.createCategory(clean, input.origin ?? existing?.origin ?? "user")).id;
    }
    const encoded = encodeLibraryPreset({
      name: input.name, ops: input.ops, preview: input.preview,
      created: input.created ?? existing?.created ?? now, updated: now,
      origin: input.origin ?? existing?.origin ?? "user", kind: input.kind ?? existing?.kind ?? "saved", category,
      ...(input.sockets === undefined
        ? (existing?.sockets === undefined ? {} : { sockets: existing.sockets })
        : { sockets: input.sockets }),
    });
    await writeAtomicFile(path.join(this.directory, filename), `${encoded}\n`);
    const entry = { ...validateLibraryPreset(JSON.parse(encoded)), file: filename };
    this.entries.set(filename, entry);
    if (entry.kind === "recent") await this.evictRecent();
    return entry;
  }

  async import(input: {
    preset: unknown; name?: string; preview?: unknown; filename?: string;
    origin?: LibraryOrigin; kind?: LibraryKind; category?: string | null;
  }): Promise<LibraryEntry> {
    const preset = decodeLibraryPreset(input.preset);
    return this.save({
      name: input.name ?? preset.name,
      ops: preset.ops,
      preview: input.preview !== undefined ? input.preview : preset.preview,
      filename: input.filename,
      created: preset.created,
      origin: input.origin ?? "user",
      kind: input.kind ?? "saved",
      category: input.category !== undefined ? input.category : preset.category,
      sockets: preset.sockets,
    });
  }

  async remove(filenameOrName: string): Promise<boolean> {
    const filename = sanitizeLibraryFilename(filenameOrName.replace(/\.json$/i, ""));
    const target = path.join(this.directory, filename);
    if (path.dirname(target) !== this.directory) throw new Error("invalid library filename");
    try {
      await unlink(target);
    } catch (error: any) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    this.entries.delete(filename);
    return true;
  }

  private async writeCategories(): Promise<void> {
    await writeAtomicFile(path.join(this.directory, CATEGORIES_FILE), `${JSON.stringify(this.categories, null, 2)}\n`);
  }

  private queueCategory<T>(work: () => Promise<T>): Promise<T> {
    const result = this.categoryTail.then(work, work);
    this.categoryTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async evictRecent(): Promise<void> {
    const recent = [...this.entries.values()].filter((entry) => entry.kind === "recent")
      .sort((a, b) => a.created.localeCompare(b.created) || a.file.localeCompare(b.file));
    for (const entry of recent.slice(0, -RECENT_LIBRARY_LIMIT)) await this.remove(entry.file);
  }
}
