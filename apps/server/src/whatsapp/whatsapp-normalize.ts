import {
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  normalizeMessageContent,
  type WAContextInfo,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Option, Schema } from "effect";

export type WhatsappTriggerKind =
  | "dm"
  | "mention"
  | "reply"
  | "command"
  | "context";

export interface NormalizedWhatsappMessage {
  readonly externalChannelId: string;
  readonly externalMessageId: string;
  readonly senderAliases: ReadonlyArray<string>;
  readonly senderExternalId: string;
  readonly senderName: string | null;
  readonly text: string;
  readonly media: NormalizedWhatsappMedia | null;
  readonly group: boolean;
  readonly responseMode: "required" | "optional";
  readonly triggerKind: WhatsappTriggerKind;
  readonly approvalDecision: WhatsappApprovalDecision | null;
  readonly quotedExternalMessageId: string | null;
}

export interface WhatsappApprovalDecision {
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
}

export interface NormalizedWhatsappMedia {
  readonly kind: "image" | "document";
  readonly declaredMediaType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | (string & {});
  readonly declaredByteSize: number;
  readonly declaredSha256: Uint8Array;
  readonly fileName: string;
  readonly sourceMessage: WAMessage;
}

export interface WhatsappNormalizationOptions {
  readonly ownAliases: ReadonlyArray<string>;
  readonly commandPrefix: string;
  readonly maximumTextLength?: number;
}

const normalizedJids = (
  values: ReadonlyArray<string | null | undefined>,
): ReadonlyArray<string> => {
  const result = new Set<string>();
  for (const value of values) {
    if (value === undefined || value === null || value.length === 0) continue;
    const normalized = jidNormalizedUser(value);
    if (normalized.length > 0) result.add(normalized);
  }
  return [...result];
};

const intersects = (
  left: ReadonlyArray<string>,
  right: ReadonlySet<string>,
): boolean => left.some((value) => right.has(value));

const isAcceptableText = (text: string, maximumLength: number): boolean =>
  text.length > 0 && text.length <= maximumLength;

const ApprovalButtonPayload = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String }),
);
const approvalButton = /^ronto:approval:(approved|rejected):([0-9a-f-]{36})$/;

const approvalDecision = (
  message: WAMessage,
): WhatsappApprovalDecision | null => {
  const content = normalizeMessageContent(message.message);
  const decoded = Option.getOrNull(
    Schema.decodeUnknownOption(ApprovalButtonPayload)(
      content?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
    ),
  );
  const id = decoded?.id ??
    content?.buttonsResponseMessage?.selectedButtonId ??
    content?.templateButtonReplyMessage?.selectedId;
  const match = id?.match(approvalButton);
  if (match === null || match === undefined) return null;
  const decision = match[1];
  const approvalId = match[2];
  if (
    approvalId === undefined ||
    decision !== "approved" && decision !== "rejected"
  ) return null;
  return { approvalId, decision };
};

const whatsappText = (message: WAMessage): string | null => {
  const content = normalizeMessageContent(message.message);
  return [
    message.message?.imageMessage?.caption,
    documentMessage(message)?.caption,
    content?.conversation,
    content?.extendedTextMessage?.text,
    content?.interactiveResponseMessage?.body?.text,
    content?.buttonsResponseMessage?.selectedDisplayText,
    content?.templateButtonReplyMessage?.selectedDisplayText,
  ].find((value) => value !== null && value !== undefined) ?? null;
};

const whatsappContext = (
  message: WAMessage,
): WAContextInfo | null | undefined => {
  const content = normalizeMessageContent(message.message);
  return message.message?.imageMessage?.contextInfo ??
    documentMessage(message)?.contextInfo ??
    content?.extendedTextMessage?.contextInfo ??
    content?.interactiveResponseMessage?.contextInfo ??
    content?.buttonsResponseMessage?.contextInfo ??
    content?.templateButtonReplyMessage?.contextInfo;
};

const maximumImageBytes = 5 * 1024 * 1024;
const maximumDocumentBytes = 25 * 1024 * 1024;

const printableName = (
  value: string | null | undefined,
  maximumLength: number,
): string | null => {
  const printable = [...(value ?? "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("");
  const name = printable
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
  return name.length === 0 ? null : name;
};

const documentMessage = (message: WAMessage) =>
  message.message?.documentMessage ??
  message.message?.documentWithCaptionMessage?.message?.documentMessage;

const documentMediaType = (value: string | null | undefined): string => {
  const mediaType = printableName(value, 127)
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return mediaType !== undefined &&
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)
    ? mediaType
    : "application/octet-stream";
};

const normalizedImage = (
  message: WAMessage,
): NormalizedWhatsappMedia | null => {
  const image = message.message?.imageMessage;
  if (image === null || image === undefined || image.viewOnce === true) return null;
  const mediaType = image.mimetype === "image/jpg"
    ? "image/jpeg"
    : image.mimetype;
  if (
    mediaType !== "image/jpeg" &&
    mediaType !== "image/png" &&
    mediaType !== "image/webp"
  ) {
    return null;
  }
  const byteSize = Number(image.fileLength);
  const checksum = image.fileSha256;
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > maximumImageBytes ||
    checksum === null ||
    checksum === undefined ||
    checksum.length !== 32
  ) {
    return null;
  }
  return {
    kind: "image",
    declaredMediaType: mediaType,
    declaredByteSize: byteSize,
    declaredSha256: Uint8Array.from(checksum),
    fileName: "image",
    sourceMessage: message,
  };
};

const normalizedDocument = (
  message: WAMessage,
): NormalizedWhatsappMedia | null => {
  const document = documentMessage(message);
  if (document === null || document === undefined) return null;
  const byteSize = Number(document.fileLength);
  const checksum = document.fileSha256;
  const declaredName = printableName(document.fileName, 200);
  const fileName = declaredName?.split(/[\\/]/).at(-1) || "document";
  const mediaType = documentMediaType(document.mimetype);
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > maximumDocumentBytes ||
    checksum === null ||
    checksum === undefined ||
    checksum.length !== 32
  ) {
    return null;
  }
  return {
    kind: "document",
    declaredMediaType: mediaType,
    declaredByteSize: byteSize,
    declaredSha256: Uint8Array.from(checksum),
    fileName,
    sourceMessage: message,
  };
};

const normalizedMedia = (
  message: WAMessage,
): NormalizedWhatsappMedia | null => {
  const image = message.message?.imageMessage;
  const document = documentMessage(message);
  if (image !== null && image !== undefined && document !== null && document !== undefined)
    return null;
  return image !== null && image !== undefined
    ? normalizedImage(message)
    : normalizedDocument(message);
};

const senderName = (value: string | null | undefined): string | null =>
  printableName(value, 80);

const normalizedBody = (
  message: WAMessage,
  maximumTextLength: number,
): {
  readonly text: string;
  readonly media: NormalizedWhatsappMedia | null;
  readonly context: WAContextInfo | null | undefined;
} | null => {
  const rawImage = message.message?.imageMessage;
  const rawDocument = documentMessage(message);
  const media = normalizedMedia(message);
  if (
    (rawImage !== undefined && rawImage !== null ||
      rawDocument !== undefined && rawDocument !== null) &&
    media === null
  ) {
    return null;
  }
  const text = whatsappText(message);
  if (text === null && media === null) return null;
  const normalizedText = text?.trim() ?? "";
  if (
    normalizedText.length > maximumTextLength ||
    (media === null && !isAcceptableText(normalizedText, maximumTextLength))
  ) {
    return null;
  }
  return {
    text: normalizedText,
    media,
    context: whatsappContext(message),
  };
};

const groupTrigger = (
  text: string,
  context: WAContextInfo | null | undefined,
  options: WhatsappNormalizationOptions,
): WhatsappTriggerKind => {
  const ownAliases = new Set(normalizedJids(options.ownAliases));
  const command = text
    .split(/\s+/, 1)[0]
    ?.toLocaleLowerCase("en-AU") ===
    options.commandPrefix.toLocaleLowerCase("en-AU");
  if (command) return "command";
  if (intersects(normalizedJids(context?.mentionedJid ?? []), ownAliases))
    return "mention";
  if (
    context?.stanzaId !== undefined &&
    intersects(normalizedJids([context.participant]), ownAliases)
  ) {
    return "reply";
  }
  return "context";
};

export const normalizeWhatsappMessage = (
  message: WAMessage,
  options: WhatsappNormalizationOptions,
): NormalizedWhatsappMessage | null => {
  const externalMessageId = message.key.id;
  const remoteJid = message.key.remoteJid;
  if (
    message.key.fromMe === true ||
    externalMessageId === null ||
    externalMessageId === undefined ||
    remoteJid === null ||
    remoteJid === undefined ||
    isJidStatusBroadcast(remoteJid) ||
    isJidNewsletter(remoteJid)
  ) {
    return null;
  }

  const body = normalizedBody(
    message,
    options.maximumTextLength ?? 16_000,
  );
  if (body === null) return null;

  const externalChannelId = jidNormalizedUser(remoteJid);
  const group = isJidGroup(externalChannelId) === true;
  const senderAliases = group
    ? normalizedJids([
        message.key.participant,
        message.key.participantAlt,
      ])
    : normalizedJids([remoteJid, message.key.remoteJidAlt]);
  const senderExternalId = senderAliases[0];
  if (senderExternalId === undefined) return null;

  if (!group) {
    return {
      externalChannelId,
      externalMessageId,
      senderAliases,
      senderExternalId,
      senderName: senderName(message.pushName),
      text: body.text,
      media: body.media,
      group,
      responseMode: "required",
      triggerKind: "dm",
      approvalDecision: approvalDecision(message),
      quotedExternalMessageId: body.context?.stanzaId ?? null,
    };
  }

  const triggerKind = groupTrigger(body.text, body.context, options);

  return {
    externalChannelId,
    externalMessageId,
    senderAliases,
    senderExternalId,
    senderName: senderName(message.pushName),
    text: body.text,
    media: body.media,
    group,
    responseMode: triggerKind === "context" ? "optional" : "required",
    triggerKind,
    approvalDecision: approvalDecision(message),
    quotedExternalMessageId: body.context?.stanzaId ?? null,
  };
};
