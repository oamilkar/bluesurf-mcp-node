import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CookieAuth, CredentialsAuth } from "../src/auth.js";
import { buildAuth } from "../src/server.js";

describe("buildAuth", () => {
  it("la cookie de entorno gana sobre credenciales y el almacén", () => {
    const auth = buildAuth(
      {
        BLUESURF_COOKIE: "cookie-value",
        BLUESURF_USERNAME: "alice",
        BLUESURF_PASSWORD: "from-env",
      },
      () => ["alice", "from-store"],
    );
    assert.ok(auth instanceof CookieAuth);
  });

  it("acepta SURF_COOKIE como fallback", () => {
    const auth = buildAuth({ SURF_COOKIE: "from-surf" }, () => null);
    assert.ok(auth instanceof CookieAuth);
  });

  it("las credenciales de entorno ganan al almacén", () => {
    const auth = buildAuth(
      {
        BLUESURF_USERNAME: "alice",
        BLUESURF_PASSWORD: "from-env",
      },
      () => ["alice", "from-store"],
    );
    assert.ok(auth instanceof CredentialsAuth);
    assert.equal(auth.username, "alice");
    assert.equal(auth.password, "from-env");
  });

  it("cae al almacén si no hay entorno", () => {
    const auth = buildAuth({}, () => ["bob", "stored-secret"]);
    assert.ok(auth instanceof CredentialsAuth);
    assert.equal(auth.username, "bob");
    assert.equal(auth.password, "stored-secret");
  });

  it("pide login cuando no hay nada configurado", () => {
    assert.throws(() => buildAuth({}, () => null), /bluesurf-mcp login/);
  });
});
