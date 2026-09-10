import { createBashTool, type BashOperations } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ChannelId } from "@ronto/api";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { sandboxLimits } from "../sandbox/sandbox-config.ts";
import type { ChannelWorkspaceService } from "./channel-workspace.ts";

const OutputDetails = Schema.Struct({ fullOutputPath: Schema.optional(Schema.String) });
const BashInput = Schema.Struct({ command: Schema.String, timeout: Schema.optionalKey(Schema.Number) });

/** Keep Pi's schema, streaming, truncation, and error contract. Only relocate
 * its bounded spill file from host tmp into this channel's durable quota. */
export function createChannelBashTool(
  root: string,
  workspace: ChannelWorkspaceService,
  channelId: ChannelId,
  operations: BashOperations,
): AgentTool {
  const tool = createBashTool(root, { operations, exposeSessionEnvironment: false });
  const execute: typeof tool.execute = async (id, input, signal, onUpdate) => {
    const destination = `workspace/bash-${randomUUID()}.log`;
    let temporary: string | undefined;
    const acceptTemporary = (path: string) => {
      const resolved = resolve(path);
      if (dirname(resolved) !== resolve(tmpdir()) || !/^pi-bash-[a-f0-9]{16}\.log$/.test(basename(resolved))) {
        throw new Error("Unexpected Pi Bash output path");
      }
      if (temporary && temporary !== resolved) throw new Error("Pi Bash output path changed");
      temporary = resolved;
    };
    const persist = async (temporary: string) => {
      try {
        const stat = await lstat(temporary);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.size > sandboxLimits.outputBytes) {
          throw new Error("Invalid Pi Bash output file");
        }
        await Effect.runPromise(workspace.withHostPaths(channelId, [destination], "write", async ([path]) => {
          if (path === undefined) throw new Error("Bash output destination unavailable");
          const file = await open(path, "wx", 0o600);
          try { await file.writeFile(await readFile(temporary)); }
          finally { await file.close(); }
        }));
      } finally { await rm(temporary, { force: true }); }
    };
    const capture = (result: Awaited<ReturnType<typeof tool.execute>>) => {
      const details = Schema.decodeUnknownOption(OutputDetails)(result.details);
      if (details._tag === "Some" && details.value.fullOutputPath) {
        acceptTemporary(details.value.fullOutputPath);
      }
      return {
        ...result,
        content: result.content.map((block) => block.type === "text" && temporary
          ? { ...block, text: block.text.replaceAll(temporary, destination) }
          : block),
        details: temporary ? { ...result.details, fullOutputPath: destination } : result.details,
      };
    };
    try {
      return capture(await tool.execute(id, input, signal, (result) => {
        const update = capture(result);
        onUpdate?.(update);
      }));
    } catch (error) {
      if (error instanceof Error) {
        const outputName = error.message.match(/pi-bash-[a-f0-9]{16}\.log/)?.[0];
        const outputPath = outputName === undefined ? undefined : resolve(tmpdir(), outputName);
        if (!temporary && outputPath && error.message.includes(outputPath)) acceptTemporary(outputPath);
        if (temporary) throw new Error(error.message.replaceAll(temporary, destination));
      }
      throw error;
    } finally {
      if (temporary) await persist(temporary);
    }
  };
  return { ...tool, execute(id, input, signal, onUpdate) {
    return execute(id, Schema.decodeUnknownSync(BashInput)(input), signal, onUpdate);
  } };
}
