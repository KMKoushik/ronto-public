import {
  ConversationId,
  FamilyId,
  SendMessagePayload,
  TurnStreamEvent,
  Unauthorized,
  type TurnStreamEvent as TurnStreamEventType,
} from "@ronto/api";
import { Effect, Fiber, Layer, Schema } from "effect";
import {
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";

import { Auth } from "../auth/auth.ts";
import { RontoStore } from "../db/ronto-store.ts";
import { authenticatedUser } from "./authorization.ts";
import { FamilyAccess } from "./family-access.ts";
import { ConversationTurn } from "./conversation-turn.ts";
import {
  hasActiveTurn,
  initializeActiveTurn,
  publishActiveTurnEvent,
  registerActiveTurn,
  subscribeActiveTurn,
  unregisterActiveTurn,
} from "./active-turns.ts";
import {
  agentRunDto,
  ConversationTurnLive,
  messageDto,
} from "./ronto-api.ts";

const decodeConversationId = Schema.decodeUnknownEffect(ConversationId);
const decodeFamilyId = Schema.decodeUnknownEffect(FamilyId);
const decodePayload = Schema.decodeUnknownEffect(SendMessagePayload);
const encodeEvent = Schema.encodeSync(TurnStreamEvent);
const encoder = new TextEncoder();

const jsonError = (status: number, message: string) =>
  HttpServerResponse.jsonUnsafe({ message }, { status });

const streamResponse = (
  subscribe: (
    emit: (event: TurnStreamEventType) => void,
    close: () => void,
  ) => (() => void) | undefined,
) => {
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: TurnStreamEventType) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(encodeEvent(event))}\n`),
          );
        } catch {
          closed = true;
          unsubscribe?.();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The client already disconnected.
        }
      };
      unsubscribe = subscribe(emit, close);
      if (closed) unsubscribe?.();
      if (unsubscribe === undefined) close();
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });
  return HttpServerResponse.fromWeb(
    new Response(body, {
      status: 200,
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-accel-buffering": "no",
      },
    }),
  );
};

export const ConversationStreamRoutesNoDeps = HttpRouter.use((router) =>
  Effect.all([
    router.add(
      "POST",
      "/api/families/:familyId/conversations/:id/messages/stream",
      (request) =>
        Effect.gen(function* () {
        const user = yield* authenticatedUser(yield* Auth).pipe(
          Effect.catchTag("Unauthorized", (error: Unauthorized) =>
            Effect.succeed(null).pipe(
              Effect.annotateLogs({ authError: error.message }),
            ),
          ),
        );
        if (user === null) return jsonError(401, "Authentication required");

        const route = yield* HttpRouter.RouteContext;
        const familyId = yield* decodeFamilyId(route.params.familyId).pipe(
          Effect.option,
        );
        const conversationId = yield* decodeConversationId(
          route.params.id,
        ).pipe(Effect.option);
        const payload = yield* request.json.pipe(
          Effect.flatMap(decodePayload),
          Effect.option,
        );
        if (familyId._tag === "None")
          return jsonError(404, "Family not found");
        if (conversationId._tag === "None" || payload._tag === "None")
          return jsonError(400, "Invalid message request");
        const member = yield* (yield* FamilyAccess)
          .resolveMember(user.id, familyId.value)
          .pipe(Effect.option);
        if (member._tag === "None") return jsonError(404, "Family not found");

        const conversation = yield* (yield* RontoStore)
          .findConversation(conversationId.value, member.value.id)
          .pipe(Effect.orDie);
        if (conversation === null) return jsonError(404, "Conversation not found");

        const turn = yield* ConversationTurn;
        let fiber: Fiber.Fiber<unknown, unknown> | undefined;
        let started = false;
        let terminal = false;
        let emitOriginal: (event: TurnStreamEventType) => void = () => {};
        let closeOriginalStream: (() => void) | undefined;
        const response = streamResponse((emit, close) => {
          emitOriginal = emit;
          closeOriginalStream = close;
          return () => {};
        });
        const emit = (event: TurnStreamEventType) => {
          emitOriginal(event);
          publishActiveTurnEvent(conversationId.value, event);
        };

        fiber = yield* turn
          .run(member.value.id, conversationId.value, payload.value, {
            onStarted: (memberMessage, run) => {
              started = true;
              initializeActiveTurn(conversationId.value);
              if (fiber !== undefined) registerActiveTurn(conversationId.value, fiber);
              emit({
                type: "started",
                memberMessage: messageDto(memberMessage),
                run: agentRunDto(run),
              });
            },
            onStatus: (status) => emit({ type: "status", status }),
            onTitle: (title) => emit({ type: "title", title }),
            onText: (text) => emit({ type: "text", text }),
            onThinkingStart: () => emit({ type: "thinking-start" }),
            onThinkingDelta: (delta) =>
              emit({ type: "thinking-delta", delta }),
            onThinkingEnd: () => emit({ type: "thinking-end" }),
            onToolStart: (tool) => emit({
              type: "tool-start",
              ...tool,
            }),
            onToolEnd: (tool) => emit({
              type: "tool-end",
              toolCallId: tool.toolCallId,
              name: tool.name,
              argumentsJson: tool.argumentsJson,
              resultJson: tool.resultJson,
              isError: tool.isError,
            }),
            onCompleted: (agentMessage, run) => {
              terminal = true;
              emit({
                type: "completed",
                agentMessage: messageDto(agentMessage),
                run: agentRunDto(run),
              });
            },
          })
          .pipe(
            Effect.catchTags({
              AgentInvocationError: (error) =>
                Effect.sync(() => emit({ type: "failed", message: error.message })),
              ConversationTurnNotFound: (error) =>
                Effect.sync(() => emit({ type: "failed", message: error.message })),
            }),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                if (!terminal) emit({ type: "cancelled" });
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (fiber !== undefined) unregisterActiveTurn(conversationId.value, fiber);
                closeOriginalStream?.();
              }),
            ),
            Effect.forkDetach,
          );
        if (started) registerActiveTurn(conversationId.value, fiber);

          return response;
        }),
    ),
    router.add(
      "GET",
      "/api/families/:familyId/conversations/:id/active-run/stream",
      () =>
        Effect.gen(function* () {
        const user = yield* authenticatedUser(yield* Auth).pipe(
          Effect.catchTag("Unauthorized", () => Effect.succeed(null)),
        );
        if (user === null) return jsonError(401, "Authentication required");
        const route = yield* HttpRouter.RouteContext;
        const familyId = yield* decodeFamilyId(route.params.familyId).pipe(
          Effect.option,
        );
        const conversationId = yield* decodeConversationId(route.params.id).pipe(
          Effect.option,
        );
        if (familyId._tag === "None")
          return jsonError(404, "Family not found");
        if (conversationId._tag === "None")
          return jsonError(400, "Invalid conversation");
        const store = yield* RontoStore;
        const member = yield* (yield* FamilyAccess)
          .resolveMember(user.id, familyId.value)
          .pipe(Effect.option);
        if (member._tag === "None") return jsonError(404, "Family not found");
        const conversation = yield* store
          .findConversation(conversationId.value, member.value.id)
          .pipe(Effect.orDie);
        if (conversation === null)
          return jsonError(404, "Conversation not found");
        if (!hasActiveTurn(conversationId.value))
          return jsonError(404, "Active response stream not found");

          return streamResponse((emit, close) => {
            const subscription = subscribeActiveTurn(
              conversationId.value,
              (event) => {
                emit(event);
                if (
                  event.type === "completed" ||
                  event.type === "failed" ||
                  event.type === "cancelled"
                ) close();
              },
            );
            if (subscription === undefined) return undefined;
            for (const event of subscription.events) {
              emit(event);
              if (
                event.type === "completed" ||
                event.type === "failed" ||
                event.type === "cancelled"
              ) close();
            }
            return subscription.unsubscribe;
          });
        }),
    ),
  ], { discard: true }),
);

export const ConversationStreamRoutes = ConversationStreamRoutesNoDeps.pipe(
  HttpRouter.provideRequest(
    Layer.mergeAll(
      RontoStore.layer,
      FamilyAccess.layer.pipe(Layer.provide(RontoStore.layer)),
      ConversationTurnLive,
    ),
  ),
);
