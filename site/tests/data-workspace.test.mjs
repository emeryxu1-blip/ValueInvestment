import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameOrigin,
  readJsonBody,
  WorkspaceHttpError,
} from "../lib/workspace/request-guard.ts";
import {
  generateWorkspaceSessionToken,
  hashWorkspaceSessionToken,
  readWorkspaceSessionToken,
  serializeWorkspaceSessionCookie,
  WORKSPACE_SESSION_COOKIE,
} from "../lib/workspace/session-cookie.ts";
import { savedScreenerWriteSchema } from "../lib/workspace/validation.ts";

const validScreener = {
  name: "  Durable value  ",
  filters: [
    {
      id: "margin-10",
      category: "Valuation",
      label: "Margin of safety is at least 10%",
      shortLabel: "Margin ≥ 10%",
      field: "mispricing",
      operator: "gte",
      value: 0.1,
    },
  ],
  columns: ["price", "mispricing"],
  sortKey: "marketCap",
  sortOrder: "desc",
};

test("validates bounded saved-screener payloads", () => {
  const parsed = savedScreenerWriteSchema.parse(validScreener);
  assert.equal(parsed.name, "Durable value");
  assert.equal("symbols" in parsed, false);
  assert.throws(() =>
    savedScreenerWriteSchema.parse({
      ...validScreener,
      columns: ["price", "price"],
    }),
  );
  assert.throws(() =>
    savedScreenerWriteSchema.parse({ ...validScreener, symbols: ["MSFT"] }),
  );
});

test("requires a matching origin for workspace mutations", () => {
  const sameOrigin = new Request(
    "https://value.example/api/workspace/screeners",
    {
      method: "POST",
      headers: {
        Origin: "https://value.example",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );
  assert.doesNotThrow(() => assertSameOrigin(sameOrigin));

  for (const headers of [
    {},
    { Origin: "https://attacker.example" },
    {
      Origin: "https://value.example",
      "Sec-Fetch-Site": "cross-site",
    },
  ]) {
    assert.throws(
      () =>
        assertSameOrigin(
          new Request("https://value.example/api/workspace/screeners", {
            method: "POST",
            headers,
          }),
        ),
      (error) => error instanceof WorkspaceHttpError && error.status === 403,
    );
  }
});

test("rejects malformed and oversized JSON request bodies", async () => {
  await assert.rejects(
    () =>
      readJsonBody(
        new Request("https://value.example/api/workspace/screeners", {
          method: "POST",
          body: "{not-json",
        }),
      ),
    (error) => error instanceof WorkspaceHttpError && error.status === 400,
  );
  await assert.rejects(
    () =>
      readJsonBody(
        new Request("https://value.example/api/workspace/screeners", {
          method: "POST",
          headers: { "Content-Length": String(300 * 1024) },
          body: "{}",
        }),
      ),
    (error) => error instanceof WorkspaceHttpError && error.status === 413,
  );
});

test("uses an opaque HttpOnly cookie and stores a one-way token digest", async () => {
  const token = generateWorkspaceSessionToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  const digest = await hashWorkspaceSessionToken(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(await hashWorkspaceSessionToken(token), digest);

  const cookie = serializeWorkspaceSessionCookie(
    token,
    "https://value.example/api/workspace/screeners",
    1_700_000_000_000,
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.equal(
    readWorkspaceSessionToken(
      `another=value; ${WORKSPACE_SESSION_COOKIE}=${token}; final=value`,
    ),
    token,
  );
  assert.equal(
    readWorkspaceSessionToken(`${WORKSPACE_SESSION_COOKIE}=unsafe`),
    null,
  );
});
