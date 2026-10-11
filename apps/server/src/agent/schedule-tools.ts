import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ChannelId, FamilyMemberId } from "@ronto/api";
import { Context, Cron, DateTime, Effect, Option, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";

import { RontoStore, type StoredSchedule } from "../db/ronto-store.ts";
import { WhatsappStore } from "../whatsapp/whatsapp-store.ts";
import { ianaTimezone } from "./chat-context-tools.ts";

type ServiceContract<Service> =
  Service extends Context.Service<infer _Self, infer Contract> ? Contract : never;
type Store = ServiceContract<typeof RontoStore>;
type Whatsapp = ServiceContract<typeof WhatsappStore>;

const minimumCronGapMinutes = 15;
const maximumLeadDays = 730;
const localDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const createParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120, description: "Short label shown when listing schedules, such as \"Bin night reminder\"." }),
  instruction: Type.String({ minLength: 1, maxLength: 2000, description: "What Ronto should do each time it runs, written so it makes sense on its own later, such as \"Remind everyone to put the green bin out tonight.\"" }),
  at: Type.Optional(Type.String({ description: "For a one-time schedule: local wall-clock time YYYY-MM-DDTHH:mm in the schedule timezone." })),
  cron: Type.Optional(Type.String({ description: "For a repeating schedule: five-field cron (minute hour day-of-month month day-of-week) in the schedule timezone, such as \"0 7 * * 1-5\" for weekdays at 07:00. Runs must be at least 15 minutes apart." })),
  timezone: Type.Optional(Type.String({ description: "IANA timezone such as Australia/Sydney. Omit to use the family timezone." })),
  onlyIfRelevant: Type.Optional(Type.Boolean({ description: "True when Ronto should post only if there is something worth saying, such as \"tell me if any urgent email arrived\". Defaults to false, which always posts." })),
});
const cancelParameters = Type.Object({
  scheduleId: Type.String({ minLength: 1, description: "Schedule ID from list_schedules or create_schedule." }),
});
const emptyParameters = Type.Object({});
const CreateInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  instruction: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  at: Schema.optional(Schema.String),
  cron: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  onlyIfRelevant: Schema.optional(Schema.Boolean),
});
const CancelInput = Schema.Struct({ scheduleId: Schema.String });

export const nextScheduledRun = (
  cron: string,
  timezone: string,
  after: DateTime.Utc,
): DateTime.Utc | null => {
  const parsed = Cron.parse(cron, timezone);
  if (Result.isFailure(parsed)) return null;
  try {
    return DateTime.makeUnsafe(Cron.next(parsed.success, DateTime.toDate(after)));
  } catch {
    // Cron.next throws when the expression can never match, such as 30 February.
    return null;
  }
};

export const formatScheduleTime = (at: DateTime.Utc, timezone: string): string =>
  Option.match(DateTime.zoneMakeNamed(timezone), {
    onNone: () => DateTime.formatIso(at),
    onSome: (zone) => DateTime.format(DateTime.setZone(at, zone), {
      dateStyle: "full",
      timeStyle: "short",
      locale: "en-US",
    }),
  });

const scheduleView = (schedule: StoredSchedule) => ({
  id: schedule.id,
  title: schedule.title,
  instruction: schedule.instruction,
  repeat: schedule.cron ?? "once",
  timezone: schedule.timezone,
  onlyIfRelevant: schedule.responseMode === "optional",
  status: schedule.status,
  nextRun: schedule.nextRunAt === null ? null : formatScheduleTime(schedule.nextRunAt, schedule.timezone),
  lastRun: schedule.lastRunAt === null ? null : formatScheduleTime(schedule.lastRunAt, schedule.timezone),
  lastError: schedule.lastError,
  createdBy: schedule.creatorName,
});

const resolveTimezone = (requested: string): string => {
  const zone = DateTime.zoneMakeNamed(requested);
  if (!ianaTimezone.test(requested) || Option.isNone(zone))
    throw new Error(`Unknown timezone ${JSON.stringify(requested)}; use an IANA name such as Australia/Sydney`);
  return DateTime.zoneToString(zone.value);
};

const firstCronRun = (expression: string, timezone: string, now: DateTime.Utc): DateTime.Utc => {
  const cron = expression.trim().split(/\s+/).join(" ");
  if (cron.split(" ").length !== 5)
    throw new Error("cron must have exactly five fields: minute hour day-of-month month day-of-week");
  const parsed = Cron.parse(cron, timezone);
  if (Result.isFailure(parsed)) throw new Error(`Invalid cron: ${parsed.failure.message}`);
  const runs: Array<number> = [];
  try {
    const sequence = Cron.sequence(parsed.success, DateTime.toDate(now));
    for (let index = 0; index < 50; index += 1) runs.push(sequence.next().value.getTime());
  } catch {
    // Cron.next throws when the expression can never match.
    throw new Error("This cron expression never runs");
  }
  for (let index = 1; index < runs.length; index += 1) {
    if ((runs[index] ?? 0) - (runs[index - 1] ?? 0) < minimumCronGapMinutes * 60_000)
      throw new Error(`Repeating schedules must run at least ${minimumCronGapMinutes} minutes apart`);
  }
  return DateTime.makeUnsafe(runs[0] ?? 0);
};

const oneTimeRun = (at: string, timezone: string, now: DateTime.Utc): DateTime.Utc => {
  const parts = localDateTime.exec(at.trim());
  if (parts === null) throw new Error("at must be local wall-clock time formatted YYYY-MM-DDTHH:mm");
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined ||
    minute === undefined || hour > 23 || minute > 59)
    throw new Error(`${at} is not a valid date and time`);
  const zoned = DateTime.makeZoned(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: timezone, adjustForTimeZone: true },
  );
  // Out-of-range days such as 30 February roll into the next month.
  if (Option.isNone(zoned) || DateTime.getPart(zoned.value, "day") !== day)
    throw new Error(`${at} is not a valid date and time`);
  const runAt = DateTime.toUtc(zoned.value);
  if (!DateTime.isGreaterThan(runAt, now))
    throw new Error(`${at} ${timezone} is not in the future; it is now ${formatScheduleTime(now, timezone)}`);
  if (DateTime.isGreaterThan(runAt, DateTime.add(now, { days: maximumLeadDays })))
    throw new Error(`One-time schedules must be within ${maximumLeadDays} days`);
  return runAt;
};

export const createScheduleTools = (
  store: Store,
  whatsapp: Whatsapp,
  channelId: ChannelId,
  memberId: FamilyMemberId,
): Array<AgentTool> => {
  const channelAccess = Effect.gen(function* () {
    const channel = yield* store.findChannel(channelId, memberId);
    if (channel === null) return yield* Effect.fail(new Error("Channel unavailable"));
    return channel;
  });
  const createTool: AgentTool<typeof createParameters> = {
    name: "create_schedule",
    label: "Create Schedule",
    description: "Schedule a reminder or task for this channel. When it is due, Ronto runs the instruction as a new turn in this channel and posts the result to the channel's WhatsApp chat: its linked group, or for a personal channel the member's WhatsApp DM. Provide exactly one of at (one time) or cron (repeating). Use only when a family member asks for something to happen later or repeatedly. Confirm the title, local time, and repeat pattern back to them.",
    parameters: createParameters,
    execute: async (_id, parameters, signal) => {
      const input = Schema.decodeUnknownSync(CreateInput)(parameters);
      if ((input.at === undefined) === (input.cron === undefined))
        throw new Error("Provide exactly one of at (one time) or cron (repeating)");
      const result = await Effect.runPromise(Effect.gen(function* () {
        const channel = yield* channelAccess;
        const familyTimezone = yield* store.findFamilyTimezone(channel.familyId);
        const requested = input.timezone ?? familyTimezone;
        if (requested === null)
          return yield* Effect.fail(new Error("The family timezone is not set. Ask where the family lives and save it with set_family_timezone, or pass timezone."));
        const timezone = resolveTimezone(requested);
        const now = yield* DateTime.now;
        const cron = input.cron === undefined ? null : input.cron.trim().split(/\s+/).join(" ");
        const nextRunAt = cron === null
          ? oneTimeRun(input.at ?? "", timezone, now)
          : firstCronRun(cron, timezone, now);
        const schedule = yield* store.createSchedule(channelId, memberId, {
          id: randomUUID(),
          title: input.title.trim(),
          instruction: input.instruction.trim(),
          cron,
          timezone,
          responseMode: input.onlyIfRelevant === true ? "optional" : "required",
          nextRunAt,
        }, now);
        const destination = yield* whatsapp.findScheduleDestination(channelId, memberId);
        return {
          schedule: scheduleView(schedule),
          delivery: destination.kind === "group"
            ? "Posts to this channel's linked WhatsApp group."
            : destination.kind === "dm"
              ? "Posts to the member's WhatsApp DM with Ronto."
              : "Warning: this channel has no WhatsApp chat yet (a linked group, or a WhatsApp DM with Ronto for a personal channel). Runs are skipped until one exists.",
        };
      }), { signal });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
  const listTool: AgentTool<typeof emptyParameters> = {
    name: "list_schedules",
    label: "List Schedules",
    description: "List this channel's active schedules and recently finished or cancelled ones, with local next-run times and the last skip reason, if any. Use when a family member asks what is scheduled or before changing or cancelling a schedule.",
    parameters: emptyParameters,
    execute: async (_id, _parameters, signal) => {
      const schedules = await Effect.runPromise(channelAccess.pipe(
        Effect.andThen(store.listSchedules(channelId, memberId)),
      ), { signal });
      const result = { count: schedules.length, schedules: schedules.map(scheduleView) };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
  const cancelTool: AgentTool<typeof cancelParameters> = {
    name: "cancel_schedule",
    label: "Cancel Schedule",
    description: "Cancel an active schedule in this channel so it never runs again. To change a schedule, cancel it and create a replacement.",
    parameters: cancelParameters,
    execute: async (_id, parameters, signal) => {
      const input = Schema.decodeUnknownSync(CancelInput)(parameters);
      const cancelled = await Effect.runPromise(Effect.gen(function* () {
        yield* channelAccess;
        return yield* store.cancelSchedule(channelId, memberId, input.scheduleId, yield* DateTime.now);
      }), { signal });
      if (cancelled === null) throw new Error("No active schedule with that ID in this channel");
      const result = { cancelled: scheduleView(cancelled) };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
  return [createTool, listTool, cancelTool];
};
