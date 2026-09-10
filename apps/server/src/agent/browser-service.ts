import { AgentRunId } from "@ronto/api";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const maxProcessOutputBytes = 128 * 1024;
const maxPageOutputCharacters = 50_000;
const maxScreenshotBytes = 25 * 1024 * 1024;
const maxBrowserArtifactBytes = 25 * 1024 * 1024;
const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const commandTimeoutMs = 120_000;
const launcherPath = fileURLToPath(
  import.meta.resolve("agent-browser/bin/agent-browser.js"),
);
const configPath = fileURLToPath(
  new URL("../../agent-browser.json", import.meta.url),
);
const RuntimeReport = Schema.Struct({
  header: Schema.Struct({
    glibcVersionRuntime: Schema.optionalKey(Schema.String),
  }),
});
const runtimeReport = Schema.decodeUnknownOption(RuntimeReport)(
  process.report.getReport(),
);

const browserExecutable = (): string => {
  const platform =
    process.platform === "linux" &&
    (Option.isNone(runtimeReport) ||
      runtimeReport.value.header.glibcVersionRuntime === undefined)
      ? "linux-musl"
      : process.platform;
  const architecture =
    process.platform === "win32" && process.arch === "arm64"
      ? "x64"
      : process.arch;
  const extension = process.platform === "win32" ? ".exe" : "";
  const path = join(
    dirname(launcherPath),
    `agent-browser-${platform}-${architecture}${extension}`,
  );
  if (!existsSync(path))
    throw new Error(
      `agent-browser does not support ${process.platform}-${process.arch}`,
    );
  return path;
};

const executablePath = browserExecutable();

const BrowserCliResponse = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.NullOr(Schema.String)),
  code: Schema.optionalKey(Schema.String),
  warning: Schema.optionalKey(Schema.String),
  _boundary: Schema.optionalKey(
    Schema.Struct({ nonce: Schema.String, origin: Schema.String }),
  ),
});
const decodeBrowserCliResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(BrowserCliResponse),
);
const OpenData = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
});
const SnapshotData = Schema.Struct({
  snapshot: Schema.String,
  origin: Schema.optionalKey(Schema.String),
});
const UrlData = Schema.Struct({ url: Schema.String });
const TextData = Schema.Struct({ text: Schema.String });
const TitleData = Schema.Struct({ title: Schema.String });
const ReadData = Schema.Struct({ content: Schema.String });
const EvalData = Schema.Struct({ result: Schema.Unknown });
const TabData = Schema.Struct({
  tabId: Schema.optionalKey(Schema.String),
  targetId: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.NullOr(Schema.String)),
  title: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});
const TabsData = Schema.Struct({ tabs: Schema.Array(TabData) });

export class BrowserError extends Schema.TaggedError<BrowserError>()(
  "BrowserError",
  {
    message: Schema.String,
    kind: Schema.Literals(["command", "invalid", "protocol", "unavailable"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export interface BrowserProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type BrowserProcessRunner = (
  args: ReadonlyArray<string>,
  signal: AbortSignal,
) => Promise<BrowserProcessResult>;

export interface BrowserPage {
  readonly title: string;
  readonly url: string;
  readonly warning?: string;
}

export interface BrowserSnapshot {
  readonly snapshot: string;
  readonly origin: string | null;
  readonly warning?: string;
}

export interface BrowserRead {
  readonly content: string;
  readonly warning?: string;
}

export interface BrowserTab {
  readonly tabId?: string;
  readonly targetId?: string;
  readonly label?: string | null;
  readonly title?: string;
  readonly type?: string;
  readonly url?: string;
}

export interface BrowserScreenshot {
  readonly content: Uint8Array;
  readonly mediaType: "image/png";
  readonly name: string;
}

export interface BrowserArtifact {
  readonly content: Uint8Array;
  readonly mediaType: "application/octet-stream" | "application/pdf";
  readonly name: string;
}

export type BrowserInteraction =
  | {
      readonly type: "click";
      readonly selector: string;
      readonly newTab: boolean;
    }
  | { readonly type: "doubleClick"; readonly selector: string }
  | { readonly type: "focus"; readonly selector: string }
  | {
      readonly type: "drag";
      readonly source: string;
      readonly target: string;
    }
  | { readonly type: "scrollIntoView"; readonly selector: string }
  | { readonly type: "fill"; readonly selector: string; readonly text: string }
  | { readonly type: "type"; readonly selector: string; readonly text: string }
  | { readonly type: "press"; readonly key: string }
  | {
      readonly type: "select";
      readonly selector: string;
      readonly values: ReadonlyArray<string>;
    }
  | { readonly type: "check"; readonly selector: string }
  | { readonly type: "hover"; readonly selector: string }
  | { readonly type: "uncheck"; readonly selector: string }
  | {
      readonly type: "scroll";
      readonly direction: "up" | "down" | "left" | "right";
      readonly amount?: number;
      readonly selector?: string;
    }
  | {
      readonly type: "waitForSelector";
      readonly selector: string;
      readonly state: "visible" | "hidden";
      readonly timeoutMs?: number;
    }
  | { readonly type: "waitMs"; readonly ms: number }
  | {
      readonly type: "waitForText";
      readonly text: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "waitForLoad";
      readonly state: "load" | "domcontentloaded" | "networkidle";
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "waitForUrl";
      readonly pattern: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "waitForFunction";
      readonly expression: string;
      readonly timeoutMs?: number;
    }
  | { readonly type: "dialogAccept"; readonly text?: string }
  | { readonly type: "dialogDismiss" }
  | { readonly type: "back" | "forward" | "reload" };

export interface BrowserInteractionResult {
  readonly warning?: string;
}

export interface BrowserServiceContract {
  open(
    runId: AgentRunId,
    url: string,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserPage, BrowserError>;
  read(
    runId: AgentRunId,
    options: {
      readonly url?: string;
      readonly raw?: boolean;
      readonly requireMd?: boolean;
      readonly outline?: boolean;
      readonly llms?: "index" | "full";
      readonly filter?: string;
      readonly readTimeoutMs?: number;
    },
    signal?: AbortSignal,
  ): Effect.Effect<BrowserRead, BrowserError>;
  snapshot(
    runId: AgentRunId,
    options: {
      readonly interactive: boolean;
      readonly compact: boolean;
      readonly includeUrls: boolean;
      readonly depth?: number;
      readonly selector?: string;
    },
    signal?: AbortSignal,
  ): Effect.Effect<BrowserSnapshot, BrowserError>;
  getUrl(
    runId: AgentRunId,
    signal?: AbortSignal,
  ): Effect.Effect<string, BrowserError>;
  getText(
    runId: AgentRunId,
    selector: string,
    signal?: AbortSignal,
  ): Effect.Effect<string, BrowserError>;
  getTitle(
    runId: AgentRunId,
    signal?: AbortSignal,
  ): Effect.Effect<string, BrowserError>;
  eval(
    runId: AgentRunId,
    script: string,
    signal?: AbortSignal,
  ): Effect.Effect<string, BrowserError>;
  tabNew(
    runId: AgentRunId,
    options: { readonly url?: string; readonly label?: string },
    signal?: AbortSignal,
  ): Effect.Effect<BrowserTab, BrowserError>;
  tabList(
    runId: AgentRunId,
    signal?: AbortSignal,
  ): Effect.Effect<ReadonlyArray<BrowserTab>, BrowserError>;
  tabSwitch(
    runId: AgentRunId,
    tab: string,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserTab, BrowserError>;
  tabClose(
    runId: AgentRunId,
    tab?: string,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserTab, BrowserError>;
  screenshot(
    runId: AgentRunId,
    options: {
      readonly fullPage?: boolean;
      readonly selector?: string;
      readonly annotate?: boolean;
    },
    signal?: AbortSignal,
  ): Effect.Effect<BrowserScreenshot, BrowserError>;
  upload(
    runId: AgentRunId,
    selector: string,
    paths: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserInteractionResult, BrowserError>;
  download(
    runId: AgentRunId,
    selector: string,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserArtifact, BrowserError>;
  pdf(
    runId: AgentRunId,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserArtifact, BrowserError>;
  interact(
    runId: AgentRunId,
    interaction: BrowserInteraction,
    signal?: AbortSignal,
  ): Effect.Effect<BrowserInteractionResult, BrowserError>;
  close(runId: AgentRunId): Effect.Effect<void>;
  shutdown(): Effect.Effect<void>;
}

interface BrowserSessionState {
  closing: boolean;
  readonly directory: string;
  readonly lock: Semaphore.Semaphore;
  readonly name: string;
}

const browserError = (
  message: string,
  kind: BrowserError["kind"],
  cause?: unknown,
) =>
  cause === undefined
    ? new BrowserError({ message, kind })
    : new BrowserError({ message, kind, cause });

const isPng = (content: Uint8Array): boolean => {
  if (
    content.byteLength < 33 ||
    !pngSignature.every((byte, index) => content[index] === byte)
  ) {
    return false;
  }
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength,
  );
  let offset = pngSignature.byteLength;
  let firstChunk = true;
  while (offset + 12 <= content.byteLength) {
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > content.byteLength) return false;
    const isHeader =
      content[offset + 4] === 73 &&
      content[offset + 5] === 72 &&
      content[offset + 6] === 68 &&
      content[offset + 7] === 82;
    if (
      firstChunk &&
      (!isHeader ||
        length !== 13 ||
        view.getUint32(offset + 8) === 0 ||
        view.getUint32(offset + 12) === 0)
    ) {
      return false;
    }
    const isEnd =
      content[offset + 4] === 73 &&
      content[offset + 5] === 69 &&
      content[offset + 6] === 78 &&
      content[offset + 7] === 68;
    if (isEnd) return length === 0 && chunkEnd === content.byteLength;
    firstChunk = false;
    offset = chunkEnd;
  }
  return false;
};

const isPdf = (content: Uint8Array): boolean =>
  content.byteLength >= 5 &&
  content[0] === 37 &&
  content[1] === 80 &&
  content[2] === 68 &&
  content[3] === 70 &&
  content[4] === 45;

const processEnvironment = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("AGENT_BROWSER_"),
    ),
  );
  const executablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (executablePath) env.AGENT_BROWSER_EXECUTABLE_PATH = executablePath;
  env.NO_COLOR = "1";
  return env;
};

const defaultProcessRunner: BrowserProcessRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      env: processEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];
    let outputBytes = 0;
    let settled = false;

    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    };
    const append = (target: Array<Buffer>, chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxProcessOutputBytes) {
        child.kill("SIGTERM");
        fail(new Error("agent-browser output exceeded 128 KiB"));
        return;
      }
      target.push(chunk);
    };
    const abort = () => {
      child.kill("SIGTERM");
      fail(signal.reason ?? new Error("agent-browser command aborted"));
    };

    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.once("error", fail);
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });

const validHttpUrl = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw browserError("Browser URL is invalid", "invalid", cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw browserError("Browser URL must use HTTP or HTTPS", "invalid");
  if (url.username.length > 0 || url.password.length > 0)
    throw browserError("Browser URLs cannot contain credentials", "invalid");
  return url.href;
};

const validTabReference = (input: string): string => {
  if (input.length === 0 || input.length > 500 || input.startsWith("-"))
    throw browserError("Browser tab reference is invalid", "invalid");
  return input;
};

const interactionCommand = (
  interaction: BrowserInteraction,
): ReadonlyArray<string> => {
  switch (interaction.type) {
    case "click":
      return interaction.newTab
        ? ["click", interaction.selector, "--new-tab"]
        : ["click", interaction.selector];
    case "doubleClick":
      return ["dblclick", interaction.selector];
    case "focus":
      return ["focus", interaction.selector];
    case "drag":
      return ["drag", interaction.source, interaction.target];
    case "scrollIntoView":
      return ["scrollintoview", interaction.selector];
    case "fill":
      return ["fill", interaction.selector, interaction.text];
    case "type":
      return ["type", interaction.selector, interaction.text];
    case "press":
      return ["press", interaction.key];
    case "select":
      return ["select", interaction.selector, ...interaction.values];
    case "check":
      return ["check", interaction.selector];
    case "hover":
      return ["hover", interaction.selector];
    case "uncheck":
      return ["uncheck", interaction.selector];
    case "scroll":
      return interaction.selector === undefined
        ? ["scroll", interaction.direction, String(interaction.amount ?? 300)]
        : [
            "scroll",
            interaction.direction,
            String(interaction.amount ?? 300),
            "--selector",
            interaction.selector,
          ];
    case "waitForSelector":
      return [
        "wait",
        interaction.selector,
        "--state",
        interaction.state,
        ...(interaction.timeoutMs === undefined
          ? []
          : ["--timeout", String(interaction.timeoutMs)]),
      ];
    case "waitMs":
      return ["wait", String(interaction.ms)];
    case "waitForText":
      return [
        "wait",
        "--text",
        interaction.text,
        ...(interaction.timeoutMs === undefined
          ? []
          : ["--timeout", String(interaction.timeoutMs)]),
      ];
    case "waitForLoad":
      return [
        "wait",
        "--load",
        interaction.state,
        ...(interaction.timeoutMs === undefined
          ? []
          : ["--timeout", String(interaction.timeoutMs)]),
      ];
    case "waitForUrl":
      return [
        "wait",
        "--url",
        interaction.pattern,
        ...(interaction.timeoutMs === undefined
          ? []
          : ["--timeout", String(interaction.timeoutMs)]),
      ];
    case "waitForFunction":
      return [
        "wait",
        "--fn",
        interaction.expression,
        ...(interaction.timeoutMs === undefined
          ? []
          : ["--timeout", String(interaction.timeoutMs)]),
      ];
    case "dialogAccept":
      return interaction.text === undefined
        ? ["dialog", "accept"]
        : ["dialog", "accept", interaction.text];
    case "dialogDismiss":
      return ["dialog", "dismiss"];
    case "back":
    case "forward":
    case "reload":
      return [interaction.type];
  }
};

const boundedText = (
  text: string,
  warning?: string,
): Effect.Effect<
  { readonly content: string; readonly warning?: string },
  BrowserError
> =>
  text.length > maxPageOutputCharacters
    ? Effect.fail(
        browserError(
          "Browser page output exceeded 50,000 characters",
          "protocol",
        ),
      )
    : Effect.succeed(
        warning === undefined ? { content: text } : { content: text, warning },
      );

const decodeBoundedText = (
  decode: () => string,
  warning?: string,
): Effect.Effect<string, BrowserError> =>
  Effect.try({
    try: decode,
    catch: (cause) =>
      browserError(
        "agent-browser returned invalid text output",
        "protocol",
        cause,
      ),
  }).pipe(
    Effect.flatMap((value) => boundedText(value, warning)),
    Effect.map((value) => value.content),
  );

const decodeTab = (
  response: typeof BrowserCliResponse.Type,
): Effect.Effect<BrowserTab, BrowserError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(TabData)(response.data),
    catch: (cause) =>
      browserError(
        "agent-browser returned invalid tab metadata",
        "protocol",
        cause,
      ),
  });

export const makeBrowserService = (
  runner: BrowserProcessRunner = defaultProcessRunner,
): BrowserServiceContract => {
  const sessions = new Map<string, BrowserSessionState>();
  const sessionsLock = Semaphore.makeUnsafe(1);

  const sessionFor = (runId: AgentRunId) =>
    sessionsLock.withPermit(
      Effect.suspend(() => {
        const existing = sessions.get(runId);
        if (existing !== undefined) return Effect.succeed(existing);
        return Effect.tryPromise({
          try: async () => {
            const directory = await mkdtemp(join(tmpdir(), "ronto-browser-"));
            await Promise.all([
              mkdir(join(directory, "artifacts")),
              mkdir(join(directory, "screenshots")),
            ]);
            const state: BrowserSessionState = {
              closing: false,
              directory,
              lock: Semaphore.makeUnsafe(1),
              name: `ronto_${randomUUID().replaceAll("-", "")}`,
            };
            sessions.set(runId, state);
            return state;
          },
          catch: (cause) =>
            browserError(
              "Could not create the browser run directory",
              "unavailable",
              cause,
            ),
        });
      }),
    );

  const invokeUnlocked = (
    session: BrowserSessionState,
    command: ReadonlyArray<string>,
    signal?: AbortSignal,
  ) =>
    Effect.tryPromise({
      try: async (effectSignal) => {
        const signals = [effectSignal, AbortSignal.timeout(commandTimeoutMs)];
        if (signal !== undefined) signals.push(signal);
        const result = await runner(
          [
            "--config",
            configPath,
            "--session",
            session.name,
            ...command,
          ],
          AbortSignal.any(signals),
        );
        let response: typeof BrowserCliResponse.Type;
        try {
          response = decodeBrowserCliResponse(result.stdout.trim());
        } catch (cause) {
          throw browserError(
            "agent-browser returned an invalid response",
            "protocol",
            cause,
          );
        }
        if (!response.success || result.exitCode !== 0) {
          const stderr = result.stderr.trim();
          throw browserError(
            response.error ??
              (stderr.length > 0 ? stderr : "agent-browser command failed"),
            "command",
          );
        }
        return response;
      },
      catch: (cause) =>
        cause instanceof BrowserError
          ? cause
          : browserError(
              cause instanceof Error
                ? cause.message
                : "agent-browser command failed",
              "unavailable",
              cause,
            ),
    });

  const invoke = (
    runId: AgentRunId,
    command: ReadonlyArray<string>,
    signal?: AbortSignal,
  ) =>
    sessionFor(runId).pipe(
      Effect.flatMap((session) =>
        session.lock.withPermit(
          Effect.suspend(() =>
            session.closing
              ? Effect.fail(
                  browserError("Browser session is closing", "command"),
                )
              : invokeUnlocked(session, command, signal),
          ),
        ),
      ),
    );

  const captureArtifact = <MediaType extends BrowserArtifact["mediaType"]>(
    runId: AgentRunId,
    name: string,
    mediaType: MediaType,
    commandForPath: (path: string) => ReadonlyArray<string>,
    validate: (content: Uint8Array) => boolean,
    signal?: AbortSignal,
  ): Effect.Effect<
    { readonly content: Uint8Array; readonly mediaType: MediaType; readonly name: string },
    BrowserError
  > =>
    sessionFor(runId).pipe(
      Effect.flatMap((session) => {
        const path = join(session.directory, "artifacts", name);
        return session.lock
          .withPermit(
            Effect.suspend(() =>
              session.closing
                ? Effect.fail(
                    browserError("Browser session is closing", "command"),
                  )
                : invokeUnlocked(session, commandForPath(path), signal),
            ).pipe(
              Effect.flatMap(() =>
                Effect.tryPromise({
                  try: async () => {
                    const [root, target, file] = await Promise.all([
                      realpath(session.directory),
                      realpath(path),
                      lstat(path),
                    ]);
                    const escaped = relative(root, target);
                    if (
                      escaped === ".." ||
                      escaped.startsWith(`..${sep}`) ||
                      file.isSymbolicLink() ||
                      !file.isFile()
                    ) {
                      throw new Error(
                        "Browser artifact escaped its run directory",
                      );
                    }
                    if (file.size > maxBrowserArtifactBytes)
                      throw new Error("Browser artifact exceeded 25 MiB");
                    const content = await readFile(target);
                    if (!validate(content))
                      throw new Error("Browser artifact content was invalid");
                    return { content, mediaType, name };
                  },
                  catch: (cause) =>
                    browserError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not read the browser artifact",
                      "protocol",
                      cause,
                    ),
                }),
              ),
            ),
          )
          .pipe(
            Effect.ensuring(
              Effect.tryPromise(() => rm(path, { force: true })).pipe(
                Effect.ignore,
              ),
            ),
          );
      }),
    );

  const close = (runId: AgentRunId): Effect.Effect<void> =>
    sessionsLock
      .withPermit(
        Effect.sync(() => {
          const session = sessions.get(runId) ?? null;
          if (session !== null) session.closing = true;
          return session;
        }),
      )
      .pipe(
        Effect.flatMap((session) => {
          if (session === null) return Effect.void;
          return session.lock
            .withPermit(invokeUnlocked(session, ["close"]))
            .pipe(
              Effect.ignore,
              Effect.ensuring(
                Effect.tryPromise(() =>
                  rm(session.directory, { force: true, recursive: true }),
                ).pipe(Effect.ignore),
              ),
              Effect.ensuring(
                sessionsLock.withPermit(
                  Effect.sync(() => {
                    if (sessions.get(runId) === session)
                      sessions.delete(runId);
                  }),
                ),
              ),
            );
        }),
      );

  return {
    open: (runId, input, signal) =>
      Effect.try({
        try: () => validHttpUrl(input),
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("Browser URL is invalid", "invalid", cause),
      }).pipe(
        Effect.flatMap((url) => invoke(runId, ["open", url], signal)),
        Effect.flatMap((response) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(OpenData)(response.data),
            catch: (cause) =>
              browserError(
                "agent-browser returned invalid page metadata",
                "protocol",
                cause,
              ),
          }).pipe(
            Effect.map((page) =>
              response.warning === undefined
                ? page
                : { ...page, warning: response.warning },
            ),
          ),
        ),
      ),
    read: (runId, options, signal) => {
      return Effect.try({
        try: () => {
          const command = ["read"];
          if (options.url !== undefined) command.push(validHttpUrl(options.url));
          if (options.raw) command.push("--raw");
          if (options.requireMd) command.push("--require-md");
          if (options.outline) command.push("--outline");
          if (options.llms !== undefined) command.push("--llms", options.llms);
          if (options.filter !== undefined)
            command.push("--filter", options.filter);
          if (options.readTimeoutMs !== undefined)
            command.push("--timeout", String(options.readTimeoutMs));
          return command;
        },
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("Browser URL is invalid", "invalid", cause),
      }).pipe(
        Effect.flatMap((command) => invoke(runId, command, signal)),
        Effect.flatMap((response) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(ReadData)(response.data),
            catch: (cause) =>
              browserError(
                "agent-browser returned invalid page text",
                "protocol",
                cause,
              ),
          }).pipe(
            Effect.flatMap((data) =>
              boundedText(data.content, response.warning),
            ),
          ),
        ),
      );
    },
    snapshot: (runId, options, signal) => {
      const command = ["snapshot"];
      if (options.interactive) command.push("-i");
      if (options.compact) command.push("-c");
      if (options.includeUrls) command.push("-u");
      if (options.depth !== undefined)
        command.push("-d", String(options.depth));
      if (options.selector !== undefined) command.push("-s", options.selector);
      return invoke(runId, command, signal).pipe(
        Effect.flatMap((response) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(SnapshotData)(response.data),
            catch: (cause) =>
              browserError(
                "agent-browser returned an invalid snapshot",
                "protocol",
                cause,
              ),
          }).pipe(
            Effect.flatMap((snapshot) =>
              snapshot.snapshot.length > maxPageOutputCharacters
                ? Effect.fail(
                    browserError(
                      "Browser snapshot exceeded 50,000 characters",
                      "protocol",
                    ),
                  )
                : Effect.succeed(
                    response.warning === undefined
                      ? {
                          snapshot: snapshot.snapshot,
                          origin:
                            snapshot.origin ??
                            response._boundary?.origin ??
                            null,
                        }
                      : {
                          snapshot: snapshot.snapshot,
                          origin:
                            snapshot.origin ??
                            response._boundary?.origin ??
                            null,
                          warning: response.warning,
                        },
                  ),
            ),
          ),
        ),
      );
    },
    getUrl: (runId, signal) =>
      invoke(runId, ["get", "url"], signal).pipe(
        Effect.flatMap((response) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(UrlData)(response.data).url,
            catch: (cause) =>
              browserError(
                "agent-browser returned an invalid current URL",
                "protocol",
                cause,
              ),
          }),
        ),
      ),
    getText: (runId, selector, signal) =>
      invoke(runId, ["get", "text", selector], signal).pipe(
        Effect.flatMap((response) =>
          decodeBoundedText(
            () => Schema.decodeUnknownSync(TextData)(response.data).text,
            response.warning,
          ),
        ),
      ),
    getTitle: (runId, signal) =>
      invoke(runId, ["get", "title"], signal).pipe(
        Effect.flatMap((response) =>
          decodeBoundedText(
            () => Schema.decodeUnknownSync(TitleData)(response.data).title,
            response.warning,
          ),
        ),
      ),
    eval: (runId, script, signal) =>
      invoke(
        runId,
        ["eval", "-b", Buffer.from(script, "utf8").toString("base64")],
        signal,
      ).pipe(
        Effect.flatMap((response) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(EvalData)(response.data),
            catch: (cause) =>
              browserError(
                "agent-browser returned invalid eval output",
                "protocol",
                cause,
              ),
          }),
        ),
        Effect.flatMap((data) =>
          boundedText(JSON.stringify(data.result) ?? "undefined"),
        ),
        Effect.map((data) => data.content),
      ),
    tabNew: (runId, options, signal) => {
      return Effect.try({
        try: () => {
          const command = ["tab", "new"];
          if (options.label !== undefined)
            command.push("--label", options.label);
          if (options.url !== undefined)
            command.push(validHttpUrl(options.url));
          return command;
        },
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("Browser tab URL is invalid", "invalid", cause),
      }).pipe(
        Effect.flatMap((command) => invoke(runId, command, signal)),
        Effect.flatMap(decodeTab),
      );
    },
    tabList: (runId, signal) =>
      invoke(runId, ["tab", "list", "--json"], signal).pipe(
        Effect.flatMap((response) =>
          Effect.try({
            try: () => {
              const tabs = Schema.decodeUnknownSync(TabsData)(response.data).tabs;
              if (JSON.stringify(tabs).length > maxPageOutputCharacters)
                throw browserError(
                  "Browser tab list exceeded 50,000 characters",
                  "protocol",
                );
              return tabs;
            },
            catch: (cause) =>
              cause instanceof BrowserError
                ? cause
                : browserError(
                    "agent-browser returned invalid tab list",
                    "protocol",
                    cause,
                  ),
          }),
        ),
      ),
    tabSwitch: (runId, tab, signal) =>
      Effect.try({
        try: () => validTabReference(tab),
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("Browser tab reference is invalid", "invalid", cause),
      }).pipe(
        Effect.flatMap((reference) =>
          invoke(runId, ["tab", reference], signal),
        ),
        Effect.flatMap(decodeTab),
      ),
    tabClose: (runId, tab, signal) =>
      Effect.try({
        try: (): ReadonlyArray<string> =>
          tab === undefined
            ? ["tab", "close"]
            : ["tab", "close", validTabReference(tab)],
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("Browser tab reference is invalid", "invalid", cause),
      }).pipe(
        Effect.flatMap((command) => invoke(runId, command, signal)),
        Effect.flatMap(decodeTab),
      ),
    screenshot: (runId, options, signal) =>
      sessionFor(runId).pipe(
        Effect.flatMap((session) => {
          const name = `browser-screenshot-${randomUUID()}.png`;
          const path = join(session.directory, "screenshots", name);
          const command = ["screenshot", path];
          if (options.fullPage) command.push("--full");
          if (options.selector !== undefined)
            command.push("--selector", options.selector);
          if (options.annotate) command.push("--annotate");
          return session.lock
            .withPermit(
              Effect.suspend(() =>
                session.closing
                  ? Effect.fail(
                      browserError("Browser session is closing", "command"),
                    )
                  : invokeUnlocked(session, command, signal),
              ).pipe(
                Effect.flatMap(() =>
                  Effect.tryPromise({
                    try: async () => {
                      const [root, target, file] = await Promise.all([
                        realpath(session.directory),
                        realpath(path),
                        lstat(path),
                      ]);
                      const escaped = relative(root, target);
                      if (
                        escaped === ".." ||
                        escaped.startsWith(`..${sep}`) ||
                        file.isSymbolicLink() ||
                        !file.isFile()
                      ) {
                        throw new Error(
                          "Browser screenshot escaped its run directory",
                        );
                      }
                      if (file.size > maxScreenshotBytes)
                        throw new Error("Browser screenshot exceeded 25 MiB");
                      const content = await readFile(target);
                      if (!isPng(content)) {
                        throw new Error(
                          "Browser screenshot was not a valid PNG file",
                        );
                      }
                      return {
                        content,
                        mediaType: "image/png" as const,
                        name,
                      };
                    },
                    catch: (cause) =>
                      browserError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not read the browser screenshot",
                        "protocol",
                        cause,
                      ),
                  }),
                ),
              ),
            )
            .pipe(
              Effect.ensuring(
                Effect.tryPromise(() => rm(path, { force: true })).pipe(
                  Effect.ignore,
                ),
              ),
            );
        }),
      ),
    upload: (runId, selector, paths, signal) =>
      invoke(runId, ["upload", selector, ...paths], signal).pipe(
        Effect.map((response) =>
          response.warning === undefined
            ? {}
            : { warning: response.warning },
        ),
      ),
    download: (runId, selector, signal) => {
      const name = `browser-download-${randomUUID()}.bin`;
      return captureArtifact(
        runId,
        name,
        "application/octet-stream",
        (path) => ["download", selector, path],
        () => true,
        signal,
      );
    },
    pdf: (runId, signal) => {
      const name = `browser-page-${randomUUID()}.pdf`;
      return captureArtifact(
        runId,
        name,
        "application/pdf",
        (path) => ["pdf", path],
        isPdf,
        signal,
      );
    },
    interact: (runId, interaction, signal) =>
      invoke(runId, interactionCommand(interaction), signal).pipe(
        Effect.map((response) =>
          response.warning === undefined
            ? {}
            : { warning: response.warning },
        ),
      ),
    close,
    shutdown: () =>
      Effect.forEach(Array.from(sessions.keys()), (runId) =>
        close(AgentRunId.make(runId)),
      ).pipe(Effect.asVoid),
  };
};

export class BrowserService extends Context.Service<
  BrowserService,
  BrowserServiceContract
>()("ronto/agent/BrowserService") {
  static readonly layer = Layer.effect(
    BrowserService,
    Effect.gen(function* () {
      const service = makeBrowserService();
      yield* Effect.addFinalizer(() => service.shutdown());
      return service;
    }),
  );
}
