import type {
  ConversationId,
  FamilyMemberId,
  MessageInputContent,
  SendMessagePayload,
} from "@ronto/api";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";

import {
  AgentInvocationError,
  AgentService,
  type AgentResponseMode,
  type AgentTurnSource,
  type AgentGenerationObserver,
} from "../agent/agent-service.ts";
import { ChannelWorkspace } from "../agent/channel-workspace.ts";
import type { AgentRun, Message } from "../db/models.ts";
import { RontoStore } from "../db/ronto-store.ts";

interface TurnLock {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

const turnLocks = new Map<string, TurnLock>();

export class ConversationTurnNotFound extends Schema.TaggedError<ConversationTurnNotFound>()(
  "ConversationTurnNotFound",
  { message: Schema.String },
) {}

export interface ConversationTurnObserver extends AgentGenerationObserver {
  readonly onStarted?: (memberMessage: Message, run: AgentRun) => void;
  readonly onTitle?: (title: string) => void;
  readonly onCompleted?: (agentMessage: Message, run: AgentRun) => void;
}

export interface ConversationTurnResult {
  readonly memberMessage: Message;
  readonly agentMessage: Message;
  readonly run: AgentRun;
}

export type ConversationTurnOutcome =
  | ({ readonly disposition: "respond" } & ConversationTurnResult)
  | {
      readonly disposition: "silent";
      readonly memberMessage: Message;
      readonly run: AgentRun;
    };

export interface ExternalTurnHooks {
  readonly onMemberPersisted: (
    memberMessage: Message,
  ) => Effect.Effect<void>;
  readonly onRunPersisted: (run: AgentRun) => Effect.Effect<void>;
}

export interface ExternalSpeaker {
  readonly id: string;
  readonly name: string | null;
}

export class ConversationTurn extends Context.Service<
  ConversationTurn,
  {
    run(
      memberId: FamilyMemberId,
      conversationId: ConversationId,
      payload: SendMessagePayload,
      observer?: ConversationTurnObserver,
    ): Effect.Effect<
      ConversationTurnResult,
      ConversationTurnNotFound | AgentInvocationError
    >;
    runExternal(
      authorityMemberId: FamilyMemberId,
      conversationId: ConversationId,
      content: MessageInputContent,
      externalMessageId: string,
      responseMode: AgentResponseMode,
      connectorMemberId: FamilyMemberId | null,
      speaker: ExternalSpeaker | undefined,
      hooks: ExternalTurnHooks,
    ): Effect.Effect<
      ConversationTurnOutcome,
      ConversationTurnNotFound | AgentInvocationError
    >;
  }
>()("ronto/http/ConversationTurn") {
  static readonly layer = Layer.effect(
    ConversationTurn,
    Effect.gen(function* () {
      const store = yield* RontoStore;
      const agent = yield* AgentService;
      const channelWorkspace = yield* ChannelWorkspace;

      const cleanupRunFiles = Effect.fn("ConversationTurn.cleanupRunFiles")(
        function* (
          memberId: FamilyMemberId,
          conversationId: ConversationId,
          runId: AgentRun["id"],
        ) {
          const files = yield* store
            .listConversationFiles(conversationId, memberId)
            .pipe(Effect.orElseSucceed(() => []));
          for (const file of files) {
            if (
              file.originatingRunId !== runId ||
              file.originatingMessageId !== null
            )
              continue;
            yield* channelWorkspace
              .deleteManaged(file.channelId, file.storagePath)
              .pipe(
                Effect.andThen(store.deleteFile(file.id, memberId)),
                Effect.ignore,
              );
          }
        },
      );

      const runTurn = Effect.fn("ConversationTurn.runTurn")(function* (
        memberId: FamilyMemberId,
        conversationId: ConversationId,
        payload: SendMessagePayload,
        options: {
          readonly source: AgentTurnSource;
          readonly responseMode: AgentResponseMode;
          readonly externalMessageId: string | null;
          readonly connectorMemberId?: FamilyMemberId | null;
          readonly externalSpeaker?: ExternalSpeaker;
          readonly observer?: ConversationTurnObserver;
          readonly hooks?: ExternalTurnHooks;
        },
      ) {
        let turnLock = turnLocks.get(conversationId);
        if (turnLock === undefined) {
          turnLock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
          turnLocks.set(conversationId, turnLock);
        }
        turnLock.users += 1;

        return yield* turnLock.semaphore.withPermit(
          Effect.gen(function* () {
            const conversation = yield* store
              .findConversation(conversationId, memberId)
              .pipe(Effect.orDie);
            if (conversation === null) {
              return yield* new ConversationTurnNotFound({
                message: "Conversation not found",
              });
            }
            const channel = yield* store
              .findChannel(conversation.channelId, memberId)
              .pipe(Effect.orDie);
            if (channel === null) {
              return yield* Effect.die(
                "Conversation channel could not be read",
              );
            }
            for (const block of payload.content.blocks) {
              if (block.type !== "file") continue;
              const file = yield* store
                .findFile(block.fileId, memberId)
                .pipe(Effect.orDie);
              if (file === null || file.channelId !== channel.id) {
                return yield* new ConversationTurnNotFound({
                  message: "Attached file not found",
                });
              }
            }

            const memberMessage = yield* store
              .appendMemberMessage(
                conversationId,
                memberId,
                payload.content,
                options.externalMessageId,
                payload.replyToMessageId,
                options.externalSpeaker,
              )
              .pipe(Effect.orDie);
            if (options.hooks !== undefined) {
              yield* options.hooks.onMemberPersisted(memberMessage);
            }
            return yield* Effect.acquireUseRelease(
              store.createAgentRun(
                conversationId,
                memberMessage.id,
                agent.modelProvider,
                agent.modelId,
              ).pipe(Effect.orDie),
              (agentRun) =>
                Effect.gen(function* () {
                  if (options.hooks !== undefined) {
                    yield* options.hooks.onRunPersisted(agentRun);
                  }
                  try {
                    options.observer?.onStarted?.(memberMessage, agentRun);
                  } catch {
                    // Transport observers must not affect the canonical turn.
                  }
                  try {
                    options.observer?.onStatus?.("Thinking");
                  } catch {
                    // Transport observers must not affect the canonical turn.
                  }
                  const titleEffect = conversation.title === null
                    ? Effect.gen(function* () {
                        const generatedTitle = Option.getOrNull(
                          yield* agent
                            .generateTitle(memberMessage)
                            .pipe(Effect.option),
                        );
                        if (generatedTitle === null) return;
                        yield* store
                          .setConversationTitleIfEmpty(
                            conversationId,
                            generatedTitle,
                          )
                          .pipe(Effect.orDie);
                        try {
                          options.observer?.onTitle?.(generatedTitle);
                        } catch {
                          // Transport observers must not affect the canonical turn.
                        }
                      })
                    : Effect.void;
                  const responseEffect = Effect.gen(function* () {
                    const history = yield* store
                      .listMessages(conversationId)
                      .pipe(Effect.orDie);
                    const members = yield* store
                      .listFamilyMemberProfiles(memberId)
                      .pipe(Effect.orDie);
                    const files = yield* store
                      .listConversationFiles(conversationId, memberId)
                      .pipe(Effect.orDie);
                    let checkpoint = yield* store
                      .findContextCheckpoint(conversationId)
                      .pipe(Effect.orDie);
                    const checkpointDraft = yield* agent.compactIfNeeded(
                      conversationId,
                      members,
                      history,
                      checkpoint,
                    );
                    if (checkpointDraft !== null) {
                      checkpoint = yield* store
                        .saveContextCheckpoint(checkpointDraft)
                        .pipe(Effect.orDie);
                    }
                    const connectorOptions = options.source === "whatsapp"
                      ? { connectorMemberId: options.connectorMemberId ?? null }
                      : {};
                    const generationOptions = options.externalSpeaker === undefined
                      ? {
                          source: options.source,
                          responseMode: options.responseMode,
                          ...connectorOptions,
                        }
                      : {
                          source: options.source,
                          responseMode: options.responseMode,
                          ...connectorOptions,
                          speakingMemberName: options.externalSpeaker.name ??
                            options.externalSpeaker.id,
                        };
                    return yield* agent.generate(
                      memberId,
                      conversationId,
                      channel,
                      agentRun.id,
                      members,
                      files,
                      history,
                      checkpoint,
                      options.observer,
                      generationOptions,
                    );
                  });
                  const [, response] = yield* Effect.zip(
                    titleEffect,
                    responseEffect,
                    { concurrent: true },
                  );
                  return yield* Effect.gen(function* () {
                    if (
                      response.modelProvider !== agentRun.modelProvider ||
                      response.modelId !== agentRun.modelId
                    ) {
                      yield* store
                        .setAgentRunModel(
                          agentRun.id,
                          response.modelProvider,
                          response.modelId,
                        )
                        .pipe(Effect.orDie);
                    }
                    if (response.disposition === "silent") {
                      const completedRun = yield* store
                        .succeedAgentRun(agentRun.id)
                        .pipe(Effect.orDie);
                      yield* cleanupRunFiles(
                        memberId,
                        conversationId,
                        agentRun.id,
                      );
                      return {
                        disposition: "silent",
                        memberMessage,
                        run: completedRun,
                      } as const;
                    }
                    const agentMessage = yield* store
                      .appendAgentMessage(
                        conversationId,
                        memberId,
                        response.content,
                        memberMessage.id,
                      )
                      .pipe(Effect.orDie);
                    const completedRun = yield* store
                      .succeedAgentRun(agentRun.id)
                      .pipe(Effect.orDie);
                    try {
                      options.observer?.onCompleted?.(
                        agentMessage,
                        completedRun,
                      );
                    } catch {
                      // Transport observers must not affect canonical persistence.
                    }
                    return {
                      disposition: "respond",
                      memberMessage,
                      agentMessage,
                      run: completedRun,
                    } as const;
                  }).pipe(Effect.uninterruptible);
                }),
              (agentRun, exit) => {
                if (!Exit.isFailure(exit)) return Effect.void;
                const finishRun = Cause.hasInterruptsOnly(exit.cause)
                  ? store.cancelAgentRun(agentRun.id)
                  : store.failAgentRun(agentRun.id, String(exit.cause));
                return finishRun.pipe(
                  Effect.orDie,
                  Effect.andThen(
                    cleanupRunFiles(memberId, conversationId, agentRun.id),
                  ),
                  Effect.asVoid,
                );
              },
            );
          }),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              turnLock.users -= 1;
              if (turnLock.users === 0 && turnLocks.get(conversationId) === turnLock)
                turnLocks.delete(conversationId);
            }),
          ),
        );
      });

      const run = Effect.fn("ConversationTurn.run")(function* (
        memberId: FamilyMemberId,
        conversationId: ConversationId,
        payload: SendMessagePayload,
        observer?: ConversationTurnObserver,
      ) {
        const options = observer === undefined
          ? {
              source: "web" as const,
              responseMode: "required" as const,
              externalMessageId: null,
            }
          : {
              source: "web" as const,
              responseMode: "required" as const,
              externalMessageId: null,
              observer,
            };
        const outcome = yield* runTurn(
          memberId,
          conversationId,
          payload,
          options,
        );
        if (outcome.disposition === "silent") {
          return yield* Effect.die("A required web turn completed silently");
        }
        return {
          memberMessage: outcome.memberMessage,
          agentMessage: outcome.agentMessage,
          run: outcome.run,
        };
      });

      const runExternal = Effect.fn("ConversationTurn.runExternal")(
        function* (
          authorityMemberId: FamilyMemberId,
          conversationId: ConversationId,
          content: MessageInputContent,
          externalMessageId: string,
          responseMode: AgentResponseMode,
          connectorMemberId: FamilyMemberId | null,
          speaker: ExternalSpeaker | undefined,
          hooks: ExternalTurnHooks,
        ) {
          const options = speaker === undefined
            ? {
                source: "whatsapp" as const,
                responseMode,
                externalMessageId,
                connectorMemberId,
                hooks,
              }
            : {
                source: "whatsapp" as const,
                responseMode,
                externalMessageId,
                connectorMemberId,
                externalSpeaker: speaker,
                hooks,
              };
          return yield* runTurn(
            authorityMemberId,
            conversationId,
            {
              content,
              replyToMessageId: null,
            },
            options,
          );
        },
      );

      return ConversationTurn.of({ run, runExternal });
    }),
  );
}
