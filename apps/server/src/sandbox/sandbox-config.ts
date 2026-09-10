import { Schema } from "effect";
import { dirname, join, resolve } from "node:path";
import { databasePath } from "../db/database.ts";

export const SandboxIdentifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]+$/));
export const SandboxImage = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
export const familyStoragePath = () => resolve(process.env.FAMILY_STORAGE_PATH ?? join(dirname(databasePath), "families"));
export const sandboxLimits = {
  cpus: 2,
  memoryBytes: 8 * 1024 ** 3,
  pids: 512,
  commandSeconds: 30 * 60,
  storageKiB: 20 * 1024 ** 2,
  tmpBytes: 256 * 1024 ** 2,
  outputBytes: 4 * 1024 ** 2,
};
