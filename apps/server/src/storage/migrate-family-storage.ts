import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readlink, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath } from "../db/database.ts";

const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]+$/));
const FileSystemError = Schema.Struct({ code: Schema.optional(Schema.String) });
const Family = Schema.Struct({ id: Identifier });
const Channel = Schema.Struct({ id: Identifier, family_id: Identifier });
const ManagedFile = Schema.Struct({
  channel_id: Identifier,
  storage_path: Schema.String.check(
    Schema.isPattern(/^files\/[a-zA-Z0-9-]+\/[^/\\]+$/),
    Schema.makeFilter((path) => !path.includes("\0") && !path.endsWith("/.") && !path.endsWith("/..")),
  ),
  byte_size: Schema.Int,
  checksum: Schema.String,
});

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// A complete-tree fingerprint verifies the backup without printing contents.
// Symlinks are copied as links, never followed outside the durable boundary.
async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(path: string, name: string): Promise<void> {
    const stat = await lstat(path);
    hash.update(JSON.stringify([name, stat.mode]));
    if (stat.isSymbolicLink()) hash.update(JSON.stringify(["link", await readlink(path)]));
    else if (stat.isDirectory()) {
      hash.update("directory");
      for (const child of (await readdir(path)).sort()) await walk(join(path, child), `${name}/${child}`);
    } else if (stat.isFile()) hash.update(await hashFile(path));
    else throw new Error("Durable storage contains a device, socket, or other unsupported entry; stop services and inspect it first");
  }
  await walk(root, ".");
  return hash.digest("hex");
}

async function requireDirectory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
}

async function verifyChannelTree(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
    throw new Error("Legacy channel storage contains symbolic or hard links; resolve them before migration");
  }
  if (stat.isDirectory()) {
    for (const name of await readdir(path)) await verifyChannelTree(join(path, name));
  } else if (!stat.isFile()) throw new Error("Unsupported entry in legacy channel storage");
}

const migrate = Effect.fn("migrateFamilyStorage")(function* () {
  const backupInput = process.env.STORAGE_MIGRATION_BACKUP;
  if (process.env.RONTO_SERVICES_STOPPED !== "1" || !backupInput) {
    return yield* Effect.die("Stop Ronto and OpenConnector first; set RONTO_SERVICES_STOPPED=1 and STORAGE_MIGRATION_BACKUP to a new directory outside the data tree");
  }
  yield* Effect.tryPromise(async () => {
    const data = await realpath(dirname(resolve(databasePath)));
    const backupParent = await realpath(dirname(resolve(backupInput)));
    const backup = join(backupParent, basename(resolve(backupInput)));
    const backupRelative = relative(data, backup);
    if (!isAbsolute(backupRelative) && backupRelative !== ".." && !backupRelative.startsWith(`..${sep}`)) {
      throw new Error("Backup must be outside the complete data tree");
    }
    const legacy = join(data, "channels");
    if (process.env.CHANNEL_WORKSPACE_PATH && resolve(process.env.CHANNEL_WORKSPACE_PATH) !== legacy) {
      throw new Error("This one-time migration only supports channel storage beside SQLite");
    }
    if (process.env.FAMILY_STORAGE_PATH && resolve(process.env.FAMILY_STORAGE_PATH) !== join(data, "families")) {
      throw new Error("This one-time migration requires family storage beside SQLite");
    }
    await requireDirectory(legacy);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const metadata = (() => {
      try {
        return {
          families: Schema.decodeUnknownSync(Schema.Array(Family))(db.prepare("SELECT id FROM ronto_family").all()),
          channels: Schema.decodeUnknownSync(Schema.Array(Channel))(db.prepare("SELECT id, family_id FROM ronto_channel").all()),
          files: Schema.decodeUnknownSync(Schema.Array(ManagedFile))(db.prepare("SELECT channel_id, storage_path, byte_size, checksum FROM ronto_file").all()),
        };
      } finally { db.close(); }
    })();
    const [family] = metadata.families;
    if (metadata.families.length !== 1 || !family) throw new Error("Expected the single-family legacy database; no data was moved");
    if (metadata.channels.some(channel => channel.family_id !== family.id)) throw new Error("Ambiguous channel ownership");
    const channelIds = new Set(metadata.channels.map(channel => channel.id));
    if ((await readdir(legacy)).some(name => !channelIds.has(name))) throw new Error("Unrecognized legacy channel directory; inspect it before migrating");
    await verifyChannelTree(legacy);
    for (const file of metadata.files) {
      if (!channelIds.has(file.channel_id)) throw new Error("Managed file has an unknown channel");
      const path = join(legacy, file.channel_id, file.storage_path);
      if ((await lstat(path)).size !== file.byte_size || await hashFile(path) !== file.checksum) {
        throw new Error("Managed-file checksum validation failed; no data was moved");
      }
    }
    const before = await fingerprint(data);
    // mkdir is exclusive: never merge into or overwrite an existing backup.
    await mkdir(backup, { mode: (await lstat(data)).mode });
    for (const name of await readdir(data)) {
      await cp(join(data, name), join(backup, name), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true });
    }
    if (await fingerprint(backup) !== before || await fingerprint(data) !== before) {
      throw new Error("Backup verification failed or data changed; no data was moved. Retain the backup for inspection");
    }
    const families = join(data, "families");
    await mkdir(families, { recursive: true });
    await requireDirectory(families);
    const destination = join(families, family.id);
    await mkdir(destination, { recursive: true });
    await requireDirectory(destination);
    if ((await readdir(destination)).includes("channels")) throw new Error("Destination channels already exist; refusing to merge layouts");
    const digest = await fingerprint(legacy);
    const target = join(destination, "channels");
    try {
      await rename(legacy, target);
    } catch (cause) {
      const error = Schema.decodeUnknownOption(FileSystemError)(cause);
      if (error._tag !== "Some" || error.value.code !== "EXDEV") throw cause;
      const temporary = `${target}.migrating`;
      await cp(legacy, temporary, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      if (await fingerprint(temporary) !== digest) {
        throw new Error("Cross-filesystem channel copy failed verification; legacy data was retained");
      }
      await rename(temporary, target);
      await rm(legacy, { recursive: true });
    }
    if (await fingerprint(target) !== digest) {
      throw new Error("Moved channel tree failed final verification. Retain the complete backup and roll back the complete data tree");
    }
  }).pipe(Effect.orDie);
  yield* Effect.logInfo("Family storage migration verified. Keep the complete backup; unset CHANNEL_WORKSPACE_PATH and use FAMILY_STORAGE_PATH before starting the new release. Roll back code and the complete data tree together if needed.");
});

migrate().pipe(NodeRuntime.runMain);
