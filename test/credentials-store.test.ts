import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  KEYRING_SERVICE,
  clearStored,
  loadStored,
  saveStored,
  type Keyring,
} from "../src/credentials-store.js";

function memoryKeyring(): Keyring & {
  get(service: string, username: string): string | null;
} {
  const data = new Map<string, string>();
  const id = (service: string, username: string) => `${service}\0${username}`;
  return {
    get: (service, username) => data.get(id(service, username)) ?? null,
    getPassword(service, username) {
      return data.get(id(service, username)) ?? null;
    },
    setPassword(service, username, password) {
      data.set(id(service, username), password);
    },
    deletePassword(service, username) {
      const key = id(service, username);
      if (!data.has(key)) throw new Error(`missing ${username}`);
      data.delete(key);
    },
  };
}

describe("credentials store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-cred-"));
    dirs.push(dir);
    return dir;
  }

  it("guarda el usuario en JSON y la contraseña solo en el keyring", () => {
    const dir = tempDir();
    const keyring = memoryKeyring();
    saveStored("alice", "s3cret", { directory: dir, keyring });

    const file = path.join(dir, "config.json");
    const text = readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(text), { username: "alice" });
    assert.equal(text.includes("s3cret"), false);
    assert.deepEqual(loadStored({ directory: dir, keyring }), ["alice", "s3cret"]);
    assert.equal(keyring.get(KEYRING_SERVICE, "alice"), "s3cret");
  });

  it("load sin config devuelve null", () => {
    const dir = tempDir();
    assert.equal(loadStored({ directory: dir, keyring: memoryKeyring() }), null);
  });

  it("load sin contraseña en el keyring devuelve null", () => {
    const dir = tempDir();
    const file = path.join(dir, "config.json");
    const keyring = memoryKeyring();
    saveStored("alice", "s3cret", { directory: dir, keyring });
    keyring.deletePassword(KEYRING_SERVICE, "alice");
    assert.equal(readFileSync(file, "utf8").includes("alice"), true);
    assert.equal(loadStored({ directory: dir, keyring }), null);
  });

  it("reemplaza el usuario anterior y borra su contraseña", () => {
    const dir = tempDir();
    const keyring = memoryKeyring();
    const options = { directory: dir, keyring };
    saveStored("alice", "old", options);
    saveStored("bob", "new", options);
    assert.deepEqual(loadStored(options), ["bob", "new"]);
    assert.equal(keyring.get(KEYRING_SERVICE, "alice"), null);
    assert.equal(keyring.get(KEYRING_SERVICE, "bob"), "new");
  });

  it("clear es idempotente", () => {
    const dir = tempDir();
    const keyring = memoryKeyring();
    const options = { directory: dir, keyring };
    saveStored("alice", "s3cret", options);
    clearStored(options);
    assert.equal(loadStored(options), null);
    assert.equal(existsSync(path.join(dir, "config.json")), false);
    clearStored(options);
    assert.equal(loadStored(options), null);
  });
});
