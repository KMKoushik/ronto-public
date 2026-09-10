import { ChannelId, FamilyId } from "@ronto/api";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { databasePath } from "../db/database.ts";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

const maxMemoryCharacters = 8_000;
const maxWorkspaceCharacters = 150_000;
const maxManagedFileBytes = 25 * 1024 * 1024;
const maxListedFiles = 500;
const safeChannelId = /^[a-zA-Z0-9-]+$/;
const FileSystemError = Schema.Struct({ code: Schema.optional(Schema.String) });

export const ChannelWorkspaceDocument = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  revision: Schema.String,
});

export type ChannelWorkspaceDocument = typeof ChannelWorkspaceDocument.Type;

export class ChannelWorkspaceError extends Schema.TaggedError<ChannelWorkspaceError>()(
  "ChannelWorkspaceError",
  {
    message: Schema.String,
    kind: Schema.Literals(["conflict", "invalid", "io"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ChannelWorkspaceService {
  root(channelId: ChannelId): Effect.Effect<string, ChannelWorkspaceError>;
  withHostPaths<A>(
    channelId: ChannelId,
    paths: ReadonlyArray<string>,
    access: "read" | "write",
    use: (paths: ReadonlyArray<string>) => Promise<A>,
  ): Effect.Effect<A, ChannelWorkspaceError>;
  withFamilyMemoryPath<A>(
    familyId: FamilyId,
    use: (path: string) => Promise<A>,
  ): Effect.Effect<A, ChannelWorkspaceError>;
  withSandboxAccess<A>(
    familyId: FamilyId,
    use: () => Promise<A>,
  ): Effect.Effect<A>;
  familyUsage(
    familyId: FamilyId,
  ): Effect.Effect<{
    readonly bytes: number;
    readonly device: number | null;
    readonly inode: number | null;
  }, ChannelWorkspaceError>;
  readMemory(
    channelId: ChannelId,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  writeMemory(
    channelId: ChannelId,
    content: string,
    expectedRevision: string,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  readFamilyMemory(
    familyId: FamilyId,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  writeFamilyMemory(
    familyId: FamilyId,
    content: string,
    expectedRevision?: string,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  list(
    channelId: ChannelId,
  ): Effect.Effect<ReadonlyArray<string>, ChannelWorkspaceError>;
  read(
    channelId: ChannelId,
    path: string,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  write(
    channelId: ChannelId,
    path: string,
    content: string,
    expectedRevision?: string,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  edit(
    channelId: ChannelId,
    path: string,
    oldText: string,
    newText: string,
  ): Effect.Effect<ChannelWorkspaceDocument, ChannelWorkspaceError>;
  delete(
    channelId: ChannelId,
    path: string,
  ): Effect.Effect<void, ChannelWorkspaceError>;
  readManaged(
    channelId: ChannelId,
    path: string,
  ): Effect.Effect<Uint8Array, ChannelWorkspaceError>;
  writeManaged(
    channelId: ChannelId,
    path: string,
    content: Uint8Array,
  ): Effect.Effect<void, ChannelWorkspaceError>;
  deleteManaged(
    channelId: ChannelId,
    path: string,
  ): Effect.Effect<void, ChannelWorkspaceError>;
}

const revisionOf = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const invalid = (message: string) =>
  new ChannelWorkspaceError({ message, kind: "invalid" });

export class ChannelWorkspace extends Context.Service<
  ChannelWorkspace,
  ChannelWorkspaceService
>()("ronto/agent/ChannelWorkspace") {
  static layer = (
    familyStorageRoot = process.env.FAMILY_STORAGE_PATH ??
      join(dirname(databasePath), "families"),
  ) =>
    Layer.effect(
      ChannelWorkspace,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const findOwner = SqlSchema.findOneOption({
          Request: ChannelId,
          Result: Schema.Struct({ familyId: FamilyId }),
          execute: (id) => sql`SELECT family_id FROM ronto_channel WHERE id = ${id}`,
        });
        if (process.env.CHANNEL_WORKSPACE_PATH) {
          return yield* Effect.die("Legacy CHANNEL_WORKSPACE_PATH is configured; migrate storage offline and configure FAMILY_STORAGE_PATH before starting Ronto");
        }
        const legacyEntries = yield* Effect.tryPromise({
          try: () => readdir(join(dirname(databasePath), "channels")),
          catch: (cause) => cause,
        }).pipe(Effect.catch((cause) => {
          const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
          return Option.isSome(fs) && fs.value.code === "ENOENT"
            ? Effect.succeed([])
            : Effect.die(cause);
        }));
        if (legacyEntries.length !== 0) {
          return yield* Effect.die("Legacy channel storage remains; migrate storage offline before starting Ronto");
        }
        const locks = new Map<string, Semaphore.Semaphore>();
        const familyFileLocks = new Map<string, Semaphore.Semaphore>();
        const familyFilePermits = 512;

        const lockFor = (id: string) => {
          let lock = locks.get(id);
          if (!lock) {
            lock = Semaphore.makeUnsafe(1);
            locks.set(id, lock);
          }
          return lock;
        };
        const familyFileLock = (id: FamilyId) => {
          let lock = familyFileLocks.get(id);
          if (!lock) {
            lock = Semaphore.makeUnsafe(familyFilePermits);
            familyFileLocks.set(id, lock);
          }
          return lock;
        };
        const channelOwner = async (id: ChannelId) => {
          const owner = await Effect.runPromise(findOwner(id));
          if (Option.isNone(owner)) throw invalid("Channel not found");
          return owner.value.familyId;
        };
        const withHostChannel = async <A>(id: ChannelId, use: () => Promise<A>) => {
          const familyId = await channelOwner(id);
          return Effect.runPromise(
            familyFileLock(familyId).withPermits(
              familyFilePermits,
            )(Effect.promise(use)),
          );
        };
        const withHostFamily = <A>(id: FamilyId, use: () => Promise<A>) =>
          Effect.runPromise(
            familyFileLock(id).withPermits(
              familyFilePermits,
            )(Effect.promise(use)),
          );

        const channelRoot = async (id: ChannelId) => {
          if (!safeChannelId.test(id))
            throw invalid("Invalid channel identifier");
          const owner = await Effect.runPromise(findOwner(id));
          if (Option.isNone(owner)) throw invalid("Channel not found");
          const family = familyRoot(owner.value.familyId);
          // Validate every ancestor below the configured family root. A symlink
          // in a sibling family must never become this family's host root.
          for (const base of [family, join(family, "channels"), join(family, "channels", id)]) {
            await mkdir(base, { recursive: true });
            if ((await lstat(base)).isSymbolicLink()) throw invalid("Symlink paths are not allowed");
          }
          return join(family, "channels", id);
        };
        const familyRoot = (id: FamilyId) => {
          if (!safeChannelId.test(id))
            throw invalid("Invalid family identifier");
          return join(familyStorageRoot, id);
        };

        const checkedFamilyMemoryPath = async (id: FamilyId) => {
          await mkdir(familyStorageRoot, { recursive: true });
          const canonicalRoot = await realpath(familyStorageRoot);
          const base = familyRoot(id);
          await mkdir(base, { recursive: true });
          const baseStat = await lstat(base);
          if (baseStat.isSymbolicLink())
            throw invalid("Symlink paths are not allowed");
          const canonicalBase = await realpath(base);
          const escaped = relative(canonicalRoot, canonicalBase);
          if (escaped === ".." || escaped.startsWith(`..${sep}`))
            throw invalid("Family memory escapes the configured root");
          const path = join(base, "MEMORY.md");
          try {
            if ((await lstat(path)).isSymbolicLink())
              throw invalid("Symlink paths are not allowed");
          } catch (cause) {
            const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
            if (Option.isNone(fs) || fs.value.code !== "ENOENT") throw cause;
          }
          return path;
        };

        const hasInvalidPathComponents = (name: string, isRoot: boolean) =>
          name.includes("\0") ||
          name.includes("\\") ||
          isAbsolute(name) ||
          name === "" ||
          (!isRoot &&
            name
              .split("/")
              .some((part) => part === ".." || part === "." || part === ""));

        const checkedPath = async (
          id: ChannelId,
          name: string,
          access: "read" | "write" | "managed",
        ) => {
          const isRoot = name === ".";
          const isWorkspace = name === "workspace";
          const isWorkspacePath = name.startsWith("workspace/");
          const isManagedFiles = name === "files";
          const isManagedFilePath = name.startsWith("files/");
          if (hasInvalidPathComponents(name, isRoot))
            throw invalid(
              "Path must be relative and cannot contain traversal, backslashes, or empty components",
            );
          if (
            access === "write" &&
            name !== "MEMORY.md" &&
            !isWorkspace &&
            !isWorkspacePath
          )
            throw invalid("Only MEMORY.md and workspace files are writable");
          if (
            access === "managed" &&
            (!isManagedFilePath || name.split("/").length !== 3)
          )
            throw invalid("Managed files must use files/<file-id>/<safe-name>");
          if (
            access === "read" &&
            !isRoot &&
            name !== "MEMORY.md" &&
            !isWorkspace &&
            !isWorkspacePath &&
            !isManagedFiles &&
            !isManagedFilePath
          )
            throw invalid("Path is outside the channel workspace");
          await mkdir(familyStorageRoot, { recursive: true });
          const base = await channelRoot(id);
          const canonicalRoot = await realpath(dirname(base));
          const canonicalBase = await realpath(base);
          const channelEscaped = relative(canonicalRoot, canonicalBase);
          if (channelEscaped === ".." || channelEscaped.startsWith(`..${sep}`))
            throw invalid("Channel workspace escapes the configured root");
          const target = resolve(base, name);
          let probe = target;
          while (probe !== canonicalBase && probe !== dirname(probe)) {
            try {
              const stat = await lstat(probe);
              if (stat.isSymbolicLink())
                throw invalid("Symlink paths are not allowed");
              const canonicalProbe = await realpath(probe);
              const escaped =
                relative(canonicalBase, canonicalProbe).startsWith(
                  `..${sep}`,
                ) || relative(canonicalBase, canonicalProbe) === "..";
              if (escaped) throw invalid("Path escapes the channel workspace");
              break;
            } catch (cause) {
              const fileSystemError =
                Schema.decodeUnknownOption(FileSystemError)(cause);
              if (
                Option.isNone(fileSystemError) ||
                fileSystemError.value.code !== "ENOENT"
              )
                throw cause;
              probe = dirname(probe);
            }
          }
          return target;
        };

        const failure = (message: string, cause: unknown) =>
          new ChannelWorkspaceError({ message, kind: "io", cause });

        const readUnsafe = (id: ChannelId, name: string) =>
          Effect.tryPromise({
            try: async () => {
              const path = await checkedPath(id, name, "read");
              try {
                const content = await readFile(
                  path,
                  "utf8",
                );
                const limit =
                  name === "MEMORY.md"
                    ? maxMemoryCharacters
                    : maxWorkspaceCharacters;
                if (content.length > limit)
                  throw invalid(`File is limited to ${limit} characters`);
                return { path: name, content, revision: revisionOf(content) };
              } catch (cause) {
                const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
                if (
                  Option.isSome(fs) &&
                  fs.value.code === "ENOENT" &&
                  name === "MEMORY.md"
                )
                  return { path: name, content: "", revision: revisionOf("") };
                throw cause;
              }
            },
            catch: (cause) =>
              cause instanceof ChannelWorkspaceError
                ? cause
                : failure("Could not read channel file", cause),
          });

        const validate = (name: string, content: string) => {
          const limit =
            name === "MEMORY.md" ? maxMemoryCharacters : maxWorkspaceCharacters;
          if (content.includes("\0"))
            return Effect.fail(
              invalid("File content cannot contain null characters"),
            );
          if (content.length > limit)
            return Effect.fail(
              invalid(`File is limited to ${limit} characters`),
            );
          return Effect.void;
        };

        const writeUnsafe = (
          id: ChannelId,
          name: string,
          content: string,
          expected?: string,
        ) =>
          Effect.gen(function* () {
            yield* validate(name, content);
            const path = yield* Effect.tryPromise({
              try: () => checkedPath(id, name, "write"),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not validate channel file", cause),
            });
            const temporary = `${path}.${randomUUID()}.tmp`;
            yield* Effect.tryPromise({
              try: async () => {
                let currentContent = "";
                try {
                  currentContent = await readFile(path, "utf8");
                } catch (cause) {
                  const fileSystemError =
                    Schema.decodeUnknownOption(FileSystemError)(cause);
                  if (
                    Option.isNone(fileSystemError) ||
                    fileSystemError.value.code !== "ENOENT"
                  )
                    throw cause;
                }
                if (
                  expected !== undefined &&
                  revisionOf(currentContent) !== expected
                )
                  throw new ChannelWorkspaceError({
                    message: "File changed; reload before saving",
                    kind: "conflict",
                  });
                await mkdir(dirname(path), { recursive: true });
                await writeFile(temporary, content, "utf8");
                await rename(temporary, path);
              },
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not write channel file", cause),
            }).pipe(
              Effect.ensuring(
                Effect.promise(() => rm(temporary, { force: true })).pipe(
                  Effect.ignore,
                ),
              ),
            );
            return { path: name, content, revision: revisionOf(content) };
          });

        const readMemory = (id: ChannelId) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, () => Effect.runPromise(readUnsafe(id, "MEMORY.md"))),
              catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not read channel memory", cause),
            }),
          );

        const rootUnsafe = Effect.fn("ChannelWorkspace.rootUnsafe")(function* (
          id: ChannelId,
        ) {
          const base = yield* Effect.tryPromise({
            try: () => checkedPath(id, ".", "read"),
            catch: (cause) =>
              cause instanceof ChannelWorkspaceError
                ? cause
                : failure("Could not prepare channel workspace", cause),
          });
          yield* Effect.tryPromise({
            try: () =>
              Promise.all([
                mkdir(join(base, "workspace"), { recursive: true }),
                mkdir(join(base, "files"), { recursive: true }),
              ]),
            catch: (cause) =>
              failure("Could not prepare channel workspace", cause),
          });
          return base;
        });
        const rootFor = (id: ChannelId) => Effect.tryPromise({
          try: () => withHostChannel(id, () => Effect.runPromise(rootUnsafe(id))),
          catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not prepare channel workspace", cause),
        });
        const relativeName = async (id: ChannelId, name: string) => isAbsolute(name)
          ? relative(await channelRoot(id), resolve(name)).split(sep).join("/")
          : name;
        const withHostPaths = <A>(id: ChannelId, names: ReadonlyArray<string>, access: "read" | "write", use: (paths: ReadonlyArray<string>) => Promise<A>) =>
          Effect.tryPromise({
            try: () => withHostChannel(id, async () => {
              const paths = await Promise.all(names.map(async (name) => checkedPath(id, await relativeName(id, name), access)));
              return use(paths);
            }),
            catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not access channel path", cause),
          });
        const withFamilyMemoryPath = <A>(id: FamilyId, use: (path: string) => Promise<A>) =>
          Effect.tryPromise({
            try: () => withHostFamily(id, async () => use(await checkedFamilyMemoryPath(id))),
            catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not access family memory", cause),
          });
        const withSandboxAccess = <A>(id: FamilyId, use: () => Promise<A>) =>
          familyFileLock(id).withPermit(Effect.promise(use));

        const writeMemory = (
          id: ChannelId,
          content: string,
          revision: string,
        ) =>
          lockFor(id).withPermit(Effect.tryPromise({
            try: () => withHostChannel(id, () => Effect.runPromise(writeUnsafe(id, "MEMORY.md", content, revision))),
            catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not write channel memory", cause),
          }));

        const readFamilyMemory = (id: FamilyId) =>
          lockFor(`family:${id}`).withPermit(
            Effect.tryPromise({
              try: () => withHostFamily(id, async () => {
                const path = await checkedFamilyMemoryPath(id);
                try {
                  const content = await readFile(path, "utf8");
                  if (content.length > maxMemoryCharacters)
                    throw invalid(
                      `File is limited to ${maxMemoryCharacters} characters`,
                    );
                  return {
                    path: "FAMILY_MEMORY.md",
                    content,
                    revision: revisionOf(content),
                  };
                } catch (cause) {
                  const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
                  if (Option.isSome(fs) && fs.value.code === "ENOENT")
                    return {
                      path: "FAMILY_MEMORY.md",
                      content: "",
                      revision: revisionOf(""),
                    };
                  throw cause;
                }
              }),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not read family memory", cause),
            }),
          );

        const familyUsage = (id: FamilyId) => Effect.tryPromise({
          try: () => withHostFamily(id, async () => {
            const root = familyRoot(id);
            let rootStat;
            try {
              rootStat = await lstat(root);
            } catch (cause) {
              const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
              if (Option.isSome(fs) && fs.value.code === "ENOENT") {
                return { bytes: 0, device: null, inode: null };
              }
              throw cause;
            }
            if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
              throw invalid("Family storage root is invalid");
            }
            let bytes = rootStat.blocks * 512;
            let visited = 1;
            const pending = [root];
            while (pending.length > 0) {
              const directory = pending.pop();
              if (directory === undefined) break;
              for (const entry of await readdir(directory)) {
                visited += 1;
                if (visited > 1_000_000) throw invalid("Family storage contains too many entries to measure safely");
                const path = join(directory, entry);
                const stat = await lstat(path);
                bytes += stat.blocks * 512;
                if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(path);
              }
            }
            return { bytes, device: rootStat.dev, inode: rootStat.ino };
          }),
          catch: (cause) => cause instanceof ChannelWorkspaceError
            ? cause
            : failure("Could not measure family storage", cause),
        });

        const writeFamilyMemory = (
          id: FamilyId,
          content: string,
          expected?: string,
        ) =>
          lockFor(`family:${id}`).withPermit(
            Effect.tryPromise({
              try: () => withHostFamily(id, () => Effect.runPromise(Effect.gen(function* () {
              yield* validate("MEMORY.md", content);
              const path = yield* Effect.tryPromise({
                try: () => checkedFamilyMemoryPath(id),
                catch: (cause) =>
                  cause instanceof ChannelWorkspaceError
                    ? cause
                    : failure("Could not validate family memory", cause),
              });
              const temporary = `${path}.${randomUUID()}.tmp`;
              yield* Effect.tryPromise({
                try: async () => {
                  let currentContent = "";
                  try {
                    currentContent = await readFile(path, "utf8");
                  } catch (cause) {
                    const fs = Schema.decodeUnknownOption(FileSystemError)(cause);
                    if (Option.isNone(fs) || fs.value.code !== "ENOENT")
                      throw cause;
                  }
                  if (
                    expected !== undefined &&
                    revisionOf(currentContent) !== expected
                  )
                    throw new ChannelWorkspaceError({
                      message: "File changed; reload before saving",
                      kind: "conflict",
                    });
                  await mkdir(dirname(path), { recursive: true });
                  await writeFile(temporary, content, "utf8");
                  await rename(temporary, path);
                },
                catch: (cause) =>
                  cause instanceof ChannelWorkspaceError
                    ? cause
                    : failure("Could not write family memory", cause),
              }).pipe(
                Effect.ensuring(
                  Effect.promise(() => rm(temporary, { force: true })).pipe(
                    Effect.ignore,
                  ),
                ),
              );
              return {
                path: "FAMILY_MEMORY.md",
                content,
                revision: revisionOf(content),
              };
              }))),
              catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not write family memory", cause),
            }),
          );

        const list = (id: ChannelId) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, async () => {
                await checkedPath(id, "MEMORY.md", "read");
                const result = ["MEMORY.md"];
                const base = await checkedPath(id, "workspace", "read");
                const walk = async (
                  dir: string,
                  prefix: string,
                ): Promise<void> => {
                  for (const entry of await readdir(dir, {
                    withFileTypes: true,
                  }).catch(() => [])) {
                    const name = `${prefix}${entry.name}`;
                    if (entry.isDirectory())
                      await walk(join(dir, entry.name), `${name}/`);
                    else if (entry.isFile()) {
                      await checkedPath(id, name, "read");
                      result.push(name);
                      if (result.length > maxListedFiles)
                        throw invalid(
                          `Channel file listing is limited to ${maxListedFiles} files`,
                        );
                    }
                  }
                };
                await walk(base, "workspace/");
                return result;
              }),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not list channel files", cause),
            }),
          );

        const read = (id: ChannelId, name: string) =>
          lockFor(id).withPermit(Effect.tryPromise({
            try: () => withHostChannel(id, () => Effect.runPromise(readUnsafe(id, name))),
            catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not read channel file", cause),
          }));

        const write = (
          id: ChannelId,
          name: string,
          content: string,
          revision?: string,
        ) => lockFor(id).withPermit(Effect.tryPromise({
          try: () => withHostChannel(id, () => Effect.runPromise(writeUnsafe(id, name, content, revision))),
          catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not write channel file", cause),
        }));

        const edit = (
          id: ChannelId,
          name: string,
          oldText: string,
          newText: string,
        ) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, () => Effect.runPromise(Effect.gen(function* () {
              if (!oldText)
                return yield* invalid("Text to replace cannot be empty");
              const current = yield* readUnsafe(id, name);
              const at = current.content.indexOf(oldText);
              if (
                at < 0 ||
                current.content.indexOf(oldText, at + oldText.length) >= 0
              )
                return yield* new ChannelWorkspaceError({
                  message: "Text must match exactly once",
                  kind: "conflict",
                });
              return yield* writeUnsafe(
                id,
                name,
                `${current.content.slice(0, at)}${newText}${current.content.slice(at + oldText.length)}`,
                current.revision,
              );
              }))),
              catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not edit channel file", cause),
            }),
          );

        const remove = (id: ChannelId, name: string) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, async () => {
                const path = await checkedPath(id, name, "write");
                if (name === "MEMORY.md")
                  throw invalid("MEMORY.md cannot be deleted");
                await rm(path);
              }),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not delete channel file", cause),
            }),
          );

        const readManaged = (id: ChannelId, name: string) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, async () => {
                const path = await checkedPath(id, name, "managed");
                const content = await readFile(path);
                if (content.byteLength > maxManagedFileBytes)
                  throw invalid(
                    `Managed files are limited to ${maxManagedFileBytes} bytes`,
                  );
                return content;
              }),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not read managed file", cause),
            }),
          );

        const writeManaged = (
          id: ChannelId,
          name: string,
          content: Uint8Array,
        ) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, () => Effect.runPromise(Effect.gen(function* () {
              if (content.byteLength > maxManagedFileBytes)
                return yield* invalid(
                  `Managed files are limited to ${maxManagedFileBytes} bytes`,
                );
              const path = yield* Effect.tryPromise({
                try: () => checkedPath(id, name, "managed"),
                catch: (cause) =>
                  cause instanceof ChannelWorkspaceError
                    ? cause
                    : failure("Could not validate managed file", cause),
              });
              const temporary = `${path}.${randomUUID()}.tmp`;
              yield* Effect.tryPromise({
                try: async () => {
                  await mkdir(dirname(path), { recursive: true });
                  await writeFile(temporary, content);
                  await rename(temporary, path);
                },
                catch: (cause) =>
                  failure("Could not write managed file", cause),
              }).pipe(
                Effect.ensuring(
                  Effect.promise(() => rm(temporary, { force: true })).pipe(
                    Effect.ignore,
                  ),
                ),
              );
              }))),
              catch: (cause) => cause instanceof ChannelWorkspaceError ? cause : failure("Could not write managed file", cause),
            }),
          );

        const deleteManaged = (id: ChannelId, name: string) =>
          lockFor(id).withPermit(
            Effect.tryPromise({
              try: () => withHostChannel(id, async () => {
                const path = await checkedPath(id, name, "managed");
                await rm(dirname(path), {
                  recursive: true,
                  force: true,
                });
              }),
              catch: (cause) =>
                cause instanceof ChannelWorkspaceError
                  ? cause
                  : failure("Could not delete managed file", cause),
            }),
          );

        return ChannelWorkspace.of({
          root: rootFor,
          withHostPaths,
          withFamilyMemoryPath,
          withSandboxAccess,
          familyUsage,
          readMemory,
          writeMemory,
          readFamilyMemory,
          writeFamilyMemory,
          list,
          read,
          write,
          edit,
          delete: remove,
          readManaged,
          writeManaged,
          deleteManaged,
        });
      }),
    );
}
