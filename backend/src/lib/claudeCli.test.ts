import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeCliConfigError,
  ClaudeCliError,
  runClaudeCommand,
  type ClaudeCliChildProcess,
  type ClaudeCliSpawnFn,
} from "./claudeCli.js";

// Unit coverage for lib/claudeCli.ts's envelope parsing/error-reason logic
// — the one part of this module that's meaningfully easy to get subtly
// wrong (ARCHITECTURE.md §13's own bar for what earns a Vitest test), and
// deliberately NOT something to only exercise indirectly through
// e2e/voice-command.spec.ts's HTTP-level tests: this file is what checks
// `permission_denials` before `is_error` (§10's own real gotcha —
// see claudeCli.ts's own comment), which is exactly the kind of ordering
// bug a higher-level e2e assertion could accidentally paper over by only
// ever exercising the "everything's fine" and "everything's denied" cases
// separately rather than together.
//
// `spawnImpl` is faked here with a plain EventEmitter standing in for a
// real ChildProcess's minimal shape (`ClaudeCliChildProcess`) — no real
// process is ever spawned by this file.

interface FakeChild {
  child: ClaudeCliChildProcess;
  stdout: EventEmitter;
  stderr: EventEmitter;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const lifecycle = new EventEmitter();
  const kill = vi.fn();
  const child: ClaudeCliChildProcess = {
    stdout: { on: (event, listener) => stdout.on(event, listener) },
    stderr: { on: (event, listener) => stderr.on(event, listener) },
    on: (event, listener) => lifecycle.on(event, listener as (...args: unknown[]) => void),
    kill,
  };
  return {
    child,
    stdout,
    stderr,
    emitClose: (code) => lifecycle.emit("close", code),
    emitError: (err) => lifecycle.emit("error", err),
    kill,
  };
}

function spawnReturning(fake: FakeChild): ClaudeCliSpawnFn {
  return () => fake.child;
}

const baseOptions = {
  model: "haiku",
  jsonSchema: { type: "object" as const },
  allowedTools: ["mcp__our-calendar__list_events"],
  systemPrompt: "test system prompt",
};

beforeEach(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "fake-token-for-unit-tests";
});

afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CLI_COMMAND;
  delete process.env.CLAUDE_CLI_ARGS_PREFIX;
});

describe("runClaudeCommand", () => {
  it("throws ClaudeCliConfigError when CLAUDE_CODE_OAUTH_TOKEN isn't set, before ever spawning anything", async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const spawnImpl = vi.fn();
    await expect(runClaudeCommand("hello", baseOptions, spawnImpl)).rejects.toBeInstanceOf(ClaudeCliConfigError);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("resolves with structured_output on a clean success envelope", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit(
      "data",
      JSON.stringify({ is_error: false, permission_denials: [], structured_output: { foo: "bar" } }),
    );
    fake.emitClose(0);
    await expect(promise).resolves.toEqual({ foo: "bar" });
  });

  it("assembles stdout across multiple data chunks before parsing", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    const envelope = JSON.stringify({ is_error: false, permission_denials: [], structured_output: { ok: true } });
    fake.stdout.emit("data", envelope.slice(0, 10));
    fake.stdout.emit("data", envelope.slice(10));
    fake.emitClose(0);
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("rejects with reason permission_denied when permission_denials is non-empty — even though is_error is false (§10's own real gotcha)", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit(
      "data",
      JSON.stringify({
        is_error: false,
        permission_denials: [{ tool_name: "mcp__our-calendar__delete_event" }],
        structured_output: { needsResearch: null, actionTaken: "did it anyway", proposedDestructiveAction: null },
        result: "plausible-sounding prose that must not be trusted over permission_denials",
      }),
    );
    fake.emitClose(0);
    await expect(promise).rejects.toMatchObject({ reason: "permission_denied" });
  });

  it("rejects with reason model_error when is_error is true", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit("data", JSON.stringify({ is_error: true, permission_denials: [], result: "it broke" }));
    fake.emitClose(0);
    await expect(promise).rejects.toMatchObject({ reason: "model_error" });
  });

  it("rejects with reason invalid_output when stdout isn't parseable JSON", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit("data", "not json at all");
    fake.emitClose(0);
    await expect(promise).rejects.toMatchObject({ reason: "invalid_output" });
  });

  it("rejects with reason invalid_output when structured_output is missing from an otherwise-valid envelope", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit("data", JSON.stringify({ is_error: false, permission_denials: [], result: "prose only" }));
    fake.emitClose(0);
    await expect(promise).rejects.toMatchObject({ reason: "invalid_output" });
  });

  it("rejects with reason nonzero_exit when the process exits non-zero despite a clean-looking envelope", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.stdout.emit(
      "data",
      JSON.stringify({ is_error: false, permission_denials: [], structured_output: { foo: "bar" } }),
    );
    fake.emitClose(1);
    await expect(promise).rejects.toMatchObject({ reason: "nonzero_exit" });
  });

  it("rejects with reason spawn_failed when the child process itself errors", async () => {
    const fake = makeFakeChild();
    const promise = runClaudeCommand("hello", baseOptions, spawnReturning(fake));
    fake.emitError(new Error("ENOENT"));
    await expect(promise).rejects.toMatchObject({ reason: "spawn_failed" });
  });

  it("rejects with reason spawn_failed when spawnImpl throws synchronously", async () => {
    const spawnImpl: ClaudeCliSpawnFn = () => {
      throw new Error("boom");
    };
    await expect(runClaudeCommand("hello", baseOptions, spawnImpl)).rejects.toMatchObject({
      reason: "spawn_failed",
    });
  });

  it("passes the prompt as its own argv element (never shell-concatenated) and threads extraEnv onto the child's env", async () => {
    const fake = makeFakeChild();
    let capturedArgs: readonly string[] | undefined;
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const spawnImpl: ClaudeCliSpawnFn = (_command, args, options) => {
      capturedArgs = args;
      capturedEnv = options.env;
      return fake.child;
    };

    const promise = runClaudeCommand(
      'a transcript with "quotes" and $(dangerous) shell metacharacters',
      { ...baseOptions, extraEnv: { VOICE_COMMAND_BATCH_ID: "batch-123" } },
      spawnImpl,
    );
    fake.stdout.emit(
      "data",
      JSON.stringify({ is_error: false, permission_denials: [], structured_output: { ok: true } }),
    );
    fake.emitClose(0);
    await promise;

    expect(capturedArgs).toContain('a transcript with "quotes" and $(dangerous) shell metacharacters');
    expect(capturedEnv?.VOICE_COMMAND_BATCH_ID).toBe("batch-123");
    expect(capturedEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBe("fake-token-for-unit-tests");
  });

  it("respects CLAUDE_CLI_COMMAND/CLAUDE_CLI_ARGS_PREFIX overrides (the e2e mock-claude-cli.mjs mechanism)", async () => {
    process.env.CLAUDE_CLI_COMMAND = "node";
    process.env.CLAUDE_CLI_ARGS_PREFIX = "/path/to/mock-claude-cli.mjs";
    const fake = makeFakeChild();
    let capturedCommand: string | undefined;
    let capturedArgs: readonly string[] | undefined;
    const spawnImpl: ClaudeCliSpawnFn = (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return fake.child;
    };

    const promise = runClaudeCommand("hello", baseOptions, spawnImpl);
    fake.stdout.emit(
      "data",
      JSON.stringify({ is_error: false, permission_denials: [], structured_output: { ok: true } }),
    );
    fake.emitClose(0);
    await promise;

    expect(capturedCommand).toBe("node");
    expect(capturedArgs?.slice(0, 2)).toEqual(["/path/to/mock-claude-cli.mjs", "--print"]);
  });

  it("kills the child and rejects with reason timeout if it runs longer than timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeChild();
      const promise = runClaudeCommand("hello", { ...baseOptions, timeoutMs: 1_000 }, spawnReturning(fake));
      const assertion = expect(promise).rejects.toBeInstanceOf(ClaudeCliError);
      const assertionReason = expect(promise).rejects.toMatchObject({ reason: "timeout" });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
      await assertionReason;
      expect(fake.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
