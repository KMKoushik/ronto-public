import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { ChannelId, FamilyId } from "@ronto/api";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { darwinSandboxCommandConcurrency, familyStoragePath, SandboxImage, sandboxLimits } from "./sandbox-config.ts";
import { SandboxStore, type SandboxSlot } from "./sandbox-store.ts";
import { ChannelWorkspace } from "../agent/channel-workspace.ts";
import { darwinSandboxRuntime } from "./darwin-family-sandbox.ts";

const execFileAsync = promisify(execFile);
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Containers = Schema.Array(Schema.Struct({
  Id: Digest, Image: Digest,
  State: Schema.Struct({ Status: Schema.String, Pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
  Config: Schema.Struct({
    Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
    User: Schema.String,
    Tty: Schema.Boolean,
    Env: Schema.Array(Schema.String),
    WorkingDir: Schema.String,
  }),
  HostConfig: Schema.Struct({
    ReadonlyRootfs: Schema.Boolean,
    Privileged: Schema.Boolean,
    NetworkMode: Schema.String,
    PortBindings: Schema.Record(Schema.String, Schema.Unknown),
    PublishAllPorts: Schema.Boolean,
    IpcMode: Schema.String,
    PidMode: Schema.String,
    CapAdd: Schema.Array(Schema.String),
    GroupAdd: Schema.Array(Schema.String),
    SecurityOpt: Schema.Array(Schema.String),
    LogConfig: Schema.Struct({ Type: Schema.String }),
    Memory: Schema.Int,
    MemorySwap: Schema.Int,
    NanoCpus: Schema.Int,
    PidsLimit: Schema.Int,
  }),
  Mounts: Schema.Array(Schema.Struct({
    Type: Schema.String,
    Source: Schema.optional(Schema.String),
    Destination: Schema.String,
    RW: Schema.Boolean,
  })),
}));
const Mounts = Schema.Struct({ filesystems: Schema.Array(Schema.Struct({ fstype: Schema.String, options: Schema.String })) });
const missing = Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }));
type Container = (typeof Containers.Type)[number];

function validateContainerConfig(container: Container, uid: number, gid: number) {
  const allowedEnvironment = container.Config.Env.every((entry) =>
    entry.startsWith("HOME=") || entry.startsWith("PATH=") ||
    entry.startsWith("HOSTNAME=") || entry === "container=podman"
  );
  if (container.Config.User !== `${uid}:${gid}` || container.Config.Tty ||
    container.Config.WorkingDir !== "/workspace" ||
    !container.Config.Env.includes("HOME=/workspace/.home") ||
    !container.Config.Env.includes("PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin") ||
    !allowedEnvironment) throw new Error("Sandbox process configuration is invalid");
}

function validateHostConfig(container: Container) {
  const host = container.HostConfig;
  if (host.Privileged || !host.ReadonlyRootfs || host.NetworkMode !== "slirp4netns" ||
    Object.keys(host.PortBindings).length !== 0 || host.PublishAllPorts ||
    host.IpcMode !== "private" || host.PidMode !== "private" || host.CapAdd.length !== 0 ||
    host.GroupAdd.length !== 0 || !host.SecurityOpt.includes("no-new-privileges") ||
    host.LogConfig.Type !== "none" || host.Memory !== sandboxLimits.memoryBytes ||
    host.MemorySwap !== sandboxLimits.memoryBytes ||
    host.NanoCpus !== sandboxLimits.cpus * 1_000_000_000 || host.PidsLimit !== sandboxLimits.pids) {
    throw new Error("Sandbox host configuration is invalid");
  }
}

function validateContainerMounts(container: Container, directory: string) {
  const workspace = container.Mounts.some((mount) => mount.Type === "bind" &&
    mount.Source === directory && mount.Destination === "/workspace" && mount.RW);
  const unexpected = container.Mounts.some((mount) =>
    !(mount.Type === "bind" && mount.Source === directory && mount.Destination === "/workspace") &&
    !(mount.Type === "tmpfs" && mount.Destination === "/tmp")
  );
  if (!workspace || unexpected) throw new Error("Sandbox mounts are invalid");
}

interface FamilyState {
  readonly lock: Semaphore.Semaphore;
  initialized: boolean;
  active: number;
  failed: boolean;
}

export class FamilySandbox extends Context.Service<FamilySandbox, {
  readonly operations: (familyId: FamilyId, channelId: ChannelId) => BashOperations;
}>()("ronto/sandbox/FamilySandbox") {
  static readonly layer = Layer.effect(FamilySandbox, Effect.gen(function* () {
    const store = yield* SandboxStore;
    const workspace = yield* ChannelWorkspace;
    const shutdown = new AbortController();
    const pending = new Set<Promise<{ exitCode: number | null }>>();
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      shutdown.abort();
      await Promise.allSettled(pending);
    }));
    const families = new Map<FamilyId, FamilyState>();
    const darwinCommands = Semaphore.makeUnsafe(darwinSandboxCommandConcurrency);
    const image = process.env.RONTO_SANDBOX_IMAGE;
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    const runtime = `/run/user/${uid}`;
    const home = homedir();
    const environment = {
      HOME: home, USER: "ronto", LOGNAME: "ronto", PATH: "/usr/local/bin:/usr/bin:/bin",
      XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`, LC_ALL: "C",
    };
    const controlRoot = join(runtime, "ronto-commands");
    const temporaryRoot = resolve(tmpdir());
    const root = familyStoragePath();
    const darwin = darwinSandboxRuntime(root);
    const invoke = async (program: string, args: ReadonlyArray<string>) =>
      (await execFileAsync(program, [...args], { cwd: home, env: environment, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout;
    const podman = (...args: string[]) => invoke("/usr/bin/podman", args);
    const unshare = (...args: string[]) => podman("unshare", ...args);

    const inspect = async (name: string) => {
      const parsed = Schema.decodeUnknownSync(Containers)(JSON.parse(await podman("inspect", "--type", "container", name)));
      const [container] = parsed;
      if (parsed.length !== 1 || !container) throw new Error("Sandbox container unavailable");
      return container;
    };
    const cgroupFor = async (id: string, pid: number) => {
      const line = (await readFile(`/proc/${pid}/cgroup`, "utf8")).trim();
      const prefix = `0::/user.slice/user-${uid}.slice/user@${uid}.service/`;
      if (!line.startsWith(prefix) || !line.endsWith(`/libpod-${id}.scope/container`) || line.includes("..") || line.includes("\n")) {
        throw new Error("Unexpected sandbox cgroup; refusing command execution");
      }
      return `/sys/fs/cgroup${line.slice(3)}`;
    };
    const killGroup = async (group: string) => {
      try {
        await unshare("/bin/sh", "-c", 'echo 1 > "$1/cgroup.kill"', "sh", group);
      } catch (error) {
        if (!(await lstat(group).then(() => false, missing))) throw error;
        return;
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        const events = await readFile(join(group, "cgroup.events"), "utf8").catch((error) => {
          if (missing(error)) return "populated 0";
          throw error;
        });
        if (events.includes("populated 0")) return;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("Sandbox command processes did not exit");
    };
    const removeGroup = async (group: string) => {
      if (await lstat(group).then(() => true, (error) => { if (missing(error)) return false; throw error; })) {
        await unshare("/bin/rmdir", group);
      }
    };
    const reconcileCommands = async (group: string) => {
      for (const entry of await readdir(group)) {
        if (/^ronto-command-[a-f0-9-]+$/.test(entry)) {
          await killGroup(join(group, entry));
          await removeGroup(join(group, entry));
        }
      }
    };
    // A configured server recovers every owned running family before serving
    // requests, not only when that family next happens to invoke Bash.
    if (process.platform === "linux" && Schema.is(SandboxImage)(image) && uid !== undefined && uid !== 0) {
      yield* Effect.promise(async () => {
        if (!process.env.TMPDIR || resolve(process.env.TMPDIR) !== temporaryRoot) throw new Error("TMPDIR must be an explicit private runtime directory");
        const temporary = await lstat(temporaryRoot);
        if (!temporary.isDirectory() || temporary.isSymbolicLink() || temporary.uid !== uid ||
          (temporary.mode & 0o077) !== 0 || await realpath(temporaryRoot) !== temporaryRoot) {
          throw new Error("TMPDIR must be a private directory owned by the Ronto user");
        }
        const names = (await podman("ps", "--filter", "label=dev.ronto.family", "--format", "{{.Names}}")).trim();
        for (const name of names ? names.split("\n") : []) {
          if (!/^ronto-family-[a-f0-9-]+$/.test(name)) throw new Error("Unexpected managed sandbox name");
          const container = await inspect(name);
          if (container.Config.Labels?.["dev.ronto.family"] !== name.slice("ronto-family-".length)) throw new Error("Sandbox ownership label mismatch");
          await reconcileCommands(await cgroupFor(container.Id, container.State.Pid));
        }
        await mkdir(controlRoot, { recursive: true, mode: 0o700 });
        const control = await lstat(controlRoot);
        if (!control.isDirectory() || control.isSymbolicLink() || control.uid !== uid || (control.mode & 0o077) !== 0) throw new Error("Invalid private sandbox control directory");
        for (const name of await readdir(controlRoot)) {
          if (/^ronto-command-[a-f0-9-]+\.json$/.test(name)) await rm(join(controlRoot, name));
        }
        for (const name of await readdir(temporaryRoot)) {
          if (/^pi-bash-[a-f0-9]{16}\.log$/.test(name)) {
            const path = join(temporaryRoot, name);
            const stat = await lstat(path);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid) throw new Error("Invalid stale Pi Bash output file");
            await rm(path);
          }
        }
      });
    }
    if (process.platform === "darwin" && (image !== undefined || process.env.RONTO_SANDBOX_IMAGE_DIGEST !== undefined)) {
      yield* Effect.promise(() => darwin.prepare());
    }
    const validateDirectory = async (slot: SandboxSlot, channelId: ChannelId) => {
      const directory = join(root, slot.id);
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== slot.directoryDevice || stat.ino !== slot.directoryInode || await realpath(directory) !== directory) {
        throw new Error("Family storage changed; offline quota provisioning is required");
      }
      const mounts = Schema.decodeUnknownSync(Mounts)(JSON.parse(await invoke("/usr/bin/findmnt", ["--json", "--target", directory, "--output", "FSTYPE,OPTIONS"])));
      if (!mounts.filesystems.some((mount) => mount.fstype === "ext4" && mount.options.split(",").includes("prjquota"))) {
        throw new Error("Family storage project quotas are not enabled");
      }
      const attributes = (await invoke("/usr/bin/lsattr", ["-pd", directory])).trim().split(/\s+/);
      if (Number(attributes[0]) !== slot.projectId || !attributes[1]?.includes("P")) throw new Error("Family project quota identity is invalid");
      for (const path of [join(directory, ".home"), join(directory, "channels"), join(directory, "channels", channelId)]) {
        if (await realpath(path) !== path || (await lstat(path)).isSymbolicLink()) throw new Error("Sandbox working paths must not traverse symlinks");
      }
      return directory;
    };
    const ensure = async (slot: SandboxSlot, channelId: ChannelId, state: FamilyState) => {
      if (state.failed) throw new Error("Family sandbox cleanup failed; restart reconciliation is required");
      if (process.platform !== "linux" || uid === undefined || uid === 0 || gid === undefined || !Schema.is(SandboxImage)(image)) {
        throw new Error("Rootless family Bash is not configured; host Bash is never used as a fallback");
      }
      const directory = await validateDirectory(slot, channelId);
      const name = `ronto-family-${slot.id}`;
      const spec = createHash("sha256").update(JSON.stringify({ image, uid, gid, directory, slot, limits: sandboxLimits, version: 2 })).digest("hex");
      const known = (await podman("ps", "--all", "--filter", `name=^${name}$`, "--format", "{{.Names}}")).trim();
      let container = known === name ? await inspect(name) : null;
      if (known !== "" && known !== name) throw new Error("Ambiguous family container name");
      if (container && container.Config.Labels?.["dev.ronto.family"] !== slot.id) throw new Error("Container name is occupied by an unmanaged container");
      if (container && (container.Config.Labels?.["dev.ronto.spec"] !== spec || container.Image !== image.slice(7))) {
        if (state.active !== 0) throw new Error("Sandbox configuration changed while commands were active");
        await podman("rm", "--force", name);
        container = null;
        state.initialized = false;
      }
      if (!container) {
        await podman("create", "--name", name, "--label", `dev.ronto.family=${slot.id}`, "--label", `dev.ronto.spec=${spec}`,
          "--userns=keep-id", "--user", `${uid}:${gid}`, "--cap-drop=ALL", "--security-opt=no-new-privileges",
          "--read-only", "--read-only-tmpfs=false", "--tmpfs", `/tmp:rw,nosuid,nodev,size=${sandboxLimits.tmpBytes}`,
          "--ipc=private", "--pid=private", "--network=slirp4netns:allow_host_loopback=false",
          "--log-driver=none", "--http-proxy=false",
          `--cpus=${sandboxLimits.cpus}`, `--memory=${sandboxLimits.memoryBytes}`, `--memory-swap=${sandboxLimits.memoryBytes}`, `--pids-limit=${sandboxLimits.pids}`,
          "--mount", `type=bind,source=${directory},destination=/workspace,rw`, "--workdir", "/workspace",
          "--env", "HOME=/workspace/.home", "--env", "PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin", image);
        container = await inspect(name);
      }
      if (container.State.Status !== "running") {
        if (state.active !== 0) throw new Error("Family sandbox stopped while commands were active");
        await podman("start", name);
        container = await inspect(name);
        state.initialized = false;
      }
      validateContainerConfig(container, uid, gid);
      validateHostConfig(container);
      validateContainerMounts(container, directory);
      const group = await cgroupFor(container.Id, container.State.Pid);
      const ceilings = await Promise.all(["cpu.max", "memory.max", "memory.swap.max", "pids.max"].map((file) => readFile(join(group, file), "utf8").then((text) => text.trim())));
      if (ceilings[0] !== "200000 100000" || ceilings[1] !== String(sandboxLimits.memoryBytes) || ceilings[2] !== "0" || ceilings[3] !== String(sandboxLimits.pids)) {
        throw new Error("Family sandbox resource ceilings are not enforced");
      }
      if (!state.initialized) {
        // Reconcile abandoned command cgroups after a server crash, before
        // accepting any new command for this family. Keep durable files intact.
        await reconcileCommands(group);
        state.initialized = true;
      }
      return { containerId: container.Id, group };
    };

    const operations = (familyId: FamilyId, channelId: ChannelId): BashOperations => ({
      exec: async (command, cwd, options) => {
        const seconds = options.timeout ?? sandboxLimits.commandSeconds;
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid timeout: must be a finite positive number of seconds");
        const timeout = Math.min(seconds, sandboxLimits.commandSeconds);
        const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
        if (signal.aborted) throw new Error("aborted");
        if (resolve(cwd) !== join(root, familyId, "channels", channelId)) throw new Error("Unexpected Bash working directory");
        const slot = await Effect.runPromise(store.resolve(familyId, channelId));
        if (signal.aborted) throw new Error("aborted");
        if (process.platform === "darwin") {
          const execution = Effect.runPromise(darwinCommands.withPermit(
            workspace.withSandboxAccess(familyId, () => darwin.exec(slot, channelId, command, {
              signal, timeout, onData: options.onData,
            })),
          ));
          pending.add(execution);
          try { return await execution; } finally { pending.delete(execution); }
        }
        let state = families.get(familyId);
        if (!state) {
          state = { lock: Semaphore.makeUnsafe(1), initialized: false, active: 0, failed: false };
          families.set(familyId, state);
        }
        const familyState = state;
        const execute = async () => {
          const ready = await Effect.runPromise(familyState.lock.withPermit(Effect.promise(async () => {
            const result = await ensure(slot, channelId, familyState);
            if (signal.aborted) throw new Error("aborted");
            familyState.active++;
            return result;
          })));
          const name = `ronto-command-${randomUUID()}`;
          const group = join(ready.group, name);
          const processFile = join(controlRoot, `${name}.json`);
          let groupCreated = false;
          const dispose = async () => {
            try {
              if (groupCreated) { await killGroup(group); await removeGroup(group); }
            } catch (error) {
              // Safety backstop, not normal cancellation: reject future work
              // if cleanup cannot be verified and stop this owned container.
              familyState.failed = true;
              await podman("stop", "--time", "1", `ronto-family-${familyId}`);
              throw error;
            } finally {
              familyState.active--;
              await rm(processFile, { force: true });
            }
          };
          try {
            await mkdir(controlRoot, { recursive: true, mode: 0o700 });
            const control = await lstat(controlRoot);
            if (control.isSymbolicLink() || control.uid !== uid || (control.mode & 0o077) !== 0) throw new Error("Invalid private sandbox control directory");
            await writeFile(processFile, JSON.stringify({
              terminal: false, user: { uid, gid, additionalGids: [] },
              args: ["/bin/bash", "--noprofile", "--norc", "-c", command],
              env: ["HOME=/workspace/.home", "PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "NPM_CONFIG_PREFIX=/workspace/.home/.local"],
              cwd: `/workspace/channels/${channelId}`, noNewPrivileges: true,
              capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
            }), { mode: 0o600, flag: "wx" });
            await unshare("/bin/mkdir", group);
            groupCreated = true;
            if (signal.aborted) throw new Error("aborted");
            let reason: string | undefined;
            let killing: Promise<void> | undefined;
            const child = spawn("/usr/bin/podman", ["unshare", "/usr/bin/crun", "--root", join(runtime, "crun"), "exec", "--cgroup", name, "--process", processFile, ready.containerId], {
              cwd: home, env: environment, stdio: ["ignore", "pipe", "pipe"],
            });
            const stop = (message: string) => {
              reason ??= message;
              // cgroup.kill can run before crun attaches a process. Remove the
              // group too: a late attach then fails instead of escaping abort.
              killing ??= killGroup(group).then(() => removeGroup(group)).finally(() => { child.kill("SIGKILL"); });
              void killing.catch(() => undefined);
            };
            const onAbort = () => stop("aborted");
            let bytes = 0;
            const onData = (data: Buffer) => {
              if (reason) return;
              const remaining = sandboxLimits.outputBytes - bytes;
              bytes += data.byteLength;
              try { if (remaining > 0) options.onData(data.subarray(0, remaining)); }
              catch { stop("Bash output consumer failed"); }
              if (bytes > sandboxLimits.outputBytes) stop("Bash output exceeded the 4 MiB command limit");
            };
            child.stdout.on("data", onData);
            child.stderr.on("data", onData);
            const closed = new Promise<number | null>((done, fail) => {
              child.once("error", fail);
              child.once("close", done);
            });
            const exited = new Promise<number | null>((done, fail) => {
              child.once("error", fail);
              child.once("exit", done);
            });
            void closed.catch(() => undefined);
            signal.addEventListener("abort", onAbort, { once: true });
            const timer = setTimeout(() => stop(`timeout:${timeout}`), timeout * 1000);
            if (signal.aborted) onAbort();
            try {
              const exitCode = await exited;
              await killing;
              // Detached children can hold stdout open after Bash exits. Reap
              // them before waiting for the pipe's close event.
              await killGroup(group);
              await closed;
              if (reason) throw new Error(reason);
              return { exitCode };
            } finally {
              clearTimeout(timer);
              signal.removeEventListener("abort", onAbort);
            }
          } finally {
            await dispose();
          }
        };
        const execution = Effect.runPromise(
          workspace.withSandboxAccess(familyId, execute),
        );
        pending.add(execution);
        try { return await execution; } finally { pending.delete(execution); }
      },
    });
    return FamilySandbox.of({ operations });
  })).pipe(Layer.provide(SandboxStore.layer));
}
