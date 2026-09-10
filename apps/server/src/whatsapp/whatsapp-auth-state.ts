import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";
import { Context, Effect, Layer, Schema } from "effect";

import { WhatsappStore, type AuthUpdate } from "./whatsapp-store.ts";

const credentialsCategory = "credentials";
const credentialsKey = "primary";

type StoredAuthValue =
  | AuthenticationCreds
  | SignalDataTypeMap[keyof SignalDataTypeMap];

const encode = (value: StoredAuthValue): string =>
  JSON.stringify(value, BufferJSON.replacer);

const decode = (value: string): StoredAuthValue => {
  // SAFETY: this table is private Baileys state and every value is written by
  // encode above with BufferJSON's matching replacer.
  return JSON.parse(value, BufferJSON.reviver) as StoredAuthValue;
};

const decodeCredentials = (value: string): AuthenticationCreds | null => {
  const decoded = decode(value);
  if (!Schema.is(Schema.Struct({ registered: Schema.Boolean }))(decoded)) {
    return null;
  }
  // SAFETY: credential state is written as one complete AuthenticationCreds
  // value by saveCredentials; registered is checked before restoring it.
  return decoded as AuthenticationCreds;
};

const appStateSyncKey = (value: StoredAuthValue) => {
  // SAFETY: callers use this conversion only for the app-state-sync-key
  // category, whose Baileys contract is IAppStateSyncKeyData.
  return proto.Message.AppStateSyncKeyData.fromObject(
    value as Parameters<typeof proto.Message.AppStateSyncKeyData.fromObject>[0],
  );
};

export interface WhatsappAuthState {
  readonly state: AuthenticationState;
  readonly saveCredentials: () => Promise<void>;
  readonly reset: () => Promise<void>;
}

export class WhatsappAuth extends Context.Service<
  WhatsappAuth,
  WhatsappAuthState
>()("ronto/whatsapp/WhatsappAuth") {
  static readonly layer = Layer.effect(
    WhatsappAuth,
    Effect.gen(function* () {
      const store = yield* WhatsappStore;
      const savedCredentials = yield* store
        .loadAuth(credentialsCategory, credentialsKey)
        .pipe(Effect.orDie);
      const credentials =
        savedCredentials === null
          ? initAuthCreds()
          : decodeCredentials(savedCredentials);
      if (credentials === null) {
        return yield* Effect.die("Stored WhatsApp credentials are invalid");
      }

      const keys: SignalKeyStore = {
        get: async <T extends keyof SignalDataTypeMap>(
          category: T,
          ids: Array<string>,
        ): Promise<Record<string, SignalDataTypeMap[T]>> => {
          const entries = await Effect.runPromise(
            Effect.forEach(ids, (id) =>
              store
                .loadAuth(category, id)
                .pipe(Effect.map((value) => [id, value] as const), Effect.orDie),
            ),
          );
          const result: Record<string, SignalDataTypeMap[T]> = {};
          for (const [id, serialized] of entries) {
            if (serialized === null) continue;
            const decoded = decode(serialized);
            // SAFETY: Baileys supplies the category and generic T together,
            // and each value is stored under that same category by keys.set.
            result[id] = (category === "app-state-sync-key"
              ? appStateSyncKey(decoded)
              : decoded) as SignalDataTypeMap[T];
          }
          return result;
        },
        set: async (data) => {
          const updates: Array<AuthUpdate> = [];
          for (const [category, values] of Object.entries(data)) {
            if (values === undefined) continue;
            for (const [key, value] of Object.entries(values)) {
              updates.push({
                category,
                key,
                valueJson: value === null ? null : encode(value),
              });
            }
          }
          await Effect.runPromise(store.updateAuth(updates).pipe(Effect.orDie));
        },
        clear: async () => {
          await Effect.runPromise(store.clearAuth().pipe(Effect.orDie));
        },
      };

      return WhatsappAuth.of({
        state: { creds: credentials, keys },
        saveCredentials: async () => {
          await Effect.runPromise(
            store
              .saveAuth(credentialsCategory, credentialsKey, encode(credentials))
              .pipe(Effect.orDie),
          );
        },
        reset: async () => {
          await Effect.runPromise(store.clearAuth().pipe(Effect.orDie));
          Object.assign(credentials, initAuthCreds(), {
            me: undefined,
            account: undefined,
            signalIdentities: undefined,
            myAppStateKeyId: undefined,
            lastAccountSyncTimestamp: undefined,
            platform: undefined,
          });
        },
      });
    }),
  );
}
