/** Sesión HTTP: cookie en memoria y un reintento ante 401.

Las lecturas usan GET (y un POST de filtro para el kanban). Adjuntar un
archivo y publicar un comentario usan `postMultipart`.
*/

import type { AuthProvider, PublicRequest } from "./auth.js";
import { AuthError } from "./auth.js";
import { DEFAULT_BASE_URL } from "./constants.js";

export type FetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface BinaryBody {
  content: Buffer;
  contentType: string | null;
  headers: Record<string, string>;
}

export interface SessionOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class BlueSurfSession {
  readonly baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: FetchImpl;
  readonly #cookies = new Map<string, string>();
  readonly #abort = new AbortController();
  #auth: AuthProvider | null = null;

  constructor(options: SessionOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetchImpl =
      options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get authenticated(): boolean {
    return this.#auth !== null;
  }

  async login(auth: AuthProvider): Promise<void> {
    await auth.apply(this);
    this.#auth = auth;
  }

  cookie(name: string): string | null {
    return this.#cookies.get(name) ?? null;
  }

  setCookie(name: string, value: string): void {
    this.#cookies.set(name, value);
  }

  async aclose(): Promise<void> {
    this.#abort.abort();
  }

  async getJson(path: string, options?: PublicRequest): Promise<unknown> {
    const response = await this.#request("GET", path, options);
    return response.json() as Promise<unknown>;
  }

  /** POST de solo lectura: consulta con body de filtro (el kanban). No muta estado. */
  async queryJson(
    path: string,
    json: unknown,
    options?: PublicRequest,
  ): Promise<unknown> {
    const response = await this.#request("POST", path, { ...options, json });
    return response.json() as Promise<unknown>;
  }

  async getBytes(path: string, options?: PublicRequest): Promise<BinaryBody> {
    const headers = new Headers(options?.headers);
    headers.set("Accept", "*/*");
    const response = await this.#request("GET", path, { ...options, headers });
    const content = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type");
    const headerMap: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    return { content, contentType, headers: headerMap };
  }

  /** POST multipart. `build` se llama en cada intento, incluido el reintento ante un 401. */
  async postMultipart(path: string, build: () => FormData): Promise<unknown> {
    if (this.#auth === null) {
      throw new AuthError(
        "La sesión no está autenticada: llama a login() primero",
      );
    }

    let response = await this.#send("POST", path, { body: build() });
    if (response.status === 401) {
      await this.#auth.refresh(this);
      response = await this.#send("POST", path, { body: build() });
    }
    if (response.status === 401) {
      throw new AuthError(
        "BlueSurf sigue devolviendo 401 tras renovar la sesión",
      );
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} en POST ${path}`,
      );
    }
    return response.json() as Promise<unknown>;
  }

  async requestPublic(
    method: string,
    path: string,
    options?: PublicRequest,
  ): Promise<Response> {
    return this.#send(method, path, options);
  }

  async #request(
    method: string,
    path: string,
    options?: PublicRequest,
  ): Promise<Response> {
    if (this.#auth === null) {
      throw new AuthError(
        "La sesión no está autenticada: llama a login() primero",
      );
    }

    let response = await this.#send(method, path, options);
    if (response.status === 401) {
      await this.#auth.refresh(this);
      response = await this.#send(method, path, options);
    }
    if (response.status === 401) {
      throw new AuthError(
        "BlueSurf sigue devolviendo 401 tras renovar la sesión",
      );
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} en ${method} ${path}`,
      );
    }
    return response;
  }

  async #send(
    method: string,
    path: string,
    options?: PublicRequest,
  ): Promise<Response> {
    const headers = new Headers(options?.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const cookie = this.#cookieHeader();
    if (cookie) headers.set("Cookie", cookie);

    let body: string | FormData | undefined;
    if (options?.body !== undefined) {
      body = options.body;
    } else if (options?.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs);
    timer.unref();
    try {
      const response = await this.#fetchImpl(
        this.#url(path, options?.params),
        {
          method,
          headers,
          body,
          redirect: "follow",
          signal: AbortSignal.any([timeout.signal, this.#abort.signal]),
        },
      );
      this.#absorbCookies(response);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  #url(path: string, params?: Record<string, string>): string {
    const url = new URL(path.replace(/^\//, ""), `${this.baseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  #cookieHeader(): string {
    return [...this.#cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  #absorbCookies(response: Response): void {
    const lines =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    for (const line of lines) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.#cookies.set(name, value);
    }
  }
}
