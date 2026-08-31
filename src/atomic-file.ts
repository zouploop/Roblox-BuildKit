import { chmod, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type AtomicData = string | Uint8Array;

export async function writeAtomicFile(filePath: string, data: AtomicData, options: { mode?: number } = {}): Promise<void> {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const name = path.basename(target);
  const temporary = path.join(directory, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  let existingMode: number | undefined;

  try {
    existingMode = (await stat(target)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const handle = await open(temporary, "wx", existingMode ?? options.mode ?? 0o666);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  try {
    await handle.close();
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  if (existingMode !== undefined) {
    try {
      await chmod(temporary, existingMode);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  try {
    await rename(temporary, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  const backup = path.join(directory, `.${name}.${process.pid}.${randomUUID()}.bak`);
  try {
    await rename(target, backup);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await rename(temporary, target).catch(() => {});
    }
    throw error;
  }

  try {
    await rename(temporary, target);
  } catch (error) {
    // ponytail: Windows lacks a replace-rename primitive; restore the old file
    // if the second rename fails, leaving the backup for recovery if restoration is blocked.
    await rename(backup, target).catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await unlink(backup).catch(() => {});
}
