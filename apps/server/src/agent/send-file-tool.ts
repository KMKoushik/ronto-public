import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  AgentRunId,
  ChannelId,
  ConversationId,
  FamilyMemberId,
  FileId,
} from "@ronto/api";
import { Context, Effect } from "effect";
import mime from "mime";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Type } from "typebox";

import { RontoStore } from "../db/ronto-store.ts";
import type { ChannelWorkspaceService } from "./channel-workspace.ts";

const maxFileBytes = 25 * 1024 * 1024;
const sendFileParameters = Type.Object({
  path: Type.String({
    minLength: 1,
    description:
      "Channel-relative path under workspace/ or files/, for example workspace/report.pdf",
  }),
});

type ServiceContract<Service> =
  Service extends Context.Service<infer _Self, infer Contract>
    ? Contract
    : never;
type SendFileStore = Pick<
  ServiceContract<typeof RontoStore>,
  "createConversationFile" | "deleteFile" | "findFile"
>;

export interface SendFileAuthority {
  readonly channelId: ChannelId;
  readonly conversationId: ConversationId;
  readonly memberId: FamilyMemberId;
  readonly runId: AgentRunId;
}

const readBounded = async (path: string): Promise<Buffer> => {
  const chunks: Array<Buffer> = [];
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += bytes.byteLength;
    if (byteSize > maxFileBytes)
      throw new Error("Files sent to the family are limited to 25 MiB");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, byteSize);
};

export const createSendFileTool = (
  store: SendFileStore,
  workspace: ChannelWorkspaceService,
  authority: SendFileAuthority,
  attach: (fileId: FileId) => void,
): AgentTool<typeof sendFileParameters> => ({
  name: "send_file",
  label: "Send File",
  description:
    "Attach a channel file to your final response so the family member can view or download it. Files under workspace/ are copied into managed storage; files already under files/ are attached directly.",
  parameters: sendFileParameters,
  execute: async (_toolCallId, parameters) => {
    if (
      !parameters.path.startsWith("workspace/") &&
      !parameters.path.startsWith("files/")
    ) {
      throw new Error("Only workspace/ and files/ paths can be sent");
    }

    if (parameters.path.startsWith("files/")) {
      const fileId = parameters.path.split("/")[1];
      if (fileId === undefined) throw new Error("Managed file path is invalid");
      const file = await Effect.runPromise(
        store.findFile(FileId.make(fileId), authority.memberId),
      );
      if (
        file === null ||
        file.channelId !== authority.channelId ||
        file.storagePath !== parameters.path
      ) {
        throw new Error("Managed file was not found in this channel");
      }
      attach(file.id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Attached ${file.name} to the final response.`,
          },
        ],
        details: {
          fileId: file.id,
          name: file.name,
          mediaType: file.mediaType,
          byteSize: file.byteSize,
        },
      };
    }

    const content = await Effect.runPromise(workspace.withHostPaths(
      authority.channelId,
      [parameters.path],
      "read",
      async ([source]) => {
        if (source === undefined) throw new Error("File path unavailable");
        const sourceStat = await stat(source);
        if (!sourceStat.isFile()) throw new Error("Only regular files can be sent");
        return readBounded(source);
      },
    ));
    const name = basename(parameters.path);
    const file = await Effect.runPromise(
      store.createConversationFile({
        fileId: FileId.make(randomUUID()),
        conversationId: authority.conversationId,
        memberId: authority.memberId,
        messageId: null,
        runId: authority.runId,
        kind: "generated",
        name,
        mediaType: mime.getType(name) ?? "application/octet-stream",
        byteSize: content.byteLength,
        checksum: createHash("sha256").update(content).digest("hex"),
      }),
    );
    try {
      await Effect.runPromise(
        workspace.writeManaged(file.channelId, file.storagePath, content),
      );
    } catch (cause) {
      await Effect.runPromise(store.deleteFile(file.id, authority.memberId));
      throw cause;
    }
    attach(file.id);
    return {
      content: [
        {
          type: "text" as const,
          text: `Attached ${file.name} to the final response.`,
        },
      ],
      details: {
        fileId: file.id,
        name: file.name,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
      },
    };
  },
});
