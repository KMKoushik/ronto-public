import { Schema } from "effect";
import { Parser } from "htmlparser2";

const maxOutputCharacters = 48_000;
const isObject = Schema.is(Schema.JsonObject);
const isString = Schema.is(Schema.String);

// OpenConnector's messageText may be HTML, while payload also contains the
// same body as base64 MIME. Render the text once; never send both to the model.
const emailText = (body: string): string => {
  if (!/<(?:html|body|div|p|br|table|span|blockquote)\b/i.test(body)) return body;
  let text = "";
  let skipped = 0;
  const links: Array<string> = [];
  const blocks = new Set(["br", "p", "div", "tr", "td", "th", "li", "blockquote", "h1", "h2", "h3"]);
  const parser = new Parser({
    onopentag(name, attributes) {
      if (skipped > 0 || name === "style" || name === "script" || name === "head") {
        skipped += 1;
      } else {
        if (blocks.has(name)) text += "\n";
        if (name === "a") links.push(attributes.href ?? "");
        if (name === "img" && attributes.alt) text += ` [${attributes.alt}] `;
      }
    },
    ontext(value) {
      if (skipped === 0) text += value;
    },
    onclosetag(name) {
      if (skipped > 0) skipped -= 1;
      else {
        if (blocks.has(name)) text += "\n";
        if (name === "a") {
          const href = links.pop();
          if (href) text += ` (${href})`;
        }
      }
    },
  }, { decodeEntities: true });
  parser.end(body);
  return text.replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
};

const plainBody = (value: Schema.Json): string | undefined => {
  if (!isObject(value)) return undefined;
  if (value.filename) return undefined;
  if (value.mimeType === "text/plain" && !value.filename && isObject(value.body) && isString(value.body.data)) {
    return Buffer.from(value.body.data, "base64url").toString("utf8");
  }
  if (Array.isArray(value.parts)) {
    for (const part of value.parts) {
      const text = plainBody(part);
      if (text !== undefined) return text;
    }
  }
  return undefined;
};

const gmailOutput = (value: Schema.Json): Schema.Json => {
  if (Array.isArray(value)) return value.map(gmailOutput);
  if (!isObject(value)) return value;
  if (isString(value.messageId) && isString(value.messageText)) {
    const text = value.payload === undefined ? undefined : plainBody(value.payload);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "payload" && key !== "raw")
      .map(([key, item]) => [key, key === "messageText" && isString(item) ? text ?? emailText(item) : item]));
  }
  if (isString(value.messageId) && isString(value.body)) {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, key === "body" && isString(item) ? emailText(item) : item]));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, gmailOutput(item)]));
};

export const normalizeConnectorOutput = (actionId: string, output: Schema.Json): Schema.Json =>
  actionId.startsWith("gmail.") ? gmailOutput(output) : output;

/** The gateway's wire-size limit is not a model context budget. */
export const formatConnectorOutput = (actionId: string, output: Schema.Json): string => {
  const normalized = normalizeConnectorOutput(actionId, output);
  const full = JSON.stringify(normalized, null, 2);
  if (full.length <= maxOutputCharacters) return full;

  // Keep every message's identifiers and metadata when narrowing a long thread;
  // cap each body fairly instead of letting quoted history consume the result.
  const messages = isObject(normalized) && Array.isArray(normalized.messages)
    ? normalized.messages
    : [];
  const bodyBudget = Math.min(8_000, Math.floor(24_000 / Math.max(1, messages.length)));
  const shorten = (value: Schema.Json): Schema.Json => {
    if (Array.isArray(value)) return value.map(shorten);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === "messageText" && isString(item) && item.length > bodyBudget
        ? `${item.slice(0, bodyBudget)}\n[Body truncated: ${item.length} characters total]`
        : shorten(item),
    ]));
  };
  const preview = JSON.stringify(shorten(normalized), null, 2);
  const notice = {
    truncated: true,
    originalCharacters: full.length,
    notice: "Partial tool result. Do not treat omitted content as absent. For Gmail, fetch specific message IDs individually or narrow the query and maxResults. Long individual bodies may include repeated quoted history and remain truncated.",
  };
  const prefix = `${JSON.stringify(notice)}\nResult preview (may end mid-JSON):\n`;
  return prefix + preview.slice(0, maxOutputCharacters - prefix.length);
};
