import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createCodingTools,
  createGrepTool,
  createReadOnlyTools,
  type EditToolOptions,
  type FindToolOptions,
  type LsToolOptions,
  type ReadToolOptions,
  type WriteToolOptions,
} from "@earendil-works/pi-coding-agent";
import type { ChannelId, FamilyId } from "@ronto/api";
import { Effect } from "effect";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { matchesGlob, relative, resolve, sep } from "node:path";

import type {
  ChannelWorkspaceError,
  ChannelWorkspaceService,
} from "./channel-workspace.ts";
import { createChannelBashTool } from "./channel-bash-tool.ts";
import { FamilySandbox } from "../sandbox/family-sandbox.ts";

export const createChannelTools = Effect.fn("createChannelTools")(function* (
  workspace: ChannelWorkspaceService,
  channelId: ChannelId,
  familyId: FamilyId,
  additionalTools: ReadonlyArray<AgentTool>,
  skillPaths: ReadonlySet<string> = new Set(),
): Effect.fn.Return<Array<AgentTool>, ChannelWorkspaceError | Error, FamilySandbox> {
  const sandbox = yield* FamilySandbox;
  const root = yield* workspace.root(channelId);
  const familyMemory = resolve(root, "FAMILY_MEMORY.md");
  const isFamilyMemory = (absolutePath: string) =>
    resolve(absolutePath) === familyMemory;

  const withPath = <A>(
    absolutePath: string,
    mode: "read" | "write",
    use: (path: string) => Promise<A>,
  ) => Effect.runPromise(
    isFamilyMemory(absolutePath)
      ? workspace.withFamilyMemoryPath(familyId, use)
      : workspace.withHostPaths(channelId, [absolutePath], mode, ([path]) => {
          if (path === undefined) throw new Error("Channel path unavailable");
          return use(path);
        }),
  );
  const workspacePath = (absolutePath: string) =>
    relative(root, absolutePath).split(sep).join("/");

  const readOptions = {
    operations: {
      // Only deployment-discovered skill files may be read outside the family
      // workspace. Writes and all other paths retain the workspace boundary.
      readFile: async (absolutePath) =>
        skillPaths.has(resolve(absolutePath))
          ? readFile(absolutePath)
          : isFamilyMemory(absolutePath)
          ? Buffer.from(
              (await Effect.runPromise(workspace.readFamilyMemory(familyId)))
                .content,
            )
          : withPath(absolutePath, "read", (path) => readFile(path)),
      access: async (absolutePath) => {
        if (skillPaths.has(resolve(absolutePath))) {
          await access(absolutePath);
          return;
        }
        if (isFamilyMemory(absolutePath)) {
          await Effect.runPromise(workspace.readFamilyMemory(familyId));
          return;
        }
        await withPath(absolutePath, "read", (path) => access(path));
      },
    },
  } satisfies ReadToolOptions;
  const writeOptions = {
    operations: {
      writeFile: async (absolutePath, content) => {
        if (isFamilyMemory(absolutePath)) {
          await Effect.runPromise(
            workspace.writeFamilyMemory(familyId, content),
          );
          return;
        }
        await Effect.runPromise(workspace.write(channelId, workspacePath(absolutePath), content));
      },
      mkdir: async (absolutePath) => {
        if (absolutePath === root || isFamilyMemory(absolutePath)) return;
        await withPath(absolutePath, "write", async () => undefined);
      },
    },
  } satisfies WriteToolOptions;
  const editOptions = {
    operations: {
      readFile: async (absolutePath) =>
        isFamilyMemory(absolutePath)
          ? Buffer.from(
              (await Effect.runPromise(workspace.readFamilyMemory(familyId)))
                .content,
            )
          : withPath(absolutePath, "read", (path) => readFile(path)),
      writeFile: async (absolutePath, content) => {
        if (isFamilyMemory(absolutePath)) {
          await Effect.runPromise(
            workspace.writeFamilyMemory(familyId, content),
          );
          return;
        }
        await Effect.runPromise(workspace.write(channelId, workspacePath(absolutePath), content));
      },
      access: async (absolutePath) => {
        if (isFamilyMemory(absolutePath)) {
          await Effect.runPromise(workspace.readFamilyMemory(familyId));
          return;
        }
        await withPath(absolutePath, "write", (path) => access(path));
      },
    },
  } satisfies EditToolOptions;
  const lsOptions = {
    operations: {
      exists: async (absolutePath) => {
        try {
          await withPath(absolutePath, "read", (path) => stat(path));
          return true;
        } catch {
          return false;
        }
      },
      stat: async (absolutePath) => withPath(absolutePath, "read", (path) => stat(path)),
      readdir: async (absolutePath) =>
        withPath(absolutePath, "read", (path) => readdir(path)),
    },
  } satisfies LsToolOptions;
  const findOptions = {
    operations: {
      exists: async (absolutePath) => {
        try {
          await withPath(absolutePath, "read", (path) => stat(path));
          return true;
        } catch {
          return false;
        }
      },
      glob: async (pattern, cwd, options) => {
        return withPath(cwd, "read", async (approved) => {
          const matches: string[] = [];
          let visited = 0;
          const ignored = (name: string) => options.ignore.some((ignore) =>
            matchesGlob(name, ignore) || matchesGlob(`${name}/`, ignore)
          );
          const walk = async (directory: string, prefix: string): Promise<void> => {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
              const name = `${prefix}${entry.name}`;
              visited++;
              if (visited > 10_000) throw new Error("Find is limited to 10,000 workspace entries");
              if (entry.isSymbolicLink() || ignored(name)) continue;
              if (entry.isDirectory()) await walk(resolve(directory, entry.name), `${name}/`);
              else if (entry.isFile() && matchesGlob(name, pattern)) matches.push(name);
              if (matches.length >= options.limit) return;
            }
          };
          await walk(approved, "");
          return matches;
        });
      },
    },
  } satisfies FindToolOptions;
  // Pi spawns rg directly: its operations callbacks do not enclose the search.
  // Hold validation through subprocess exit and context reads, without nested
  // permit acquisition. rg does not follow nested symlinks by default.
  const standardGrep = createGrepTool(root);
  const grepTool: typeof standardGrep = {
    ...standardGrep,
    execute: (id, parameters, signal, onUpdate) => Effect.runPromise(
      workspace.withHostPaths(channelId, [parameters.path || "."], "read", ([path]) => {
        if (path === undefined) throw new Error("Channel path unavailable");
        return standardGrep.execute(id, { ...parameters, path }, signal, onUpdate);
      }),
    ),
  };
  const codingTools = createCodingTools(root, {
    bash: { operations: sandbox.operations(familyId, channelId), exposeSessionEnvironment: false },
    read: readOptions,
    edit: editOptions,
    write: writeOptions,
  });
  const [, , findTool, lsTool] = createReadOnlyTools(root, {
    read: readOptions,
    find: findOptions,
    ls: lsOptions,
  });
  if (
    findTool === undefined ||
    lsTool === undefined
  ) {
    return yield* Effect.die("Standard read-only tools could not be created");
  }

  const globTool = {
    ...findTool,
    name: "glob",
    label: "Glob",
  };

  return [
    ...codingTools.map((tool) => tool.name === "bash"
      ? createChannelBashTool(root, workspace, channelId, sandbox.operations(familyId, channelId))
      : tool),
    globTool, grepTool, lsTool, ...additionalTools,
  ];
});
