import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(helpersDirectory, "../..");
const wranglerPath = resolve(projectRoot, "node_modules/.bin/wrangler");

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function startCloudflareWorker() {
  const port = 12_000 + (process.pid % 30_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    CI: "true",
    NO_COLOR: "1",
  };
  delete environment.AINVEST_C_COOKIE;
  delete environment.AINVEST_EMAIL;
  delete environment.AINVEST_PASSWORD;

  const child = spawn(
    wranglerPath,
    [
      "dev",
      "--config",
      "wrangler.jsonc",
      "--env-file",
      "tests/fixtures/cloudflare-test.env",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  let spawnError = null;
  const capture = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      const result = await exited;
      throw new Error(
        `Wrangler exited before becoming ready (${JSON.stringify(result)}).\n${output}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) break;
    } catch {
      // Wrangler is still starting.
    }
    await delay(100);
  }

  if (Date.now() >= deadline) {
    child.kill("SIGTERM");
    throw new Error(`Wrangler did not become ready within 30 seconds.\n${output}`);
  }

  return {
    request(pathname, accept = "text/html") {
      return fetch(`${baseUrl}${pathname}`, {
        headers: { accept },
        redirect: "manual",
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        exited.then(() => true),
        delay(5_000).then(() => false),
      ]);
      if (!stopped) {
        child.kill("SIGKILL");
        await exited;
      }
    },
  };
}
