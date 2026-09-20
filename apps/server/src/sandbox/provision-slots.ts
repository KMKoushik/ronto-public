import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { chown, lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { databasePath } from "../db/database.ts";
import { familyImagePath, familyStoragePath, SandboxIdentifier, sandboxLimits } from "./sandbox-config.ts";

const exec = promisify(execFile);
const Slots = Schema.Array(Schema.Struct({
  id: SandboxIdentifier,
  project_id: Schema.Int.check(Schema.isGreaterThan(0)),
  provisioned_at: Schema.NullOr(Schema.String),
  directory_device: Schema.NullOr(Schema.Int),
  directory_inode: Schema.NullOr(Schema.Int),
  storage_kind: Schema.NullOr(Schema.String),
  storage_identity: Schema.NullOr(Schema.String),
}));
const Mounts = Schema.Struct({ filesystems: Schema.Array(Schema.Struct({
  fstype: Schema.String, options: Schema.String, target: Schema.String,
})) });
type Slot = (typeof Slots.Type)[number];

async function run(program: string, args: ReadonlyArray<string>, timeout = 60_000) {
  return (await exec(program, [...args], { timeout, maxBuffer: 1024 * 1024,
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
  })).stdout;
}

async function tagTree(path: string, project: number) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) {
    throw new Error("Unprepared family storage contains links or special files; inspect or restore into pre-tagged directories first");
  }
  await run("/usr/bin/chattr", ["-p", String(project), ...(stat.isDirectory() ? ["+P"] : []), path]);
  if (stat.isDirectory()) for (const name of await readdir(path)) await tagTree(join(path, name), project);
}

async function validateBackup(path: string) {
  const resolved = resolve(path);
  const stat = await lstat(resolved);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Expected a real pre-update backup");
  const dataRoot = resolve(dirname(databasePath));
  const fromData = relative(dataRoot, resolved);
  if (fromData === "" || (!fromData.startsWith(`..${sep}`) && fromData !== "..")) {
    throw new Error("The complete pre-update backup must be outside Ronto's durable data tree");
  }
}

async function prepareLinuxStorageRoot() {
  const root = familyStoragePath();
  await mkdir(root, { recursive: true, mode: 0o755 });
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error("Family storage root must not traverse symlinks");
  const mounts = Schema.decodeUnknownSync(Mounts)(JSON.parse(await run("/usr/bin/findmnt", ["--json", "--target", root, "--output", "FSTYPE,OPTIONS,TARGET"])));
  const [mount] = mounts.filesystems;
  if (!mount || resolve(mount.target) !== root || mount.fstype !== "ext4" || !mount.options.split(",").includes("prjquota")) {
    throw new Error("Prepare a dedicated ext4 mount with project quotas exactly at the family storage boundary before provisioning slots; no filesystem was modified by this command");
  }
  return { root, mount: mount.target };
}

async function provisionLinuxSlot(db: DatabaseSync, root: string, mount: string, uid: number, gid: number, slot: Slot) {
  const path = join(root, slot.id);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Slot is not a real directory");
  const identityMatches = slot.directory_device === stat.dev && slot.directory_inode === stat.ino;
  // Invalidate first. Interrupted or failed preparation must never leave a
  // ready slot, but retain known identity so a same-directory retry is safe.
  db.prepare("UPDATE ronto_family_sandbox_slot SET provisioned_at=NULL WHERE id=?").run(slot.id);
  if (slot.directory_device === null || !identityMatches) await tagTree(path, slot.project_id);
  else await run("/usr/bin/chattr", ["-p", String(slot.project_id), "+P", path]);
  await run("/usr/sbin/setquota", ["-P", String(slot.project_id), "0", String(sandboxLimits.storageKiB), "0", "0", mount]);
  const report = await run("/usr/sbin/repquota", ["-P", "-n", "-O", "csv", mount]);
  const quota = report.split("\n").map((line) => line.split(",")).find((fields) => fields[0] === `#${slot.project_id}`);
  if (!quota || quota[5] !== String(sandboxLimits.storageKiB) || !quota[3] || !/^\d+$/.test(quota[3]) || Number(quota[3]) > sandboxLimits.storageKiB) {
    throw new Error("Family quota readback failed or existing usage exceeds 20 GiB");
  }
  const attributes = (await run("/usr/bin/lsattr", ["-pd", path])).trim().split(/\s+/);
  if (Number(attributes[0]) !== slot.project_id || !attributes[1]?.includes("P")) throw new Error("Slot project inheritance verification failed");
  await chown(path, uid, gid);
  for (const child of ["channels", ".home"]) {
    const directory = join(path, child);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Slot child is a symlink");
    await chown(directory, uid, gid);
  }
  db.prepare("UPDATE ronto_family_sandbox_slot SET provisioned_at=?, directory_device=?, directory_inode=?, storage_kind=?, storage_identity=? WHERE id=?")
    .run(new Date().toISOString(), stat.dev, stat.ino, "linux-ext4-project", `project:${slot.project_id}`, slot.id);
}

interface DarwinVolume {
  readonly mountPoint: string;
  readonly filesystem: string;
  readonly uuid: string;
}

function field(output: string, name: string) {
  const line = output.split("\n").find((entry) => entry.trimStart().startsWith(`${name}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

async function darwinVolume(path: string): Promise<DarwinVolume> {
  const output = await run("/usr/sbin/diskutil", ["info", path]);
  const mountPoint = field(output, "Mount Point");
  const filesystem = field(output, "File System Personality");
  const uuid = field(output, "Volume UUID");
  if (!mountPoint || !filesystem || !uuid) throw new Error(`Could not identify APFS volume at ${path}`);
  return { mountPoint, filesystem, uuid };
}

async function attachedDarwinVolume(path: string): Promise<DarwinVolume | null> {
  const volume = await darwinVolume(path).catch(() => null);
  if (!volume) return null;
  const expected = await realpath(path);
  const actual = await realpath(volume.mountPoint).catch(() => volume.mountPoint);
  return actual === expected ? volume : null;
}

async function prepareDarwinStorageRoot() {
  const root = familyStoragePath();
  const images = familyImagePath();
  await mkdir(root, { recursive: true, mode: 0o755 });
  await mkdir(images, { recursive: true, mode: 0o755 });
  await run("/bin/chmod", ["755", images]);
  for (const path of [root, images]) {
    if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) {
      throw new Error("Darwin family storage paths must be canonical real directories");
    }
  }
  return { root, images };
}

async function attachDarwinImage(path: string, image: string) {
  await run("/usr/bin/hdiutil", ["attach", "-quiet", "-nobrowse", "-noautoopen", "-owners", "on", "-mountpoint", path, image], 120_000);
  const volume = await attachedDarwinVolume(path);
  if (!volume || volume.filesystem !== "Case-sensitive APFS") {
    throw new Error("Family image did not mount as case-sensitive APFS");
  }
  return volume;
}

async function provisionDarwinSlot(db: DatabaseSync, root: string, images: string, uid: number, gid: number, slot: Slot) {
  const path = join(root, slot.id);
  const image = join(images, `${slot.id}.sparsebundle`);
  const imported = join(root, `.${slot.id}.import`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const initial = await lstat(path);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new Error("Slot is not a real directory");

  db.prepare("UPDATE ronto_family_sandbox_slot SET provisioned_at=NULL WHERE id=?").run(slot.id);
  let volume = await attachedDarwinVolume(path);
  if (!volume) {
    const names = await readdir(path);
    if (names.length > 0) {
      if (await lstat(imported).then(() => true, () => false)) throw new Error(`Interrupted family import requires inspection: ${imported}`);
      await rename(path, imported);
      await mkdir(path, { mode: 0o700 });
    }
    try {
      if (!await lstat(image).then(() => true, () => false)) {
        await run("/usr/bin/hdiutil", ["create", "-quiet", "-size", `${sandboxLimits.storageKiB}k`, "-type", "SPARSEBUNDLE", "-fs", "Case-sensitive APFS", "-volname", `Ronto-${slot.id.slice(0, 8)}`, image], 120_000);
      }
      volume = await attachDarwinImage(path, image);
      if (await lstat(imported).then(() => true, () => false)) {
        await run("/usr/bin/ditto", ["--rsrc", "--extattr", "--acl", imported, path], 10 * 60_000);
        await rm(imported, { recursive: true });
      }
    } catch (error) {
      if (await attachedDarwinVolume(path)) await run("/usr/bin/hdiutil", ["detach", "-quiet", path]).catch(() => undefined);
      await rm(path, { recursive: true, force: true });
      if (await lstat(imported).then(() => true, () => false)) await rename(imported, path);
      throw error;
    }
  }
  if (volume.filesystem !== "Case-sensitive APFS") throw new Error("Family storage must use case-sensitive APFS");
  if (slot.storage_kind === "darwin-apfs-image" && slot.storage_identity !== null && slot.storage_identity !== volume.uuid) {
    throw new Error("Mounted family image identity differs from the provisioned slot");
  }
  await run("/usr/sbin/chown", ["-R", `${uid}:${gid}`, path], 10 * 60_000);
  await run("/bin/chmod", ["700", path]);
  for (const child of ["channels", ".home"]) {
    const directory = join(path, child);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Slot child is a symlink");
    await chown(directory, uid, gid);
  }
  const stat = await lstat(path);
  db.prepare("UPDATE ronto_family_sandbox_slot SET provisioned_at=?, directory_device=?, directory_inode=?, storage_kind=?, storage_identity=? WHERE id=?")
    .run(new Date().toISOString(), stat.dev, stat.ino, "darwin-apfs-image", volume.uuid, slot.id);
}

const provision = Effect.fn("provisionSandboxSlots")(function* () {
  if (process.getuid?.() !== 0 || process.env.RONTO_SERVICES_STOPPED !== "1" || !process.env.RONTO_DATA_BACKUP) {
    return yield* Effect.die("Run offline as root after stopping both services and backing up the complete data tree; set RONTO_SERVICES_STOPPED=1 and RONTO_DATA_BACKUP to that backup");
  }
  const backup = process.env.RONTO_DATA_BACKUP;
  yield* Effect.tryPromise(async () => {
    // The deployment workflow owns backup creation and service shutdown. This
    // script never stops production, enables filesystem features, or runs sudo.
    await validateBackup(backup);
    if (process.platform !== "linux" && process.platform !== "darwin") throw new Error("Sandbox slot provisioning supports only Linux and Darwin");
    const uid = Number((await run("/usr/bin/id", ["-u", "ronto"])).trim());
    const gid = Number((await run("/usr/bin/id", ["-g", "ronto"])).trim());
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) throw new Error("Expected an unprivileged ronto account");
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    try {
      const slots = Schema.decodeUnknownSync(Slots)(db.prepare("SELECT id, project_id, provisioned_at, directory_device, directory_inode, storage_kind, storage_identity FROM ronto_family_sandbox_slot ORDER BY project_id").all());
      if (process.platform === "linux") {
        const storage = await prepareLinuxStorageRoot();
        for (const slot of slots) await provisionLinuxSlot(db, storage.root, storage.mount, uid, gid, slot);
      } else {
        const storage = await prepareDarwinStorageRoot();
        for (const slot of slots) await provisionDarwinSlot(db, storage.root, storage.images, uid, gid, slot);
      }
    } finally { db.close(); }
  }).pipe(Effect.orDie);
  yield* Effect.logInfo(process.platform === "darwin"
    ? "Family slots provisioned on fixed-size case-sensitive APFS images"
    : "Family slots provisioned with fixed 20 GiB project quotas; no privileged runtime helper is required");
});

provision().pipe(NodeRuntime.runMain);
