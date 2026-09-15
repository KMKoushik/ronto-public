import {
  ChannelId,
  ConversationId,
  FamilyMemberId,
  FileId,
  type MessageInputContent,
} from "@ronto/api";
import { Cause, DateTime, Effect, Layer } from "effect";
import { createHash, randomUUID } from "node:crypto";

import { ChannelWorkspace } from "../agent/channel-workspace.ts";
import { ConversationTurn } from "../http/conversation-turn.ts";
import {
  WhatsappClient,
  WhatsappClientError,
  type WhatsappQuote,
} from "./whatsapp-client.ts";
import {
  managedFileMatches,
  whatsappImageMediaType,
} from "./whatsapp-media.ts";
import type { NormalizedWhatsappMessage } from "./whatsapp-normalize.ts";
import { renderWhatsappDeliveries } from "./whatsapp-render.ts";
import { ConnectorApprovals } from "../connectors/connector-approvals.ts";
import {
  WhatsappStore,
  type WhatsappInbox,
  type WhatsappOutbox,
} from "./whatsapp-store.ts";

const commandPrefix = process.env.WHATSAPP_COMMAND_PREFIX ?? "/ronto";
const claimToken = /^[A-Za-z0-9_-]{20,128}$/;
const externalMessageId = (inbox: WhatsappInbox): string =>
  `whatsapp:${inbox.externalChannelId}:${inbox.externalMessageId}`;
type StartConversationResult =
  | { readonly kind: "success"; readonly created: boolean }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "failed" };

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message.slice(0, 1_000) : String(cause).slice(0, 1_000);

const isNoSuchElement = (cause: unknown): boolean =>
  Cause.isNoSuchElementError(cause);

export const WhatsappAdapterLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const client = yield* WhatsappClient;
    const store = yield* WhatsappStore;
    const conversationTurn = yield* ConversationTurn;
    const channelWorkspace = yield* ChannelWorkspace;
    const connectorApprovals = yield* ConnectorApprovals;

    const withTyping = <A, E, R>(
      externalChannelId: string,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* client.setTyping(externalChannelId, true).pipe(Effect.ignore);
          yield* Effect.addFinalizer(() =>
            client.setTyping(externalChannelId, false).pipe(Effect.ignore),
          );
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.sleep("10 seconds").pipe(
                Effect.andThen(client.setTyping(externalChannelId, true)),
                Effect.ignore,
              ),
            ),
          );
          return yield* effect;
        }),
      );

    for (const receiving of yield* store.listReceivingMedia().pipe(Effect.orDie)) {
      let cleaned = true;
      if (receiving.channelId !== null && receiving.storagePath !== null) {
        cleaned = yield* channelWorkspace
          .deleteManaged(
            ChannelId.make(receiving.channelId),
            receiving.storagePath,
          )
          .pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Could not clean interrupted WhatsApp media",
              ).pipe(Effect.annotateLogs({ cause: String(cause) }), Effect.as(false))
            ),
          );
      }
      if (!cleaned) continue;
      yield* store
        .failReceivingMedia(
          receiving.receiptId,
          "WhatsApp media receipt interrupted by server restart",
          true,
        )
        .pipe(Effect.orDie);
    }
    yield* store.failInterrupted().pipe(Effect.orDie);
    yield* store.resetSendingOutbox().pipe(Effect.orDie);
    if ((yield* client.status) === "disabled") return;

    const consumeDmFamilyCommand = Effect.fn("WhatsappAdapter.consumeDmFamilyCommand")(function* (
      message: NormalizedWhatsappMessage,
      parts: ReadonlyArray<string>,
      kind: string | undefined,
    ) {
      if (kind === "families" && parts.length === 2) {
        if (message.group) {
          yield* client.sendText(message.externalChannelId, "Family switching is available only in a WhatsApp DM with Ronto.").pipe(Effect.ignore);
          return true;
        }
        const families = yield* store.listDmFamilies(message.senderAliases).pipe(
          Effect.orElseSucceed(() => []),
        );
        const text = families.length === 0
          ? "Link your WhatsApp identity from Ronto's web settings first."
          : ["Your Ronto families:", ...families.map((family) =>
              `${family.selected ? "•" : "○"} ${family.familyName} — ${family.code}`
            ), `Switch with ${commandPrefix} family <code>.`].join("\n");
        yield* client.sendText(message.externalChannelId, text).pipe(Effect.ignore);
        return true;
      }

      if (kind !== "family") return false;
      const token = parts[2];
      if (parts.length === 3 && token && /^[a-f0-9]{8}$/i.test(token)) {
        if (message.group) {
          yield* client.sendText(message.externalChannelId, "Family switching is available only in a WhatsApp DM with Ronto.").pipe(Effect.ignore);
          return true;
        }
        const selected = yield* store.selectDmFamilyByCode(
          message.senderAliases,
          token.toLowerCase(),
        ).pipe(Effect.option);
        const text = selected._tag === "Some"
          ? `Switched this WhatsApp DM to ${selected.value.familyName}. New messages go to your personal channel in that family.`
          : `That family code is unavailable. Use ${commandPrefix} families to list your families.`;
        yield* client.sendText(message.externalChannelId, text).pipe(Effect.ignore);
        return true;
      }
      yield* client.sendText(
        message.externalChannelId,
        `Use ${commandPrefix} family <code>. List codes with ${commandPrefix} families.`,
      ).pipe(Effect.ignore);
      return true;
    });

    const consumeCommand = Effect.fn("WhatsappAdapter.consumeCommand")(function* (
      message: NormalizedWhatsappMessage,
    ) {
      const parts = message.text.split(/\s+/);
      const prefix = parts[0]?.toLocaleLowerCase("en-AU");
      if (prefix !== commandPrefix.toLocaleLowerCase("en-AU")) return false;
      const kind = parts[1]?.toLocaleLowerCase("en-AU");
      const token = parts[2];
      if (yield* consumeDmFamilyCommand(message, parts, kind)) return true;

      if (kind === "new" && parts.length === 2) {
        const started = yield* store
          .startConversation(
            message.senderAliases,
            message.externalChannelId,
            message.externalMessageId,
            message.group,
          )
          .pipe(
            Effect.map(
              (created): StartConversationResult => ({
                kind: "success",
                created,
              }),
            ),
            Effect.catch((cause): Effect.Effect<StartConversationResult> =>
              isNoSuchElement(cause)
                ? Effect.succeed({ kind: "unauthorized" })
                : Effect.logWarning("WhatsApp new session failed").pipe(
                    Effect.as({ kind: "failed" }),
                  ),
            ),
          );
        if (started.kind === "success" && !started.created) return true;
        const acknowledgement =
          started.kind === "success"
            ? "Started a new Ronto session for this chat."
            : started.kind === "unauthorized"
              ? "Only a linked primary member can start a new session in a bound chat."
              : "Ronto could not start a new session. Try again shortly.";
        yield* client
          .sendText(message.externalChannelId, acknowledgement)
          .pipe(Effect.ignore);
        return true;
      }

      if (
        (kind !== "link" && kind !== "bind") ||
        parts.length !== 3 ||
        token === undefined ||
        !claimToken.test(token)
      ) {
        return false;
      }
      if (kind === "link" && message.group) return true;
      if (kind === "bind" && !message.group) {
        yield* client.sendText(message.externalChannelId, "Chat binding is for WhatsApp groups. Use the family command to switch a DM.").pipe(Effect.ignore);
        return true;
      }
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const claim = kind === "link"
        ? store.claimIdentity(tokenHash, message.senderAliases)
        : store.claimBinding(
            tokenHash,
            message.senderAliases,
            message.externalChannelId,
          );
      const claimed = yield* claim.pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          isNoSuchElement(cause)
            ? Effect.succeed(false)
            : Effect.logWarning("WhatsApp claim failed").pipe(
                Effect.as(false),
              ),
        ),
      );
      const acknowledgement = claimed
        ? kind === "link"
          ? "Your WhatsApp identity is linked to Ronto."
          : "This chat is now linked to the selected Ronto session."
        : "That Ronto code is invalid or expired.";
      yield* client
        .sendText(message.externalChannelId, acknowledgement)
        .pipe(Effect.ignore);
      return true;
    });

    const accept = Effect.fn("WhatsappAdapter.accept")(function* (
      message: NormalizedWhatsappMessage,
    ) {
      const fallbackDecision = /^(approve|cancel)$/i.exec(message.text.trim());
      const fallbackApprovalId = message.approvalDecision === null &&
          fallbackDecision !== null &&
          message.quotedExternalMessageId !== null
        ? yield* store.findApprovalIdForReply(
            message.externalChannelId,
            message.quotedExternalMessageId,
          ).pipe(Effect.orElseSucceed(() => null))
        : null;
      const approvalDecision = message.approvalDecision ??
        (fallbackApprovalId === null
          ? null
          : {
              approvalId: fallbackApprovalId,
              decision: fallbackDecision?.[1]?.toLowerCase() === "approve"
                ? "approved" as const
                : "rejected" as const,
            });
      if (approvalDecision !== null) {
        const memberId = yield* store
          .findLinkedMemberId(message.senderAliases, approvalDecision.approvalId)
          .pipe(Effect.orElseSucceed(() => null));
        if (memberId === null) return;
        const pending = yield* connectorApprovals
          .list(FamilyMemberId.make(memberId))
          .pipe(Effect.orElseSucceed(() => []));
        if (!pending.some(({ id, approvalStatus, toolStatus }) =>
          id === approvalDecision.approvalId &&
          approvalStatus === "pending" &&
          toolStatus === "waiting_for_approval"
        )) {
          yield* client.sendText(
            message.externalChannelId,
            "That approval is unavailable or has expired.",
          ).pipe(Effect.ignore);
          return;
        }
        const resolution = yield* connectorApprovals.resolve(
          FamilyMemberId.make(memberId),
          approvalDecision.approvalId,
          approvalDecision.decision,
        ).pipe(
          Effect.match({
            onFailure: () => null,
            onSuccess: (value) => value,
          }),
        );
        const reply = resolution === null
          ? "Ronto could not complete that approval."
          : resolution.outcome === "succeeded"
            ? "Done."
            : resolution.outcome === "rejected"
              ? "Cancelled."
              : resolution.outcome === "outcome_unknown"
                ? "The provider outcome is unknown. Ronto will not retry this action automatically."
                : resolution.outcome === "running"
                  ? "This action is already being processed."
                  : "The action failed.";
        if (resolution === null || resolution.outcome === "running") {
          yield* client.sendText(message.externalChannelId, reply).pipe(Effect.ignore);
        }
        return;
      }
      if (yield* consumeCommand(message)) return;
      if (message.group && message.triggerKind === "mention") {
        const groupName = yield* client
          .getGroupSubject(message.externalChannelId)
          .pipe(Effect.orElseSucceed(() => "WhatsApp group"));
        const created = yield* store
          .automaticallyBindGroup(
            message.senderAliases,
            message.externalChannelId,
            groupName,
          )
          .pipe(
            Effect.catch((cause) =>
              isNoSuchElement(cause)
                ? Effect.succeed(false)
                : Effect.logWarning("Automatic WhatsApp group binding failed").pipe(
                    Effect.as(false),
                  ),
            ),
          );
        if (created) {
          yield* client.sendText(
            message.externalChannelId,
            `Created the ${groupName} channel and linked this WhatsApp group.`,
          ).pipe(Effect.ignore);
        }
      }
      const input = {
        externalChannelId: message.externalChannelId,
        externalMessageId: message.externalMessageId,
        senderAliases: message.senderAliases,
        senderExternalId: message.senderExternalId,
        senderExternalName: message.senderName,
        group: message.group,
        text: message.text,
        responseMode: message.responseMode,
        triggerKind: message.triggerKind,
      } as const;
      const media = message.media;
      if (media !== null) {
        const reserved = yield* store.reserveMedia(input).pipe(
          Effect.catch((cause) =>
            isNoSuchElement(cause)
              ? Effect.succeed(null)
              : Effect.logWarning("WhatsApp media reservation failed").pipe(
                  Effect.as(null),
                )
          ),
        );
        if (reserved === null || !reserved.inserted) return;
        let managed:
          | {
              readonly fileId: string;
              readonly channelId: string;
              readonly storagePath: string;
            }
          | undefined;
        yield* Effect.gen(function* () {
          const downloaded = yield* client.downloadMedia(media).pipe(
            Effect.retry({
              times: 2,
              while: (error) => error.retryable,
            }),
          );
          const fileId = randomUUID();
          const name = media.kind === "document"
            ? media.fileName
            : `whatsapp-image-${fileId}.${
              downloaded.mediaType === "image/jpeg"
                ? "jpg"
                : downloaded.mediaType === "image/png"
                  ? "png"
                  : "webp"
            }`;
          managed = yield* store.createInboundFile({
            receiptId: reserved.receipt.id,
            fileId,
            name,
            mediaType: downloaded.mediaType,
            byteSize: downloaded.bytes.byteLength,
            checksum: downloaded.checksum,
          });
          yield* channelWorkspace.writeManaged(
            ChannelId.make(managed.channelId),
            managed.storagePath,
            downloaded.bytes,
          );
          yield* store.queueInboundMedia(
            reserved.receipt.id,
            media.kind === "image" ? "[Image]" : `[File: ${name}]`,
          );
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              const retryable = cause instanceof WhatsappClientError
                ? cause.retryable
                : true;
              const cleanup = managed === undefined
                ? Effect.void
                : channelWorkspace.deleteManaged(
                    ChannelId.make(managed.channelId),
                    managed.storagePath,
                  );
              yield* cleanup.pipe(
                Effect.andThen(
                  store.failReceivingMedia(
                    reserved.receipt.id,
                    failureMessage(cause),
                    retryable,
                  ),
                ),
                Effect.catchCause((cleanupCause) =>
                  Effect.logWarning(
                    "Could not clean failed WhatsApp media",
                  ).pipe(
                    Effect.annotateLogs({ cause: String(cleanupCause) }),
                  )
                ),
              );
              yield* Effect.logWarning("WhatsApp media receipt failed").pipe(
                Effect.annotateLogs({ retryable }),
              );
            }),
          ),
        );
        return;
      }
      yield* store
        .enqueue(input)
        .pipe(
          Effect.catch((cause) =>
            isNoSuchElement(cause)
              ? Effect.void
              : Effect.logWarning("WhatsApp inbound persistence failed"),
          ),
        );
    });

    const unsubscribe = client.subscribe((message) =>
      Effect.runPromise(
        accept(message).pipe(
          Effect.catchCause(() =>
            Effect.logWarning("WhatsApp inbound handling failed"),
          ),
        ),
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    const processInboxTurn = Effect.fn("WhatsappAdapter.processInbox")(function* (
      inbox: WhatsappInbox,
    ) {
      const content: MessageInputContent = inbox.inboundFileId === null
        ? {
            version: 1,
            blocks: [{ type: "text", text: inbox.text }],
          }
        : inbox.inboundCaption === null || inbox.inboundCaption.length === 0
          ? {
              version: 1,
              blocks: [
                { type: "file", fileId: FileId.make(inbox.inboundFileId) },
              ],
            }
          : {
              version: 1,
              blocks: [
                { type: "text", text: inbox.inboundCaption },
                { type: "file", fileId: FileId.make(inbox.inboundFileId) },
              ],
            };
      const outcome = yield* conversationTurn.runExternal(
        FamilyMemberId.make(inbox.authorityMemberId),
        ConversationId.make(inbox.conversationId),
        content,
        externalMessageId(inbox),
        inbox.responseMode,
        inbox.senderMemberId === null
          ? null
          : FamilyMemberId.make(inbox.senderMemberId),
        inbox.senderMemberId === null
          ? { id: inbox.senderExternalId, name: inbox.senderExternalName }
          : undefined,
        {
          onMemberPersisted: (message) =>
            store.markCanonical(inbox.id, message.id).pipe(Effect.orDie),
          onRunPersisted: (run) =>
            store.markRun(inbox.id, run.id).pipe(Effect.orDie),
        },
      ).pipe(Effect.catchTag("AgentInvocationError", (error) =>
        store.markFailed(inbox.id, error.message, error.toolsStarted ?? false).pipe(
          Effect.orDie,
          Effect.andThen(Effect.fail(error)),
        ),
      ));
      if (outcome.disposition === "silent") {
        if (inbox.responseMode === "required") {
          return yield* Effect.die("A required WhatsApp turn completed silently");
        }
        yield* store.markSilent(inbox.id).pipe(Effect.orDie);
        return;
      }
      if (outcome.disposition === "react") {
        if (inbox.responseMode === "required") {
          return yield* Effect.die("A required WhatsApp turn completed with a reaction");
        }
        yield* store.completeReacted({
          inboxId: inbox.id,
          externalChannelId: inbox.externalChannelId,
          emoji: outcome.emoji,
        }).pipe(Effect.orDie);
        return;
      }
      const deliveries = renderWhatsappDeliveries(
        outcome.agentMessage.contentJson,
      );
      if (deliveries.length === 0) {
        return yield* Effect.die("A WhatsApp response had no visible content");
      }
      yield* store
        .completeResponded({
          inboxId: inbox.id,
          assistantMessageId: outcome.agentMessage.id,
          externalChannelId: inbox.externalChannelId,
          deliveries,
        })
        .pipe(Effect.orDie);
    });

    const processInbox = (inbox: WhatsappInbox) =>
      withTyping(inbox.externalChannelId, processInboxTurn(inbox));

    const quoteFor = (outbox: {
      readonly partIndex: number;
      readonly sourceExternalMessageId: string;
      readonly sourceSenderExternalId: string;
      readonly sourceText: string;
    }): WhatsappQuote | undefined =>
      outbox.partIndex === 0
        ? {
            externalMessageId: outbox.sourceExternalMessageId,
            senderExternalId: outbox.sourceSenderExternalId,
            text: outbox.sourceText,
          }
        : undefined;

    const sendOutbox = Effect.fn("WhatsappAdapter.sendOutbox")(function* (
      outbox: WhatsappOutbox,
    ) {
      const quote = quoteFor(outbox);
      if (outbox.deliveryKind === "reaction") {
        return yield* client.sendReaction(
          outbox.externalChannelId,
          outbox.text,
          {
            externalMessageId: outbox.sourceExternalMessageId,
            senderExternalId: outbox.sourceSenderExternalId,
          },
        );
      }
      if (outbox.approvalId !== null) {
        return yield* client.sendApproval(
          outbox.externalChannelId,
          outbox.approvalId,
          outbox.text,
          quote,
        );
      }
      if (outbox.deliveryKind === "text") {
        return yield* client.sendText(
          outbox.externalChannelId,
          outbox.text,
          quote,
        );
      }
      if (
        outbox.fileChannelId === null ||
        outbox.fileStoragePath === null ||
        outbox.fileName === null ||
        outbox.fileMediaType === null ||
        outbox.fileByteSize === null ||
        outbox.fileChecksum === null
      ) {
        return yield* new WhatsappClientError({
          message: "The managed file is no longer available",
          retryable: false,
        });
      }
      const bytes = yield* channelWorkspace
        .readManaged(
          ChannelId.make(outbox.fileChannelId),
          outbox.fileStoragePath,
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new WhatsappClientError({
                message: "Could not read the managed file",
                retryable: error.kind === "io",
              }),
          ),
        );
      if (!managedFileMatches(
        bytes,
        outbox.fileByteSize,
        outbox.fileChecksum,
      )) {
        return yield* new WhatsappClientError({
          message: "The managed file failed integrity verification",
          retryable: false,
        });
      }
      const inlineMediaType = whatsappImageMediaType(bytes);
      return yield* client.sendFile(
        outbox.externalChannelId,
        {
          kind: inlineMediaType === null ? "document" : "image",
          bytes,
          mediaType: inlineMediaType ?? outbox.fileMediaType,
          fileName: outbox.fileName,
        },
        quote,
      );
    });

    const deliverOne = Effect.fn("WhatsappAdapter.deliverOne")(function* () {
      const outbox = yield* store.claimDueOutbox().pipe(Effect.orDie);
      if (outbox === null) return false;
      const sent = yield* sendOutbox(outbox).pipe(
          Effect.match({
            onFailure: (error) => ({ success: false as const, error }),
            onSuccess: (providerMessageId) => ({
              success: true as const,
              providerMessageId,
            }),
          }),
        );
      if (sent.success) {
        yield* store
          .markOutboxSent(outbox.id, sent.providerMessageId)
          .pipe(Effect.orDie);
        return true;
      }
      const error = sent.error.message;
      if (!sent.error.retryable) {
        yield* store.failOutbox(outbox.id, error).pipe(Effect.orDie);
        return true;
      }
      const now = yield* DateTime.now;
      const delaySeconds = Math.min(300, 2 ** outbox.attemptCount);
      yield* store
        .retryOutbox(
          outbox.id,
          error,
          DateTime.add(now, { seconds: delaySeconds }),
        )
        .pipe(Effect.orDie);
      return true;
    });

    const worker = Effect.gen(function* () {
      while (true) {
        const inbox = yield* store.claimNext().pipe(Effect.orDie);
        if (inbox !== null) {
          yield* processInbox(inbox).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("WhatsApp agent turn failed", failureMessage(cause)).pipe(
                Effect.andThen(
                  store.markFailed(inbox.id, failureMessage(cause)).pipe(Effect.orDie),
                ),
              ),
            ),
          );
          continue;
        }
        if (yield* deliverOne()) continue;
        yield* Effect.sleep(500);
      }
    });
    yield* Effect.forkScoped(worker);
  }),
);
