import type { ChannelId } from "@ronto/api";
import { Schema } from "effect";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DarwinSandboxImage, sandboxLimits } from "./sandbox-config.ts";
import type { SandboxSlot } from "./sandbox-store.ts";

const execFileAsync = promisify(execFile);
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
const ImageInspect = Schema.Array(Schema.Struct({
  configuration: Schema.Struct({
    descriptor: Schema.Struct({ digest: Digest }),
    name: Schema.String,
  }),
}));
const ContainerList = Schema.Array(Schema.Struct({ id: Schema.String }));
const ContainerInspect = Schema.Array(Schema.Struct({
  id: Schema.String,
  configuration: Schema.Struct({
    capAdd: Schema.Array(Schema.String),
    capDrop: Schema.Array(Schema.String),
    image: Schema.Struct({
      descriptor: Schema.Struct({ digest: Digest }),
      reference: Schema.String,
    }),
    initProcess: Schema.Struct({
      arguments: Schema.Array(Schema.String),
      environment: Schema.Array(Schema.String),
      executable: Schema.String,
      rlimits: Schema.Array(Schema.Struct({ hard: Schema.Int, limit: Schema.String, soft: Schema.Int })),
      supplementalGroups: Schema.Array(Schema.Int),
      terminal: Schema.Boolean,
      user: Schema.Struct({ id: Schema.Struct({ gid: Schema.Int, uid: Schema.Int }) }),
      workingDirectory: Schema.String,
    }),
    labels: Schema.Record(Schema.String, Schema.String),
    mounts: Schema.Array(Schema.Struct({
      destination: Schema.String,
      options: Schema.Array(Schema.String),
      source: Schema.String,
      type: Schema.Record(Schema.String, Schema.Unknown),
    })),
    networks: Schema.Array(Schema.Struct({ network: Schema.String })),
    publishedPorts: Schema.Array(Schema.Unknown),
    publishedSockets: Schema.Array(Schema.Unknown),
    readOnly: Schema.Boolean,
    resources: Schema.Struct({ cpus: Schema.Number, memoryInBytes: Schema.Int }),
    rosetta: Schema.Boolean,
    ssh: Schema.Boolean,
    virtualization: Schema.Boolean,
  }),
  status: Schema.Struct({ state: Schema.String }),
}));

function value(output: string, name: string) {
  const line = output.split("\n").find((entry) => entry.trimStart().startsWith(`${name}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

export interface DarwinExecOptions {
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly onData: (data: Buffer) => void;
}

export interface DarwinFamilySandboxRuntime {
  readonly prepare: () => Promise<void>;
  readonly exec: (
    slot: SandboxSlot,
    channelId: ChannelId,
    command: string,
    options: DarwinExecOptions,
  ) => Promise<{ exitCode: number | null }>;
}

export function darwinSandboxRuntime(root: string): DarwinFamilySandboxRuntime {
  const image = process.env.RONTO_SANDBOX_IMAGE;
  const imageDigest = process.env.RONTO_SANDBOX_IMAGE_DIGEST;
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  const home = homedir();
  const binary = process.env.RONTO_CONTAINER_PATH ?? "/opt/homebrew/opt/container/bin/container";
  const environment = {
    HOME: home,
    USER: "ronto",
    LOGNAME: "ronto",
    PATH: "/opt/homebrew/opt/container/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    LC_ALL: "C",
  };
  const invoke = async (args: ReadonlyArray<string>, timeout = 30_000) =>
    (await execFileAsync(binary, [...args], { cwd: home, env: environment, timeout, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const inspect = async (name: string) => {
    const parsed = Schema.decodeUnknownSync(ContainerInspect)(JSON.parse(await invoke(["inspect", name])));
    const [container] = parsed;
    if (parsed.length !== 1 || !container) throw new Error("Sandbox container unavailable");
    return container;
  };
  const configured = () => {
    if (uid === undefined || uid === 0 || gid === undefined || !Schema.is(DarwinSandboxImage)(image) || !Schema.is(Digest)(imageDigest)) {
      throw new Error("Rootless family Bash is not configured; host Bash is never used as a fallback");
    }
    return { image, imageDigest, uid, gid };
  };
  const verifyImage = async () => {
    const config = configured();
    const parsed = Schema.decodeUnknownSync(ImageInspect)(JSON.parse(await invoke(["image", "inspect", config.image])));
    const [result] = parsed;
    if (parsed.length !== 1 || result?.configuration.name !== config.image || result.configuration.descriptor.digest !== config.imageDigest) {
      throw new Error("Darwin sandbox image digest does not match the configured immutable release image");
    }
    return config;
  };
  const validateDirectory = async (slot: SandboxSlot, channelId: ChannelId) => {
    const directory = join(root, slot.id);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory ||
      slot.storageKind !== "darwin-apfs-image" || !slot.storageIdentity) {
      throw new Error("Family storage changed; offline APFS image provisioning is required");
    }
    const output = await invoke(["system", "status", "--format", "json"]);
    const status = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.Literal("running") }))(JSON.parse(output));
    if (status.status !== "running") throw new Error("Apple container service is unavailable");
    const disk = await execFileAsync("/usr/sbin/diskutil", ["info", directory], {
      env: { PATH: "/usr/sbin:/usr/bin:/bin", LC_ALL: "C" }, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    const mountPoint = value(disk.stdout, "Mount Point");
    if (!mountPoint || await realpath(mountPoint) !== directory || value(disk.stdout, "File System Personality") !== "Case-sensitive APFS" ||
      value(disk.stdout, "Volume UUID") !== slot.storageIdentity) {
      throw new Error("Family APFS image identity or mount configuration is invalid");
    }
    for (const path of [join(directory, ".home"), join(directory, "channels"), join(directory, "channels", channelId)]) {
      if (await realpath(path) !== path || (await lstat(path)).isSymbolicLink()) throw new Error("Sandbox working paths must not traverse symlinks");
    }
    return directory;
  };
  const validateContainer = (container: (typeof ContainerInspect.Type)[number], directory: string, name: string, familyId: string, config: ReturnType<typeof configured>) => {
    const process = container.configuration.initProcess;
    const workspace = container.configuration.mounts.find((mount) => mount.destination === "/workspace");
    const temporary = container.configuration.mounts.find((mount) => mount.destination === "/tmp");
    const nproc = process.rlimits.find((limit) => limit.limit === "RLIMIT_NPROC");
    const expectedEnvironment = ["HOME=/workspace/.home", "PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin"].sort().join("\0");
    const checks = [
      container.id === name,
      container.status.state === "running",
      container.configuration.image.reference === config.image,
      container.configuration.image.descriptor.digest === config.imageDigest,
      container.configuration.labels["dev.ronto.command"] === name,
      container.configuration.labels["dev.ronto.family"] === familyId,
      container.configuration.capAdd.length === 0,
      container.configuration.capDrop.includes("ALL"),
      process.user.id.uid === config.uid,
      process.user.id.gid === config.gid,
      process.supplementalGroups.length === 0,
      !process.terminal,
      process.workingDirectory === "/workspace",
      process.executable === "/usr/bin/tini",
      process.arguments.join("\0") === ["--", "sleep", "infinity"].join("\0"),
      [...process.environment].sort().join("\0") === expectedEnvironment,
      nproc?.soft === sandboxLimits.pids,
      nproc?.hard === sandboxLimits.pids,
      container.configuration.readOnly,
      container.configuration.resources.cpus === sandboxLimits.cpus,
      container.configuration.resources.memoryInBytes === sandboxLimits.memoryBytes,
      !container.configuration.rosetta,
      !container.configuration.ssh,
      !container.configuration.virtualization,
      container.configuration.publishedPorts.length === 0,
      container.configuration.publishedSockets.length === 0,
      container.configuration.networks.length === 1,
      container.configuration.networks[0]?.network === "default",
      container.configuration.mounts.length === 2,
      workspace?.source === directory,
      workspace ? "virtiofs" in workspace.type : false,
      temporary?.source === "tmpfs",
      temporary ? "tmpfs" in temporary.type : false,
      temporary?.options.includes(`size=${sandboxLimits.tmpBytes}`),
      temporary?.options.includes("mode=1777"),
    ];
    if (!checks.every(Boolean)) {
      throw new Error("Darwin sandbox container configuration is invalid");
    }
  };
  const remove = async (name: string) => {
    await invoke(["rm", "--force", name], 60_000).catch(() => undefined);
  };

  const prepare = async () => {
    await verifyImage();
    const listed = Schema.decodeUnknownSync(ContainerList)(JSON.parse(await invoke(["list", "--all", "--format", "json"])));
    for (const entry of listed) {
      if (!entry.id.startsWith("ronto-command-")) continue;
      if (!/^ronto-command-[a-f0-9-]+$/.test(entry.id)) throw new Error("Unexpected managed sandbox name");
      const container = await inspect(entry.id);
      if (container.configuration.labels["dev.ronto.command"] !== entry.id || !container.configuration.labels["dev.ronto.family"]) {
        throw new Error("Sandbox command name is occupied by an unmanaged container");
      }
      await remove(entry.id);
    }
  };

  const execute = async (slot: SandboxSlot, channelId: ChannelId, command: string, options: DarwinExecOptions) => {
    const config = await verifyImage();
    const directory = await validateDirectory(slot, channelId);
    const name = `ronto-command-${randomUUID()}`;
    let created = false;
    try {
      await invoke([
        "run", "--detach", "--name", name,
        "--label", `dev.ronto.command=${name}`, "--label", `dev.ronto.family=${slot.id}`,
        "--cpus", String(sandboxLimits.cpus), "--memory", String(sandboxLimits.memoryBytes),
        "--read-only", "--cap-drop", "ALL", "--ulimit", `nproc=${sandboxLimits.pids}:${sandboxLimits.pids}`,
        "--tmpfs", `/tmp:size=${sandboxLimits.tmpBytes},mode=1777`,
        "--mount", `type=bind,source=${directory},target=/workspace`, "--workdir", "/workspace",
        "--uid", String(config.uid), "--gid", String(config.gid),
        "--env", "HOME=/workspace/.home", "--env", "PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin",
        "--network", "default", config.image, "sleep", "infinity",
      ], 120_000);
      created = true;
      validateContainer(await inspect(name), directory, name, slot.id, config);
      if (options.signal.aborted) throw new Error("aborted");
      let reason: string | undefined;
      let killing: Promise<void> | undefined;
      const child = spawn(binary, [
        "exec", "--uid", String(config.uid), "--gid", String(config.gid),
        "--workdir", `/workspace/channels/${channelId}`,
        "--env", "HOME=/workspace/.home", "--env", "PATH=/workspace/.home/.local/bin:/usr/local/bin:/usr/bin:/bin",
        "--env", "LANG=C.UTF-8", "--env", "NPM_CONFIG_PREFIX=/workspace/.home/.local",
        name, "/bin/bash", "--noprofile", "--norc", "-c", command,
      ], { cwd: home, env: environment, stdio: ["ignore", "pipe", "pipe"] });
      const stop = (message: string) => {
        reason ??= message;
        killing ??= invoke(["kill", name], 30_000).then(() => undefined).catch(() => undefined).finally(() => child.kill("SIGKILL"));
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
      options.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => stop(`timeout:${options.timeout}`), options.timeout * 1000);
      if (options.signal.aborted) onAbort();
      try {
        const exitCode = await exited;
        await killing;
        await remove(name);
        created = false;
        await closed;
        if (reason) throw new Error(reason);
        return { exitCode };
      } finally {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onAbort);
      }
    } finally {
      if (created) await remove(name);
    }
  };
  return { prepare, exec: execute };
}
