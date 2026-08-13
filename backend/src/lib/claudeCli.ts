import { spawn as nodeSpawn } from "node:child_process";
import os from "node:os";

// ARCHITECTURE.md §10/§12 (M8) — a thin wrapper around headless Claude Code
// (`claude -p ...`), the mechanism §10's own prototyping rounds confirmed
// empirically (real Agent/Task subagent execution, real MCP tool
// inheritance, the `--allowedTools`/`permission_denials` gotcha) before
// this was built for real. This module knows nothing about *this app's*
// voice command schema/prompts/tools — that's lib/voiceCommand.ts, one
// layer up. This file's only job is "run one `claude -p` invocation
// forced into a caller-given JSON schema, and hand back either the
// resulting structured value or a typed reason it didn't work."
//
// SECURITY: the caller's `prompt` (an untrusted voice transcript, once
// this is wired up — see routes/voice.ts) is always passed as its own,
// separate element of the argv array handed to `spawn()`, never
// string-concatenated into a shell command. `spawn()` here is never called
// with `shell: true`, and never will be — that distinction (argv array
// element vs. shell string interpolation) is the actual security boundary
// against command injection, not anything about *validating* the
// transcript's contents (lib/validation.ts's `voiceCommandRequestSchema`
// only bounds its length/non-emptiness, deliberately not its characters —
// a real voice command can and will contain quotes, dashes, whatever a
// household member says).

/** Thrown when `CLAUDE_CODE_OAUTH_TOKEN` isn't set — mirrors
 * lib/deepgram.ts's `DeepgramConfigError` precedent exactly: a clear,
 * specific error instead of `claude -p` failing downstream with a
 * confusing generic auth error several seconds into a spawned process.
 * Deliberately NOT `ANTHROPIC_API_KEY` — see ARCHITECTURE.md §10's
 * "Billing" note: that would silently switch from subscription billing to
 * metered per-token API billing, the exact thing §10's Ollama correction
 * was written to avoid losing again. */
export class ClaudeCliConfigError extends Error {
  constructor() {
    super("CLAUDE_CODE_OAUTH_TOKEN is not set — see backend/.env.example.");
    this.name = "ClaudeCliConfigError";
  }
}

export type ClaudeCliErrorReason =
  | "spawn_failed" // the child process itself couldn't start
  | "timeout" // ran longer than allowed and was killed
  | "nonzero_exit" // process exited non-zero
  | "invalid_output" // stdout wasn't parseable as the expected JSON envelope
  | "permission_denied" // envelope's permission_denials was non-empty — §10's real gotcha
  | "model_error"; // envelope reported is_error: true

/** Covers every way a `claude -p` invocation can fail to produce a usable
 * result. Carries a machine-checkable `reason` (lib/voiceCommand.ts
 * branches on this to decide how to log/report the failure) and keeps the
 * detailed diagnostic (`detail`) separate from the public `message` —
 * `detail` may include the model's own prose or raw stdout/stderr, which
 * is fine to log server-side but should never be forwarded to an HTTP
 * client verbatim (same "don't relay upstream detail to the client" instinct
 * as lib/deepgram.ts's DeepgramApiError). */
export class ClaudeCliError extends Error {
  readonly reason: ClaudeCliErrorReason;
  readonly detail: string;
  constructor(reason: ClaudeCliErrorReason, message: string, detail = "") {
    super(message);
    this.name = "ClaudeCliError";
    this.reason = reason;
    this.detail = detail;
  }
}

// The subset of `claude -p --output-format json`'s output envelope this
// module actually reads. `structured_output` is where `--json-schema`
// puts the schema-conforming result (a real parsed JSON value, not a
// string needing a second JSON.parse). `is_error` / `permission_denials`
// are ARCHITECTURE.md §10's own already-verified real finding — headless
// mode's permission gate silently reports `is_error: false` with
// plausible-sounding prose for a denied tool call unless
// `permission_denials` is checked explicitly, so this module always checks
// it rather than trusting `is_error` alone.
interface ClaudeCliEnvelope {
  result?: string;
  is_error?: boolean;
  permission_denials?: Array<{ tool_name?: string; [key: string]: unknown }>;
  structured_output?: unknown;
  [key: string]: unknown;
}

// Minimal structural shape this module needs from a spawned child process —
// deliberately narrower than Node's real `ChildProcess` type so a test's
// fake implementation only has to satisfy what's actually used, the same
// spirit as lib/deepgram.ts defaulting `fetchImpl` to the real global
// `fetch` but typing it as plain `typeof fetch`.
export interface ClaudeCliChildProcess {
  stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(): void;
}

export interface ClaudeCliSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  stdio: ["ignore", "pipe", "pipe"];
}

export type ClaudeCliSpawnFn = (
  command: string,
  args: readonly string[],
  options: ClaudeCliSpawnOptions,
) => ClaudeCliChildProcess;

// Real `child_process.spawn`'s return type (`ChildProcessWithoutNullStreams`
// with this stdio config) structurally satisfies `ClaudeCliChildProcess`
// above, so this needs no cast — same "default param is the real thing,
// injectable for tests" shape as lib/deepgram.ts's `fetchImpl = fetch`.
const realSpawn: ClaudeCliSpawnFn = nodeSpawn as unknown as ClaudeCliSpawnFn;

export interface RunClaudeCommandOptions {
  model: string; // "haiku" | "sonnet" — see lib/voiceCommand.ts's tier constants
  jsonSchema: object;
  allowedTools: string[];
  systemPrompt: string;
  /** Extra environment variables merged onto the spawned process's env —
   * used to thread `VOICE_COMMAND_BATCH_ID` through to mcp/server.ts
   * without changing the MCP tool call contract itself. See
   * lib/voiceCommand.ts's own comment on why this, and not some other
   * reconciliation approach, was chosen. */
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}

// Two independent test/dev overrides, deliberately separate from each
// other and from `spawnImpl` below — mirrors lib/deepgram.ts's two-lever
// pattern (`DEEPGRAM_API_URL` env override + injectable `fetchImpl`), just
// with one extra lever because a Node-based e2e stand-in can't be executed
// directly as a Windows "exe" the way a real `claude` binary can (see
// e2e/mock-claude-cli.mjs's own header) — it has to be launched as
// `node <script>`, so the *command* (defaults to the real `claude`) and a
// space-separated list of *fixed args to prepend* (empty in real usage)
// are both independently overridable. Neither is meant to be touched
// outside of e2e config (playwright.config.ts) — production never sets
// either, and gets the real `claude` binary with no prefix args.
function resolveCommand(): { command: string; prefixArgs: string[] } {
  const command = process.env.CLAUDE_CLI_COMMAND || "claude";
  const prefixArgs = process.env.CLAUDE_CLI_ARGS_PREFIX
    ? process.env.CLAUDE_CLI_ARGS_PREFIX.split(" ").filter(Boolean)
    : [];
  return { command, prefixArgs };
}

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Runs one headless `claude -p` invocation forced into `options.jsonSchema`
 * via `--json-schema`, and returns the resulting `structured_output` value
 * as-is (unvalidated — lib/voiceCommand.ts zod-parses it against the
 * app-specific schema; this module doesn't know that schema).
 *
 * `--print` (not the `-p` short alias) + the prompt as its own following
 * argv element — see this file's top-of-file SECURITY note. `cwd` is
 * deliberately NOT this repo's own checkout: `claude -p` auto-discovers
 * CLAUDE.md files from its working directory, and this repo's own root
 * CLAUDE.md (dev-tooling instructions for *editing* this codebase) has
 * nothing to do with triaging a household voice command — running from
 * `os.tmpdir()` keeps that dev-tooling context out of a voice invocation
 * entirely, without needing `--bare` (which would also stop
 * `CLAUDE_CODE_OAUTH_TOKEN` from being read at all — see
 * `ClaudeCliConfigError`'s comment on why that's the one thing this can't
 * give up). The `our-calendar` MCP server is registered at *user* config
 * scope (ARCHITECTURE.md §10a), so it's still auto-discovered regardless
 * of cwd.
 *
 * Throws `ClaudeCliConfigError` if `CLAUDE_CODE_OAUTH_TOKEN` isn't set, or
 * `ClaudeCliError` for every other way this can fail to produce a usable
 * result (see `ClaudeCliErrorReason`).
 */
export async function runClaudeCommand(
  prompt: string,
  options: RunClaudeCommandOptions,
  spawnImpl: ClaudeCliSpawnFn = realSpawn,
): Promise<unknown> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw new ClaudeCliConfigError();

  const { command, prefixArgs } = resolveCommand();
  const args = [
    ...prefixArgs,
    "--print",
    prompt,
    "--model",
    options.model,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(options.jsonSchema),
    "--allowedTools",
    options.allowedTools.join(","),
    "--append-system-prompt",
    options.systemPrompt,
  ];

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    let child: ClaudeCliChildProcess;
    try {
      child = spawnImpl(command, args, {
        cwd: os.tmpdir(),
        // CLAUDE_CODE_OAUTH_TOKEN re-set explicitly (not just relying on
        // it already being in process.env, which it is) so the intent is
        // unambiguous at the call site; extraEnv (VOICE_COMMAND_BATCH_ID)
        // layered on top last so it can't be shadowed by anything else.
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, ...options.extraEnv },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(new ClaudeCliError("spawn_failed", "Couldn't start the Claude Code process.", String(err)));
      return;
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      settle(() => {
        try {
          child.kill();
        } catch {
          // already gone — nothing further to do
        }
        reject(new ClaudeCliError("timeout", "The Claude Code invocation took too long."));
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      settle(() => {
        clearTimeout(timer);
        reject(new ClaudeCliError("spawn_failed", "Couldn't start the Claude Code process.", err.message));
      });
    });

    child.on("close", (code) => {
      settle(() => {
        clearTimeout(timer);

        let envelope: ClaudeCliEnvelope;
        try {
          envelope = JSON.parse(stdout.trim()) as ClaudeCliEnvelope;
        } catch {
          reject(
            new ClaudeCliError(
              "invalid_output",
              "Claude Code produced output that wasn't valid JSON.",
              `exit ${code}; stdout: ${stdout.slice(0, 2000)}; stderr: ${stderr.slice(0, 2000)}`,
            ),
          );
          return;
        }

        // Checked before `is_error` and before the exit code — §10's own
        // real finding is that a denied tool call still comes back with
        // is_error:false and a plausible-sounding prose result, so this
        // must never be skipped/reordered after a cheaper-looking check.
        const denials = envelope.permission_denials ?? [];
        if (denials.length > 0) {
          reject(
            new ClaudeCliError(
              "permission_denied",
              "Claude Code was denied a tool call it needed.",
              JSON.stringify(denials),
            ),
          );
          return;
        }

        if (envelope.is_error) {
          reject(new ClaudeCliError("model_error", "Claude Code reported an error.", envelope.result ?? ""));
          return;
        }

        if (code !== 0) {
          reject(
            new ClaudeCliError("nonzero_exit", `Claude Code exited with code ${code}.`, stderr.slice(0, 2000)),
          );
          return;
        }

        if (envelope.structured_output === undefined) {
          reject(
            new ClaudeCliError(
              "invalid_output",
              "Claude Code's response had no structured_output field.",
              stdout.slice(0, 2000),
            ),
          );
          return;
        }

        resolve(envelope.structured_output);
      });
    });
  });
}
