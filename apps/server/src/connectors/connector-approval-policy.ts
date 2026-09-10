import { Schema } from "effect";

const protectedActions = new Set([
  "gmail.send_email",
  "gmail.reply_email",
  "gmail.reply_to_thread",
  "gmail.send_draft",
  "gmail.delete_draft",
  "gmail.delete_label",
  "gmail.delete_filter",
  "gmail.move_to_trash",
  "gmail.move_thread_to_trash",
  "googlecalendar.delete_event",
]);

const printable = (value: Schema.Json | undefined): string | undefined =>
  Schema.is(Schema.String)(value) && value.trim().length > 0
    ? value.trim().replace(/\s+/g, " ").slice(0, 160)
    : undefined;

const field = (
  input: Schema.JsonObject,
  ...names: ReadonlyArray<string>
): string | undefined => {
  for (const name of names) {
    const value = printable(input[name]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const humanize = (actionId: string): string => {
  const name = actionId.split(".").at(-1) ?? actionId;
  return name.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
};

export interface ConnectorApprovalSummary {
  readonly title: string;
  readonly description: string;
}

export const requiresConnectorApproval = (actionId: string): boolean =>
  protectedActions.has(actionId);

export const connectorApprovalSummary = (
  actionId: string,
  input: Schema.JsonObject,
): ConnectorApprovalSummary => {
  if (
    actionId === "gmail.send_email" ||
    actionId === "gmail.reply_email" ||
    actionId === "gmail.reply_to_thread" ||
    actionId === "gmail.send_draft"
  ) {
    const recipient = field(input, "to", "recipientEmail");
    const subject = field(input, "subject");
    return {
      title: actionId === "gmail.send_email" ? "Send this email?" : "Send this reply?",
      description: [recipient === undefined ? undefined : `To: ${recipient}`, subject === undefined ? undefined : `Subject: ${subject}`]
        .filter((value): value is string => value !== undefined)
        .join("\n") || "This will send an email immediately.",
    };
  }
  const identifier = field(input, "eventId", "calendarId", "messageId", "threadId", "draftId", "labelId", "filterId", "ruleId");
  return {
    title: `${humanize(actionId)}?`,
    description: identifier === undefined
      ? "This delete action cannot be undone reliably."
      : `Item: ${identifier}`,
  };
};
