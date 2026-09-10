import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { chown, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { databasePath } from "../db/database.ts";
import { familyStoragePath, SandboxIdentifier, sandboxLimits } from "./sandbox-config.ts";

const exec = promisify(execFile);
const Slots = Schema.Array(Schema.Struct({
  id: SandboxIdentifier,
  project_id: Schema.Int.check(Schema.isGreaterThan(0)),
  provisioned_at: Schema.NullOr(Schema.String),
  directory_device: Schema.NullOr(Schema.Int),
  directory_inode: Schema.NullOr(Schema.Int),
}));
const Mounts = Schema.Struct({ filesystems: Schema.Array(Schema.Struct({
  fstype: Schema.String, options: Schema.String, target: Schema.String,
})) });
type Slot = (typeof Slots.Type)[number];

async function run(program: string, args: ReadonlyArray<string>) {
  return (await exec(program, [...args], { timeout: 60_000, maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
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

async function prepareStorageRoot() {
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

async function provisionSlot(db: DatabaseSync, root: string, mount: string, uid: number, gid: number, slot: Slot) {
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
  db.prepare("UPDATE ronto_family_sandbox_slot SET provisioned_at=?, directory_device=?, directory_inode=? WHERE id=?")
    .run(new Date().toISOString(), stat.dev, stat.ino, slot.id);
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
    const storage = await prepareStorageRoot();
    const uid = Number((await run("/usr/bin/id", ["-u", "ronto"])).trim());
    const gid = Number((await run("/usr/bin/id", ["-g", "ronto"])).trim());
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) throw new Error("Expected an unprivileged ronto account");
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    try {
      const slots = Schema.decodeUnknownSync(Slots)(db.prepare("SELECT id, project_id, provisioned_at, directory_device, directory_inode FROM ronto_family_sandbox_slot ORDER BY project_id").all());
      for (const slot of slots) {
        await provisionSlot(db, storage.root, storage.mount, uid, gid, slot);
      }
    } finally { db.close(); }
  }).pipe(Effect.orDie);
  yield* Effect.logInfo("Family slots provisioned with fixed 20 GiB project quotas; no privileged runtime helper is required");
});

provision().pipe(NodeRuntime.runMain);
