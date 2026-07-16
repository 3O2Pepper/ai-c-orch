import { Sandbox } from "@e2b/code-interpreter";

// Code execution seam (P3, PLAN §8/§9): generated code NEVER runs in our
// process — it runs in an E2B cloud sandbox, or not at all. Env-gated:
// without E2B_API_KEY, sandboxConfigured() is false and callers must skip
// execution phases explicitly (recorded as events/messages), never fake a
// result.
//
// NOT YET VERIFIED against the live E2B service: E2B_API_KEY is not
// present in this environment. The adapter typechecks against
// @e2b/code-interpreter 2.x; first use with a real key should run the
// Build template end-to-end once before trusting results.

export function sandboxConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

export interface SandboxRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Structured error (name: message) when execution raised, else null. */
  error: string | null;
  /** Files collected from the sandbox after the run, base64-encoded. */
  files: { path: string; contentBase64: string }[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Syntax-verify a Python file in a real shell (`python -m py_compile`).
 * Used for implement_code smoke checks: executing arbitrary programs via
 * runCode runs them inside an IPython kernel, which breaks CLI scripts
 * (argparse sees the kernel's own -f flag — observed live). A compile
 * check is the honest P3-level verification for any program shape;
 * behavioral verification is P4 scope.
 */
export async function checkPythonInSandbox(opts: {
  filename: string;
  code: string;
  timeoutMs?: number;
}): Promise<SandboxRun> {
  if (!sandboxConfigured()) {
    throw new Error("Sandbox is not configured — set E2B_API_KEY in .env.local");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sandbox = await Sandbox.create({ timeoutMs });
  try {
    const path = `/home/user/${opts.filename.replace(/[^a-zA-Z0-9._-]/g, "")}`;
    await sandbox.files.write(path, opts.code);
    try {
      const result = await sandbox.commands.run(`python -m py_compile ${path}`, {
        timeoutMs,
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.exitCode === 0 ? null : `py_compile exit ${result.exitCode}`,
        files: [],
      };
    } catch (err) {
      // Non-zero exit throws CommandExitError, which carries the result.
      const e = err as { exitCode?: number; stdout?: string; stderr?: string };
      if (typeof e.exitCode !== "number") throw err;
      return {
        ok: false,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        error: `py_compile exit ${e.exitCode}`,
        files: [],
      };
    }
  } finally {
    await sandbox.kill().catch(() => {
      // best-effort teardown; sandbox self-expires via timeoutMs
    });
  }
}

/**
 * Run Python code in a fresh sandbox and collect the requested output
 * files. The sandbox is always killed, even on failure.
 */
export async function runPythonInSandbox(opts: {
  code: string;
  collectFiles?: string[];
  timeoutMs?: number;
}): Promise<SandboxRun> {
  if (!sandboxConfigured()) {
    throw new Error("Sandbox is not configured — set E2B_API_KEY in .env.local");
  }
  const sandbox = await Sandbox.create({
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  try {
    const execution = await sandbox.runCode(opts.code, {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const files: SandboxRun["files"] = [];
    if (!execution.error) {
      for (const path of opts.collectFiles ?? []) {
        try {
          const bytes = await sandbox.files.read(path, { format: "bytes" });
          files.push({ path, contentBase64: Buffer.from(bytes).toString("base64") });
        } catch {
          // Missing output file is a run failure signal, not an exception:
          // the caller sees ok=true but files missing and reacts.
        }
      }
    }

    return {
      ok: !execution.error,
      stdout: execution.logs.stdout.join(""),
      stderr: execution.logs.stderr.join(""),
      error: execution.error ? `${execution.error.name}: ${execution.error.value}` : null,
      files,
    };
  } finally {
    await sandbox.kill().catch(() => {
      // best-effort teardown; sandbox self-expires via timeoutMs
    });
  }
}
