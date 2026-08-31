import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomicFile } from "./atomic-file.js";

export const DEFAULT_ASSET_MAX_BYTES = 25 * 1024 * 1024;

export type AssetResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
};
export type AssetLoadOptions = {
  cacheDir: string;
  maxBytes?: number;
  fetcher?: (url: string) => Promise<AssetResponse>;
};
export type AssetResult = { id: number; bytes: Buffer; contentType: string; fromCache: boolean };

export function parseAssetId(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^rbxassetid:\/\//i, "").replace(/^rbxasset:\/\//i, "");
  const raw = /^\d+$/.test(text) ? text : text.match(/[?&]id=(\d+)/i)?.[1];
  return raw && Number(raw) > 0 ? Number(raw) : null;
}

export function assetDeliveryUrl(value: unknown): string {
  const id = parseAssetId(value);
  if (id === null) throw new Error("asset id must be a positive integer or Roblox asset URI");
  return `https://assetdelivery.roblox.com/v1/asset/?id=${id}`;
}

function cachePaths(cacheDir: string, id: number) {
  return { data: path.join(cacheDir, `${id}.bin`), meta: path.join(cacheDir, `${id}.json`) };
}

function contentTypeOf(value: string | null | undefined) {
  const type = (value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : "application/octet-stream";
}

export async function loadAsset(value: unknown, options: AssetLoadOptions): Promise<AssetResult> {
  const id = parseAssetId(value);
  if (id === null) throw new Error("asset id must be a positive integer or Roblox asset URI");
  const maxBytes = options.maxBytes ?? DEFAULT_ASSET_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("asset maxBytes must be a positive integer");
  const files = cachePaths(options.cacheDir, id);
  try {
    const bytes = await readFile(files.data);
    if (bytes.byteLength > maxBytes) throw new Error(`cached asset ${id} exceeds ${maxBytes} bytes`);
    let contentType = "application/octet-stream";
    try {
      const metadata = JSON.parse(await readFile(files.meta, "utf8")) as { contentType?: string };
      contentType = contentTypeOf(metadata.contentType);
    } catch {
      // A data-only cache entry is still usable; the generic MIME is safe.
    }
    return { id, bytes, contentType, fromCache: true };
  } catch (error) {
    if (error instanceof Error && /exceeds/.test(error.message)) throw error;
  }

  const fetcher = options.fetcher ?? ((url: string) => fetch(url) as Promise<AssetResponse>);
  const response = await fetcher(assetDeliveryUrl(id));
  if (!response.ok) throw new Error(`asset ${id} fetch failed (HTTP ${response.status})`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`asset ${id} exceeds ${maxBytes} bytes`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`asset ${id} exceeds ${maxBytes} bytes`);
  const contentType = contentTypeOf(response.headers.get("content-type"));
  await mkdir(options.cacheDir, { recursive: true });
  await writeAtomicFile(files.data, bytes);
  await writeAtomicFile(files.meta, JSON.stringify({ contentType }));
  return { id, bytes, contentType, fromCache: false };
}
