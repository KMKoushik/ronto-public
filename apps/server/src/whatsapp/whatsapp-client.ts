import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  generateWAMessageFromContent,
  isJidGroup,
  makeCacheableSignalKeyStore,
  type AnyMessageContent,
  type BinaryNode,
  type WAMessage,
  type WASocket,
  proto,
} from "@whiskeysockets/baileys";
import { Context, Effect, Layer, Schema } from "effect";
import { createHash, timingSafeEqual } from "node:crypto";

import { WhatsappAuth } from "./whatsapp-auth-state.ts";
import {
  normalizeWhatsappMessage,
  type NormalizedWhatsappMessage,
  type NormalizedWhatsappMedia,
} from "./whatsapp-normalize.ts";
import {
  whatsappDocumentMediaType,
  whatsappImageMediaType,
} from "./whatsapp-media.ts";

export const WhatsappConnectionStatus = Schema.Literals([
  "disabled",
  "pairing",
  "connecting",
  "connected",
  "reconnecting",
  "logged_out",
]);
export type WhatsappConnectionStatus =
  typeof WhatsappConnectionStatus.Type;

export class WhatsappClientError extends Schema.TaggedError<WhatsappClientError>()(
  "WhatsappClientError",
  { message: Schema.String, retryable: Schema.Boolean },
) {}

type MessageListener = (
  message: NormalizedWhatsappMessage,
) => void | Promise<void>;

export interface WhatsappQuote {
  readonly externalMessageId: string;
  readonly senderExternalId: string;
  readonly text: string;
}

export interface WhatsappFileDelivery {
  readonly kind: "image" | "document";
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly fileName: string;
}

export interface DownloadedWhatsappMedia {
  readonly bytes: Uint8Array;
  readonly mediaType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | (string & {});
  readonly checksum: string;
}

const silentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const DisconnectError = Schema.Struct({
  output: Schema.Struct({ statusCode: Schema.Number }),
});

const disconnectCode = (error: Error | undefined): number | undefined =>
  error !== undefined && Schema.is(DisconnectError)(error)
    ? error.output.statusCode
    : undefined;

const ownAliases = (
  credentials: Parameters<typeof makeWASocket>[0]["auth"]["creds"],
): ReadonlyArray<string> => {
  const me = credentials.me;
  return me === undefined
    ? []
    : [me.id, me.lid, me.phoneNumber].filter(
        (value): value is string => value !== undefined,
      );
};

export const whatsappApprovalContent = (
  approvalId: string,
  text: string,
) => {
  const button = (decision: "approved" | "rejected", label: string) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: label,
      id: `ronto:approval:${decision}:${approvalId}`,
    }),
  });
  return proto.Message.create({
    interactiveMessage: {
      body: { text },
      footer: { text: "Ronto approval" },
      nativeFlowMessage: {
        buttons: [
          button("approved", "Approve"),
          button("rejected", "Cancel"),
        ],
        messageParamsJson: JSON.stringify({
          from: "ronto",
          templateId: approvalId,
        }),
        messageVersion: 3,
      },
    },
  });
};

const whatsappApprovalNodes = (
  externalChannelId: string,
): ReadonlyArray<BinaryNode> => [{
  tag: "biz",
  attrs: {},
  content: [
    {
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{
        tag: "native_flow",
        attrs: { v: "9", name: "mixed" },
      }],
    },
    ...(isJidGroup(externalChannelId)
      ? []
      : [{ tag: "bot", attrs: { biz_bot: "1" } }]),
  ],
}];

export class WhatsappClient extends Context.Service<
  WhatsappClient,
  {
    readonly status: Effect.Effect<WhatsappConnectionStatus>;
    readonly requestPairingCode: (
      phoneNumber: string,
    ) => Effect.Effect<string, WhatsappClientError>;
    readonly sendText: (
      externalChannelId: string,
      text: string,
      quote?: WhatsappQuote,
    ) => Effect.Effect<string, WhatsappClientError>;
    readonly sendFile: (
      externalChannelId: string,
      file: WhatsappFileDelivery,
      quote?: WhatsappQuote,
    ) => Effect.Effect<string, WhatsappClientError>;
    readonly sendApproval: (
      externalChannelId: string,
      approvalId: string,
      text: string,
      quote?: WhatsappQuote,
    ) => Effect.Effect<string, WhatsappClientError>;
    readonly setTyping: (
      externalChannelId: string,
      typing: boolean,
    ) => Effect.Effect<void, WhatsappClientError>;
    readonly downloadMedia: (
      media: NormalizedWhatsappMedia,
    ) => Effect.Effect<DownloadedWhatsappMedia, WhatsappClientError>;
    readonly subscribe: (listener: MessageListener) => () => void;
  }
>()("ronto/whatsapp/WhatsappClient") {
  static readonly layer = Layer.effect(
    WhatsappClient,
    Effect.gen(function* () {
      const enabled = process.env.WHATSAPP_ENABLED !== "false";
      if (!enabled) {
        return WhatsappClient.of({
          status: Effect.succeed("disabled"),
          requestPairingCode: () =>
            Effect.fail(
              new WhatsappClientError({
                message: "WhatsApp is disabled",
                retryable: false,
              }),
            ),
          sendText: () =>
            Effect.fail(
              new WhatsappClientError({
                message: "WhatsApp is disabled",
                retryable: false,
              }),
            ),
          sendFile: () =>
            Effect.fail(
              new WhatsappClientError({
                message: "WhatsApp is disabled",
                retryable: false,
              }),
            ),
          sendApproval: () =>
            Effect.fail(
              new WhatsappClientError({
                message: "WhatsApp is disabled",
                retryable: false,
              }),
            ),
          setTyping: () => Effect.void,
          downloadMedia: () =>
            Effect.fail(
              new WhatsappClientError({
                message: "WhatsApp is disabled",
                retryable: false,
              }),
            ),
          subscribe: () => () => {},
        });
      }

      const auth = yield* WhatsappAuth;
      if (!auth.state.creds.registered && auth.state.creds.me !== undefined) {
        yield* Effect.promise(() => auth.reset());
      }
      const { version } = yield* Effect.promise(() =>
        fetchLatestWaWebVersion({ signal: AbortSignal.timeout(10_000) }),
      );
      yield* Effect.logInfo(
        `WhatsApp using Web revision ${version.join(".")}`,
      );
      const listeners = new Set<MessageListener>();
      const commandPrefix = process.env.WHATSAPP_COMMAND_PREFIX ?? "/ronto";
      let status: WhatsappConnectionStatus = auth.state.creds.registered
        ? "connecting"
        : "pairing";
      let socket: WASocket | undefined;
      let removeListeners: (() => void) | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let reconnectAttempt = 0;
      let generation = 0;
      let stopped = false;
      let qrReady = false;
      let registrationObserved = auth.state.creds.registered;

      const publish = async (message: WAMessage) => {
        const normalized = normalizeWhatsappMessage(message, {
          ownAliases: ownAliases(auth.state.creds),
          commandPrefix,
        });
        if (normalized === null) return;
        for (const listener of listeners) await listener(normalized);
      };

      const closeCurrent = async () => {
        removeListeners?.();
        removeListeners = undefined;
        const current = socket;
        socket = undefined;
        if (current !== undefined) await current.end(undefined);
      };

      const connect = async (): Promise<void> => {
        if (stopped) return;
        generation += 1;
        const currentGeneration = generation;
        qrReady = false;
        status = auth.state.creds.registered ? "connecting" : "pairing";
        const activeSocket = makeWASocket({
          version,
          auth: {
            creds: auth.state.creds,
            keys: makeCacheableSignalKeyStore(auth.state.keys, silentLogger),
          },
          logger: silentLogger,
          browser: Browsers.macOS("Chrome"),
          markOnlineOnConnect: true,
          syncFullHistory: false,
          shouldSyncHistoryMessage: () => false,
          connectTimeoutMs: 20_000,
          defaultQueryTimeoutMs: 60_000,
          keepAliveIntervalMs: 30_000,
          maxMsgRetryCount: 5,
          getMessage: async () => undefined,
        });
        socket = activeSocket;
        removeListeners = activeSocket.ev.process(async (events) => {
          if (currentGeneration !== generation || stopped) return;
          if (events["creds.update"] !== undefined) {
            await auth.saveCredentials();
            if (!registrationObserved && auth.state.creds.registered) {
              registrationObserved = true;
              Effect.runSync(
                Effect.logInfo("WhatsApp registration credentials persisted"),
              );
            }
          }
          const upsert = events["messages.upsert"];
          if (upsert?.type === "notify") {
            for (const message of upsert.messages) {
              await publish(message);
            }
          }
          const connection = events["connection.update"];
          if (connection === undefined) return;
          if (connection.isNewLogin === true) {
            Effect.runSync(Effect.logInfo("WhatsApp pairing succeeded"));
          }
          if (connection.qr !== undefined) {
            qrReady = true;
            status = "pairing";
          }
          if (connection.connection === "open") {
            reconnectAttempt = 0;
            qrReady = false;
            status = "connected";
            Effect.runSync(Effect.logInfo("WhatsApp connection opened"));
            return;
          }
          if (connection.connection !== "close") return;
          const code = disconnectCode(connection.lastDisconnect?.error);
          Effect.runSync(
            Effect.logWarning(
              `WhatsApp connection closed with code ${code ?? "unknown"}`,
            ),
          );
          const terminal =
            code === DisconnectReason.loggedOut ||
            code === DisconnectReason.connectionReplaced ||
            code === DisconnectReason.multideviceMismatch ||
            code === DisconnectReason.forbidden ||
            code === DisconnectReason.badSession;
          if (terminal) {
            status = "logged_out";
            return;
          }
          status = "reconnecting";
          reconnectAttempt += 1;
          const maximumDelay = Math.min(
            60_000,
            1_000 * 2 ** Math.min(reconnectAttempt, 6),
          );
          const delay =
            code === DisconnectReason.restartRequired
              ? 0
              : Math.floor(Math.random() * maximumDelay);
          if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void closeCurrent().then(connect);
          }, delay);
        });
      };

      yield* Effect.promise(connect);
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          stopped = true;
          generation += 1;
          if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
          await closeCurrent();
        }).pipe(Effect.orDie),
      );

      const send = (
        externalChannelId: string,
        content: AnyMessageContent,
        quote?: WhatsappQuote,
      ) =>
        Effect.tryPromise({
          try: async () => {
            if (status !== "connected" || socket === undefined) {
              throw new WhatsappClientError({
                message: "WhatsApp is not connected",
                retryable: true,
              });
            }
            const quoted: WAMessage | undefined = quote === undefined
              ? undefined
              : {
                  key: {
                    id: quote.externalMessageId,
                    remoteJid: externalChannelId,
                    participant: isJidGroup(externalChannelId)
                      ? quote.senderExternalId
                      : null,
                  },
                  message: { conversation: quote.text },
                };
            const sent = await socket.sendMessage(
              externalChannelId,
              content,
              quoted === undefined ? undefined : { quoted },
            );
            const messageId = sent?.key.id;
            if (messageId === null || messageId === undefined) {
              throw new WhatsappClientError({
                message: "WhatsApp did not acknowledge the message",
                retryable: true,
              });
            }
            return messageId;
          },
          catch: (cause) =>
            cause instanceof WhatsappClientError
              ? cause
              : new WhatsappClientError({
                  message: "Could not send the WhatsApp message",
                  retryable: true,
                }),
        });

      const sendApproval = (
        externalChannelId: string,
        approvalId: string,
        text: string,
        quote?: WhatsappQuote,
      ) =>
        Effect.tryPromise({
          try: async () => {
            if (status !== "connected" || socket === undefined) {
              throw new WhatsappClientError({
                message: "WhatsApp is not connected",
                retryable: true,
              });
            }
            const ownJid = auth.state.creds.me?.id;
            if (ownJid === undefined) {
              throw new WhatsappClientError({
                message: "WhatsApp identity is unavailable",
                retryable: true,
              });
            }
            const quoted: WAMessage | undefined = quote === undefined
              ? undefined
              : {
                  key: {
                    id: quote.externalMessageId,
                    remoteJid: externalChannelId,
                    participant: isJidGroup(externalChannelId)
                      ? quote.senderExternalId
                      : null,
                  },
                  message: { conversation: quote.text },
                };
            const generated = generateWAMessageFromContent(
              externalChannelId,
              whatsappApprovalContent(approvalId, text),
              quoted === undefined ? { userJid: ownJid } : { userJid: ownJid, quoted },
            );
            const messageId = generated.key.id;
            const generatedContent = generated.message;
            if (
              messageId === null ||
              messageId === undefined ||
              generatedContent === null ||
              generatedContent === undefined
            ) {
              throw new WhatsappClientError({
                message: "WhatsApp could not create the approval message",
                retryable: true,
              });
            }
            await socket.relayMessage(externalChannelId, generatedContent, {
              messageId,
              additionalNodes: [...whatsappApprovalNodes(externalChannelId)],
            });
            return messageId;
          },
          catch: (cause) =>
            cause instanceof WhatsappClientError
              ? cause
              : new WhatsappClientError({
                  message: "Could not send the WhatsApp approval",
                  retryable: true,
                }),
        });

      return WhatsappClient.of({
        status: Effect.sync(() => status),
        requestPairingCode: (phoneNumber) =>
          Effect.tryPromise({
            try: async () => {
              const digits = phoneNumber.replace(/\D/g, "");
              if (!/^\d{8,15}$/.test(digits)) {
                throw new WhatsappClientError({
                  message: "Enter the WhatsApp number with its country code",
                  retryable: false,
                });
              }
              if (status === "logged_out") {
                await closeCurrent();
                await auth.reset();
                await connect();
              }
              for (let attempt = 0; attempt < 40 && !qrReady; attempt += 1) {
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
              }
              if (socket === undefined || !qrReady) {
                throw new WhatsappClientError({
                  message: "WhatsApp pairing is not ready; try again shortly",
                  retryable: true,
                });
              }
              const pairingCode = await socket.requestPairingCode(digits);
              Effect.runSync(
                Effect.logInfo("WhatsApp accepted the pairing-code request"),
              );
              return pairingCode;
            },
            catch: (cause) => {
              if (cause instanceof WhatsappClientError) return cause;
              const code = Schema.is(DisconnectError)(cause)
                ? cause.output.statusCode
                : undefined;
              Effect.runSync(
                Effect.logWarning(
                  `WhatsApp pairing-code request failed with code ${code ?? "unknown"}`,
                ),
              );
              return new WhatsappClientError({
                message:
                  code === 400
                    ? "WhatsApp rejected the pairing request; wait before trying again"
                    : "Could not create a WhatsApp pairing code",
                retryable: true,
              });
            },
          }),
        sendText: (externalChannelId, text, quote) =>
          send(externalChannelId, { text }, quote),
        sendApproval,
        setTyping: (externalChannelId, typing) =>
          Effect.tryPromise({
            try: async () => {
              if (status !== "connected" || socket === undefined) {
                throw new WhatsappClientError({
                  message: "WhatsApp is not connected",
                  retryable: true,
                });
              }
              await socket.sendPresenceUpdate(
                typing ? "composing" : "paused",
                externalChannelId,
              );
            },
            catch: (cause) =>
              cause instanceof WhatsappClientError
                ? cause
                : new WhatsappClientError({
                    message: "Could not update WhatsApp typing presence",
                    retryable: true,
                  }),
          }),
        sendFile: (externalChannelId, file, quote) =>
          send(
            externalChannelId,
            file.kind === "image"
              ? {
                  image: Buffer.from(file.bytes),
                  mimetype: file.mediaType,
                }
              : {
                  document: Buffer.from(file.bytes),
                  mimetype: file.mediaType,
                  fileName: file.fileName,
                },
            quote,
          ),
        downloadMedia: (media) =>
          Effect.tryPromise({
            try: async () => {
              if (status !== "connected" || socket === undefined) {
                throw new WhatsappClientError({
                  message: "WhatsApp is not connected",
                  retryable: true,
                });
              }
              const stream = await downloadMediaMessage(
                media.sourceMessage,
                "stream",
                { options: { signal: AbortSignal.timeout(30_000) } },
                {
                  reuploadRequest: socket.updateMediaMessage,
                  logger: silentLogger,
                },
              );
              const chunks: Array<Buffer> = [];
              let byteSize = 0;
              for await (const chunk of stream) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                byteSize += bytes.byteLength;
                if (byteSize > media.declaredByteSize) {
                  stream.destroy();
                  throw new WhatsappClientError({
                    message: "WhatsApp media exceeded its declared size",
                    retryable: false,
                  });
                }
                chunks.push(bytes);
              }
              const bytes = Buffer.concat(chunks, byteSize);
              const digest = createHash("sha256").update(bytes).digest();
              const mediaType = media.kind === "image"
                ? whatsappImageMediaType(bytes)
                : whatsappDocumentMediaType(bytes, media.declaredMediaType);
              if (
                byteSize !== media.declaredByteSize ||
                !timingSafeEqual(digest, Buffer.from(media.declaredSha256)) ||
                mediaType !== media.declaredMediaType
              ) {
                throw new WhatsappClientError({
                  message: "WhatsApp media failed integrity validation",
                  retryable: false,
                });
              }
              return {
                bytes,
                mediaType,
                checksum: digest.toString("hex"),
              };
            },
            catch: (cause) =>
              cause instanceof WhatsappClientError
                ? cause
                : new WhatsappClientError({
                    message: "Could not download the WhatsApp media",
                    retryable: true,
                  }),
          }),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });
    }),
  );
}
