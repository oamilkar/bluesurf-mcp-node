import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError } from "../src/auth.js";
import { cmdLogin, cmdLogout, main, type CliIo } from "../src/cli.js";

function io(partial: Partial<CliIo> = {}): CliIo {
  return {
    stdout() {},
    stderr() {},
    ask: async () => "alice",
    askPassword: async () => "pw",
    env: {},
    verify: async () => {},
    save() {},
    clear() {},
    ...partial,
  };
}

describe("cli", () => {
  it("help menciona login y logout", async () => {
    let out = "";
    const code = await main(["--help"], {
      stdout: (text) => {
        out += text;
      },
    });
    assert.equal(code, 0);
    assert.match(out, /login/);
    assert.match(out, /logout/);
  });

  it("un comando desconocido termina con código 2", async () => {
    let err = "";
    const code = await main(["nope"], {
      stderr: (text) => {
        err += text;
      },
    });
    assert.equal(code, 2);
    assert.match(err, /comando desconocido/);
  });

  it("login guarda tras validar", async () => {
    const saved: { username?: string; password?: string } = {};
    let out = "";
    const code = await cmdLogin(
      io({
        stdout: (text) => {
          out += text;
        },
        save: (username, password) => {
          saved.username = username;
          saved.password = password;
        },
      }),
    );
    assert.equal(code, 0);
    assert.deepEqual(saved, { username: "alice", password: "pw" });
    assert.match(out, /Credenciales guardadas/);
  });

  it("login no guarda si BlueSurf rechaza", async () => {
    const saved: string[] = [];
    let err = "";
    const code = await cmdLogin(
      io({
        stderr: (text) => {
          err += text;
        },
        verify: async () => {
          throw new AuthError("rechazado");
        },
        save: () => {
          saved.push("saved");
        },
      }),
    );
    assert.equal(code, 1);
    assert.deepEqual(saved, []);
    assert.match(err, /login rechazado/);
  });

  it("login no guarda si el usuario está vacío", async () => {
    const saved: string[] = [];
    const code = await cmdLogin(
      io({
        ask: async () => "   ",
        save: () => {
          saved.push("saved");
        },
      }),
    );
    assert.equal(code, 2);
    assert.deepEqual(saved, []);
  });

  it("logout borra las credenciales", () => {
    let calls = 0;
    const code = cmdLogout(
      io({
        clear: () => {
          calls += 1;
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(calls, 1);
  });
});
