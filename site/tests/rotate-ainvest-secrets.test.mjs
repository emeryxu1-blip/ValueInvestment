import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseArgs,
  parseEnvFile,
  updateCloudflareSecrets,
  validateCredentials,
  verifyAInvestSession,
} from "../scripts/rotate-ainvest-secrets.mjs";

const validCredentials = {
  AINVEST_USERID: "test-user-id",
  AINVEST_SESSIONID: "test-session-id",
};

function assertRotationError(callback, message) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, "RotationError");
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("parses private env files with comments, export syntax, and quoted values", () => {
  assert.deepEqual(
    parseEnvFile(`
      # private AInvest values
      export AINVEST_USERID = "test-user-id"
      AINVEST_SESSIONID='test-session-id' # trailing comment
      OPTIONAL_SETTING=ignored
    `),
    {
      AINVEST_USERID: "test-user-id",
      AINVEST_SESSIONID: "test-session-id",
      OPTIONAL_SETTING: "ignored",
    },
  );
});

test("rejects malformed env files before any update", () => {
  assertRotationError(() => parseEnvFile("AINVEST_USERID\n"), /Malformed/);
  assertRotationError(
    () => parseEnvFile('AINVEST_USERID="unterminated\n'),
    /Malformed quoted value/,
  );
  assertRotationError(
    () => parseEnvFile("AINVEST_USERID=one\nAINVEST_USERID=two\n"),
    /Duplicate/,
  );
});

test("validates both AInvest session identifiers without exposing values", () => {
  assert.deepEqual(validateCredentials(validCredentials), validCredentials);
  for (const name of ["AINVEST_USERID", "AINVEST_SESSIONID"]) {
    for (const value of ["", "mt_visitor", "bad;value", "bad\nvalue", "bad\u0000value"]) {
      const input = { ...validCredentials, [name]: value };
      assertRotationError(() => validateCredentials(input), new RegExp(name));
    }
  }
  assertRotationError(
    () => validateCredentials({ AINVEST_USERID: "only-one" }),
    /AINVEST_SESSIONID/,
  );
});

test("accepts stdin JSON through the executable CLI without exposing values", async () => {
  const scriptPath = resolve("scripts/rotate-ainvest-secrets.mjs");
  const child = spawn(process.execPath, [scriptPath, "--stdin", "--dry-run", "--json"], {
    cwd: resolve("."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(validCredentials));
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code));
  });
  const output = Buffer.concat(stdout).toString("utf8");
  const errorOutput = Buffer.concat(stderr).toString("utf8");
  assert.equal(exitCode, 0);
  assert.match(output, /"source":"stdin"/);
  assert.doesNotMatch(`${output}${errorOutput}`, /test-user-id|test-session-id/);
});

test("accepts only safe source and update options", () => {
  const options = parseArgs([
    "--dev-vars",
    "private.vars",
    "--config=custom-wrangler.jsonc",
    "--wrangler-bin",
    "tools/wrangler",
    "--verify",
    "--dry-run",
    "--json",
  ]);
  assert.equal(options.verify, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.json, true);
  assert.match(options.devVarsPath, /private\.vars$/);
  assert.match(options.configPath, /custom-wrangler\.jsonc$/);
  assert.match(options.wranglerBin, /tools\/wrangler$/);
  assertRotationError(() => parseArgs(["--stdin", "--dev-vars", "x"]), /either/);
  assertRotationError(() => parseArgs(["--userid", "test-user-id"]), /Unknown option/);
});

test("verifies a C-side session with the AInvest snapshot API", async () => {
  let captured;
  const result = await verifyAInvestSession(validCredentials, {
    fetcher: async (url, init) => {
      captured = { url, init };
      return Response.json({ status_code: 0, status_msg: "success", data: {} });
    },
  });
  assert.equal(result, true);
  assert.equal(
    captured.url,
    "https://extquote.ainvest.com/index_api/indicator/v2/snapshot",
  );
  assert.equal(
    captured.init.headers.Cookie,
    "userid=test-user-id; sessionid=test-session-id",
  );
  assert.equal(captured.init.headers["X-Auth-ProgId"], "7080");
  assert.doesNotMatch(JSON.stringify(captured.init), /password|email/);
});

test("updates both Worker secrets through Wrangler stdin without argv or env leakage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ainvest-rotation-test-"));
  const capturePath = join(directory, "stdin.json");
  const argsPath = join(directory, "args.txt");
  const envPath = join(directory, "env.txt");
  const fakeWranglerPath = join(directory, "fake-wrangler");
  await writeFile(
    fakeWranglerPath,
    `#!/bin/sh
cat > "$ROTATION_CAPTURE"
printf '%s\\n' "$@" > "$ROTATION_ARGS"
env > "$ROTATION_ENV"
`,
    { mode: 0o700 },
  );
  await chmod(fakeWranglerPath, 0o700);

  const previousCapture = process.env.ROTATION_CAPTURE;
  const previousArgs = process.env.ROTATION_ARGS;
  const previousEnv = process.env.ROTATION_ENV;
  const previousUserid = process.env.AINVEST_USERID;
  const previousSessionid = process.env.AINVEST_SESSIONID;
  process.env.ROTATION_CAPTURE = capturePath;
  process.env.ROTATION_ARGS = argsPath;
  process.env.ROTATION_ENV = envPath;
  process.env.AINVEST_USERID = "inherited-value-must-not-reach-child";
  process.env.AINVEST_SESSIONID = "inherited-value-must-not-reach-child";
  try {
    await updateCloudflareSecrets(validCredentials, {
      wranglerBin: fakeWranglerPath,
      configPath: "wrangler.jsonc",
      timeoutMs: 5_000,
    });
    const captured = await readFile(capturePath, "utf8");
    const args = await readFile(argsPath, "utf8");
    const environment = await readFile(envPath, "utf8");
    assert.deepEqual(JSON.parse(captured), validCredentials);
    assert.match(args, /^secret\nbulk\n/m);
    assert.doesNotMatch(args, /test-user-id|test-session-id/);
    assert.doesNotMatch(environment, /AINVEST_USERID|AINVEST_SESSIONID/);
  } finally {
    if (previousCapture == null) delete process.env.ROTATION_CAPTURE;
    else process.env.ROTATION_CAPTURE = previousCapture;
    if (previousArgs == null) delete process.env.ROTATION_ARGS;
    else process.env.ROTATION_ARGS = previousArgs;
    if (previousEnv == null) delete process.env.ROTATION_ENV;
    else process.env.ROTATION_ENV = previousEnv;
    if (previousUserid == null) delete process.env.AINVEST_USERID;
    else process.env.AINVEST_USERID = previousUserid;
    if (previousSessionid == null) delete process.env.AINVEST_SESSIONID;
    else process.env.AINVEST_SESSIONID = previousSessionid;
    await rm(directory, { recursive: true, force: true });
  }
});
