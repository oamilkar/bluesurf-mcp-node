/** Credenciales del adaptador MCP.

El username vive en un JSON local. La contraseña vive solo en el almacén del
sistema. El directorio y el servicio son propios de este port (`bluesurf-mcp-node`)
para no pisar el login del paquete Python.
*/

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const KEYRING_SERVICE = "bluesurf-mcp-node";

const CONFIG_FILENAME = "config.json";

export interface Keyring {
  getPassword(service: string, username: string): string | null;
  setPassword(service: string, username: string, password: string): void;
  deletePassword(service: string, username: string): void;
}

export interface StoreOptions {
  directory?: string;
  keyring?: Keyring;
}

interface OsEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

let cachedKeyring: Keyring | null = null;

export function configDir(): string {
  if (process.platform === "win32") {
    const root =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(root, "bluesurf-mcp-node");
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "bluesurf-mcp-node");
}

export function loadStored(
  options: StoreOptions = {},
): readonly [string, string] | null {
  const username = readUsername(configFile(options));
  if (!username) return null;
  const password = keyringOf(options).getPassword(KEYRING_SERVICE, username);
  if (!password) return null;
  return [username, password];
}

export function saveStored(
  username: string,
  password: string,
  options: StoreOptions = {},
): void {
  if (!username || !password) {
    throw new Error("username y password son obligatorios");
  }
  const directory = options.directory ?? configDir();
  const file = path.join(directory, CONFIG_FILENAME);
  const previous = readUsername(file);
  if (previous && previous !== username) {
    forgetPassword(options, previous);
  }

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ username }, null, 2)}\n`,
    "utf8",
  );
  if (process.platform !== "win32") chmodSync(file, 0o600);
  keyringOf(options).setPassword(KEYRING_SERVICE, username, password);
}

export function clearStored(options: StoreOptions = {}): void {
  const file = configFile(options);
  const username = readUsername(file);
  if (username) forgetPassword(options, username);
  if (existsSync(file)) unlinkSync(file);
}

function configFile(options: StoreOptions): string {
  return path.join(options.directory ?? configDir(), CONFIG_FILENAME);
}

function readUsername(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return null;
    }
    const username = (data as { username?: unknown }).username;
    if (typeof username !== "string" || !username) return null;
    return username;
  } catch {
    return null;
  }
}

function forgetPassword(options: StoreOptions, username: string): void {
  try {
    keyringOf(options).deletePassword(KEYRING_SERVICE, username);
  } catch {
    // Borrar es idempotente: si no había secreto, se ignora.
  }
}

function keyringOf(options: StoreOptions): Keyring {
  return options.keyring ?? osKeyring();
}

function osKeyring(): Keyring {
  if (cachedKeyring) return cachedKeyring;
  const require = createRequire(import.meta.url);
  const { Entry } = require("@napi-rs/keyring") as {
    Entry: new (service: string, username: string) => OsEntry;
  };
  cachedKeyring = {
    getPassword(service, username) {
      try {
        return new Entry(service, username).getPassword() || null;
      } catch {
        return null;
      }
    },
    setPassword(service, username, password) {
      new Entry(service, username).setPassword(password);
    },
    deletePassword(service, username) {
      new Entry(service, username).deletePassword();
    },
  };
  return cachedKeyring;
}
