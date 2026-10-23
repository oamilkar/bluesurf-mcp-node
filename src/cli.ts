/** Punto de entrada del binario `bluesurf-mcp`.

Sin argumentos arranca el servidor MCP por stdio. `login` y `logout` gestionan
credenciales en el almacén del sistema.
*/

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

import { AuthError, CredentialsAuth } from "./auth.js";
import { BlueSurfClient } from "./client.js";
import { DEFAULT_BASE_URL } from "./constants.js";
import { clearStored, saveStored } from "./credentials-store.js";
import { envValue } from "./env.js";
import { runServer } from "./server.js";

const HELP = `uso: bluesurf-mcp [login|logout]

Sin argumentos arranca el servidor MCP por stdio.

  login   Pide usuario y contraseña, valida contra BlueSurf y los guarda
          en el almacén del sistema (la contraseña no queda en mcp.json).
  logout  Borra las credenciales guardadas.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  ask: (prompt: string) => Promise<string>;
  askPassword: (prompt: string) => Promise<string>;
  env: NodeJS.ProcessEnv;
  verify: (username: string, password: string, baseUrl: string) => Promise<void>;
  save: (username: string, password: string) => void;
  clear: () => void;
}

export async function main(
  argv: string[],
  overrides: Partial<CliIo> = {},
): Promise<number | void> {
  const io = createIo(overrides);
  if (argv.length === 0) {
    await runServer();
    return;
  }
  const command = argv[0] ?? "";
  if (command === "-h" || command === "--help" || command === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (command === "login") return cmdLogin(io);
  if (command === "logout") return cmdLogout(io);
  io.stderr(`comando desconocido: ${command}\n`);
  io.stderr(HELP);
  return 2;
}

export async function cmdLogin(io: CliIo): Promise<number> {
  const username = (await io.ask("Usuario de BlueSurf: ")).trim();
  if (!username) {
    io.stderr("ERROR: el usuario no puede estar vacío.\n");
    return 2;
  }
  const password = await io.askPassword("Contraseña: ");
  if (!password) {
    io.stderr("ERROR: la contraseña no puede estar vacía.\n");
    return 2;
  }

  const baseUrl =
    envValue(io.env, "BLUESURF_BASE_URL", "SURF_BASE_URL") || DEFAULT_BASE_URL;
  io.stdout("Validando contra BlueSurf…\n");
  try {
    await io.verify(username, password, baseUrl);
  } catch (error) {
    if (error instanceof AuthError) {
      io.stderr(`ERROR: login rechazado: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  io.save(username, password);
  io.stdout("Credenciales guardadas en el almacén del sistema.\n");
  io.stdout("En mcp.json no hace falta poner usuario ni contraseña.\n");
  return 0;
}

export function cmdLogout(io: CliIo): number {
  io.clear();
  io.stdout("Credenciales borradas (si había alguna).\n");
  return 0;
}

async function verifyCredentials(
  username: string,
  password: string,
  baseUrl: string,
): Promise<void> {
  const client = new BlueSurfClient({ baseUrl });
  try {
    await client.login(new CredentialsAuth(username, password));
  } finally {
    await client.aclose();
  }
}

function createIo(overrides: Partial<CliIo>): CliIo {
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    ask: askLine,
    askPassword,
    env: process.env,
    verify: verifyCredentials,
    save: (username, password) => {
      saveStored(username, password);
    },
    clear: () => {
      clearStored();
    },
    ...overrides,
  };
}

function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return askLine(prompt);
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let password = "";
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\n" || text === "\r" || text === "\u0004") {
        stdin.setRawMode(false);
        stdin.off("data", onData);
        stdin.pause();
        stdout.write("\n");
        resolve(password);
        return;
      }
      if (text === "\u0003") {
        stdin.setRawMode(false);
        process.exit(130);
      }
      if (text === "\u007f" || text === "\b") {
        password = password.slice(0, -1);
        return;
      }
      if (text.startsWith("\u001b")) return;
      password += text;
    };
    stdin.on("data", onData);
  });
}
