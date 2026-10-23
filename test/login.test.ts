import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError, CookieAuth, CredentialsAuth } from "../src/auth.js";
import { IDENTITY_COOKIE } from "../src/constants.js";
import { BlueSurfClient } from "../src/client.js";
import { BlueSurfSession } from "../src/session.js";

describe("login", () => {
  it("guarda la cookie de sesión tras un 200", async () => {
    let seen: { method?: string; body?: unknown; origin?: string | null; referer?: string | null } =
      {};
    const client = new BlueSurfClient({
      baseUrl: "https://surf.test",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        seen = {
          method: init?.method,
          body: JSON.parse(String(init?.body)),
          origin: headers.get("origin"),
          referer: headers.get("referer"),
        };
        assert.equal(new URL(url).pathname, "/api/login");
        const headersOut = new Headers({ "content-type": "application/json" });
        headersOut.append(
          "set-cookie",
          `${IDENTITY_COOKIE}=abc123; Path=/; HttpOnly`,
        );
        return new Response("{}", { status: 200, headers: headersOut });
      },
    });
    try {
      await client.login(new CredentialsAuth("alice", "secret"));
      assert.equal(seen.method, "POST");
      assert.deepEqual(seen.body, { email: "alice", password: "secret" });
      assert.equal(seen.origin, "https://surf.test");
      assert.equal(seen.referer, "https://surf.test/login");
      assert.equal(client.sessionCookie(), "abc123");
    } finally {
      await client.aclose();
    }
  });

  it("rechaza 401 sin guardar la sesión", async () => {
    const client = new BlueSurfClient({
      baseUrl: "https://surf.test",
      fetchImpl: async () => new Response("no", { status: 401 }),
    });
    try {
      await assert.rejects(
        () => client.login(new CredentialsAuth("alice", "bad")),
        (error: unknown) => {
          assert.ok(error instanceof AuthError);
          assert.match(error.message, /Login rechazado/);
          return true;
        },
      );
      assert.equal(client.authenticated, false);
    } finally {
      await client.aclose();
    }
  });

  it("CookieAuth no renueva una sesión rechazada", async () => {
    let calls = 0;
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("no", { status: 401 }));
      },
    });
    await session.login(new CookieAuth("abc"));
    try {
      await assert.rejects(() => session.getJson("/api/instance/currentUser"), /CookieAuth/);
      assert.equal(calls, 1);
    } finally {
      await session.aclose();
    }
  });
});
