import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return (
    typeof code === "string" &&
    (UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code) ||
      (process.platform === "win32" && code === "EPERM"))
  );
}

async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await directory?.close();
  }
}

export class BoundedFileError extends Error {
  constructor(
    readonly code: "not_regular" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "BoundedFileError";
  }
}

export async function readRegularFileBounded(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const flags =
    constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
  const file = await open(path, flags);
  try {
    const information = await file.stat();
    if (!information.isFile())
      throw new BoundedFileError(
        "not_regular",
        `${path} is not a regular file`,
      );
    if (information.size > maximumBytes)
      throw new BoundedFileError(
        "too_large",
        `${path} exceeds its ${maximumBytes}-byte limit`,
      );
    const bytes = Buffer.allocUnsafe(
      Math.min(information.size, maximumBytes) + 1,
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await file.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > maximumBytes)
      throw new BoundedFileError(
        "too_large",
        `${path} grew beyond its ${maximumBytes}-byte limit while being read`,
      );
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

export async function writeFileAtomically(
  path: string,
  value: string | Uint8Array,
  mode?: number,
): Promise<void> {
  const directoryPath = dirname(path);
  await mkdir(directoryPath, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", mode);
    try {
      await file.writeFile(value);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await syncDirectory(directoryPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function removeFileDurably(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(dirname(path));
}
