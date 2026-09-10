import type { ConversationId, TurnStreamEvent } from "@ronto/api";
import type { Fiber } from "effect";

type TurnListener = (event: TurnStreamEvent) => void;

interface ActiveTurn {
  fiber: Fiber.Fiber<unknown, unknown> | undefined;
  readonly events: Array<TurnStreamEvent>;
  readonly listeners: Set<TurnListener>;
}

const activeTurns = new Map<string, ActiveTurn>();

export const initializeActiveTurn = (conversationId: ConversationId): void => {
  activeTurns.set(conversationId, {
    fiber: undefined,
    events: [],
    listeners: new Set(),
  });
};

export const registerActiveTurn = (
  conversationId: ConversationId,
  fiber: Fiber.Fiber<unknown, unknown>,
): void => {
  const activeTurn = activeTurns.get(conversationId);
  if (activeTurn === undefined) {
    activeTurns.set(conversationId, {
      fiber,
      events: [],
      listeners: new Set(),
    });
    return;
  }
  activeTurn.fiber = fiber;
};

export const unregisterActiveTurn = (
  conversationId: ConversationId,
  fiber: Fiber.Fiber<unknown, unknown>,
): void => {
  if (activeTurns.get(conversationId)?.fiber === fiber)
    activeTurns.delete(conversationId);
};

export const publishActiveTurnEvent = (
  conversationId: ConversationId,
  event: TurnStreamEvent,
): void => {
  const activeTurn = activeTurns.get(conversationId);
  if (activeTurn === undefined) return;
  const previous = activeTurn.events.at(-1);
  if (event.type === "text" && previous?.type === "text")
    activeTurn.events[activeTurn.events.length - 1] = event;
  else activeTurn.events.push(event);
  for (const listener of activeTurn.listeners) listener(event);
};

export const subscribeActiveTurn = (
  conversationId: ConversationId,
  listener: TurnListener,
): { readonly events: ReadonlyArray<TurnStreamEvent>; readonly unsubscribe: () => void } | undefined => {
  const activeTurn = activeTurns.get(conversationId);
  if (activeTurn === undefined) return undefined;
  activeTurn.listeners.add(listener);
  return {
    events: [...activeTurn.events],
    unsubscribe: () => activeTurn.listeners.delete(listener),
  };
};

export const cancelActiveTurn = (
  conversationId: ConversationId,
): Fiber.Fiber<unknown, unknown> | undefined => {
  const fiber = activeTurns.get(conversationId)?.fiber;
  if (fiber === undefined) return undefined;
  fiber.interruptUnsafe();
  return fiber;
};

export const hasActiveTurn = (conversationId: ConversationId): boolean =>
  activeTurns.has(conversationId);
