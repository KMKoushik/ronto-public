import type { FileId, MessageContent } from "@ronto/api";

export type WhatsappDelivery =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly fileId: FileId }
  | {
      readonly kind: "approval";
      readonly approvalId: string;
      readonly text: string;
    };

const maximumPartLength = 3_500;

const simplifyMarkdown = (text: string): string =>
  text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/^>\s?/gm, "")
    .trim();

const splitLongLine = (line: string): ReadonlyArray<string> => {
  const parts: Array<string> = [];
  let remaining = line;
  while (remaining.length > maximumPartLength) {
    const candidate = remaining.slice(0, maximumPartLength + 1);
    const boundary = Math.max(
      candidate.lastIndexOf(" "),
      candidate.lastIndexOf("\n"),
    );
    const splitAt = boundary > maximumPartLength / 2
      ? boundary
      : maximumPartLength;
    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
};

export const renderWhatsappDeliveries = (
  content: MessageContent,
): ReadonlyArray<WhatsappDelivery> => {
  const text = simplifyMarkdown(
    content.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n"),
  );
  const parts: Array<string> = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/)) {
    const candidate = current.length === 0
      ? paragraph
      : `${current}\n\n${paragraph}`;
    if (candidate.length <= maximumPartLength) {
      current = candidate;
      continue;
    }
    if (current.length > 0) parts.push(current);
    const longParts = splitLongLine(paragraph);
    parts.push(...longParts.slice(0, -1));
    current = longParts.at(-1) ?? "";
  }
  if (current.length > 0) parts.push(current);
  return [
    ...parts.map((part): WhatsappDelivery => ({ kind: "text", text: part })),
    ...content.blocks.flatMap((block): ReadonlyArray<WhatsappDelivery> =>
      block.type === "file"
        ? [{ kind: "file", fileId: block.fileId }]
        : block.type === "approval"
          ? [{
              kind: "approval",
              approvalId: block.approvalId,
              text: `${block.title}\n${block.description}\n\nIf the buttons do not appear, reply to this message with approve or cancel.`,
            }]
          : []
    ),
  ];
};
