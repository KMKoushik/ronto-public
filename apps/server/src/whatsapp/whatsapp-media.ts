import { createHash } from "node:crypto";

const hasSignature = (
  bytes: Uint8Array,
  signature: ReadonlyArray<number>,
  offset = 0,
): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

export const whatsappImageMediaType = (bytes: Uint8Array): string | null => {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (
    hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
};

export const whatsappDocumentMediaType = (
  bytes: Uint8Array,
  declaredMediaType: string,
): string | null => {
  if (declaredMediaType === "application/pdf") {
    return hasSignature(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
      ? declaredMediaType
      : null;
  }
  if (declaredMediaType.startsWith("image/")) {
    return whatsappImageMediaType(bytes) === declaredMediaType
      ? declaredMediaType
      : null;
  }
  return declaredMediaType;
};

export const managedFileMatches = (
  bytes: Uint8Array,
  byteSize: number,
  checksum: string,
): boolean =>
  bytes.byteLength === byteSize &&
  createHash("sha256").update(bytes).digest("hex") === checksum;
