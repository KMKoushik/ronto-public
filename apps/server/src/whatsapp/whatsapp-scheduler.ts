import { DateTime, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { formatScheduleTime, nextScheduledRun } from "../agent/schedule-tools.ts";
import { RontoStore, type StoredSchedule } from "../db/ronto-store.ts";
import { WhatsappClient } from "./whatsapp-client.ts";
import { WhatsappStore } from "./whatsapp-store.ts";

const lateGraceMillis = 60 * 60_000;

const scheduledText = (schedule: StoredSchedule, slot: DateTime.Utc): string => [
  `Scheduled task "${schedule.title}" is due now (${
    schedule.cron === null ? "one-time" : `repeats on cron ${schedule.cron}`
  }, set by ${schedule.creatorName}, due ${formatScheduleTime(slot, schedule.timezone)} ${schedule.timezone}).`,
  `Instruction: ${schedule.instruction}`,
  schedule.responseMode === "optional"
    ? "Carry out the instruction now. Post only if there is something worth sharing."
    : "Carry out the instruction now and write the message to post in this chat.",
].join("\n");

export const WhatsappSchedulerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const client = yield* WhatsappClient;
    if ((yield* client.status) === "disabled") return;
    const sql = yield* SqlClient.SqlClient;
    const store = yield* RontoStore;
    const whatsapp = yield* WhatsappStore;

    const fireNext = Effect.fn("WhatsappScheduler.fireNext")(function* () {
      const now = yield* DateTime.now;
      const schedule = yield* store.findDueSchedule(now);
      if (schedule === null || schedule.nextRunAt === null) return false;
      const slot = schedule.nextRunAt;
      const nextRunAt = schedule.cron === null
        ? null
        : nextScheduledRun(schedule.cron, schedule.timezone, now);
      const settle = (fired: boolean, error: string | null, cancel: boolean) =>
        store.advanceSchedule({
          scheduleId: schedule.id,
          expectedRunAt: slot,
          nextRunAt: cancel ? null : nextRunAt,
          status: cancel ? "cancelled" : nextRunAt === null ? "completed" : "active",
          fired,
          error,
          at: now,
        });
      const due = `${formatScheduleTime(slot, schedule.timezone)} ${schedule.timezone}`;
      if (DateTime.toEpochMillis(now) - DateTime.toEpochMillis(slot) > lateGraceMillis) {
        yield* settle(false, `Skipped the run due ${due} because Ronto was unavailable`, false);
        return true;
      }
      yield* sql.withTransaction(Effect.gen(function* () {
        const destination = yield* whatsapp.findScheduleDestination(
          schedule.channelId,
          schedule.createdByMemberId,
        );
        if (destination.kind === "unauthorized") {
          yield* settle(false, `Cancelled because ${schedule.creatorName} no longer has access to this channel`, true);
          return;
        }
        if (destination.kind === "none") {
          yield* settle(false, `Skipped the run due ${due} because this channel has no WhatsApp chat`, false);
          return;
        }
        // Advancing first means a concurrent cancellation leaves nothing queued.
        if (!(yield* settle(true, null, false))) return;
        yield* whatsapp.enqueueScheduled({
          scheduleId: schedule.id,
          slot,
          creatorMemberId: schedule.createdByMemberId,
          destination,
          text: scheduledText(schedule, slot),
          responseMode: schedule.responseMode,
          at: now,
        });
      })).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Could not queue scheduled task", cause).pipe(
            Effect.andThen(settle(false, `Could not queue the run due ${due}`, false)),
          )
        ),
      );
      return true;
    });

    const worker = Effect.gen(function* () {
      while (true) {
        if (yield* fireNext().pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Schedule worker failed", cause).pipe(Effect.as(false))
          ),
        )) continue;
        yield* Effect.sleep("5 seconds");
      }
    });
    yield* Effect.forkScoped(worker);
  }),
);
