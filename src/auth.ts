/** Autenticación pluggable contra BlueSurf.

El consumidor entrega credenciales o una cookie. La librería no persiste
secretos: la cookie vive solo en memoria durante la vida del cliente.
*/

import { IDENTITY_COOKIE, LOGIN_PATH } from "./constants.js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface PublicRequest {
  json?: unknown;
  params?: Record<string, string>;
  headers?: Headers | Record<string, string>;
  /** Cuerpo multipart. No se serializa a JSON ni se le fija Content-Type. */
  body?: FormData;
}

/** Superficie que un AuthProvider necesita del cliente HTTP. */
export interface AuthClient {
  readonly baseUrl: string;
  cookie(name: string): string | null;
  setCookie(name: string, value: string): void;
  requestPublic(
    method: string,
    path: string,
    options?: PublicRequest,
  ): Promise<Response>;
}

export interface AuthProvider {
  apply(client: AuthClient): Promise<void>;
  refresh(client: AuthClient): Promise<void>;
}

export class CredentialsAuth implements AuthProvider {
  readonly username: string;
  readonly password: string;

  constructor(username: string, password: string) {
    if (!username || !password) {
      throw new Error("username y password son obligatorios");
    }
    this.username = username;
    this.password = password;
  }

  async apply(client: AuthClient): Promise<void> {
    const base = client.baseUrl.replace(/\/+$/, "");
    let response: Response;
    try {
      response = await client.requestPublic("POST", LOGIN_PATH, {
        json: { email: this.username, password: this.password },
        headers: { Origin: base, Referer: `${base}/login` },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AuthError(
        `No se pudo contactar el login de BlueSurf: ${detail}`,
      );
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      throw new AuthError(
        `Login rechazado por BlueSurf (HTTP ${response.status}): revisa usuario/contraseña`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} en POST ${LOGIN_PATH}`,
      );
    }
    if (!client.cookie(IDENTITY_COOKIE)) {
      throw new AuthError(
        `El login respondió 200 pero no llegó la cookie de sesión '${IDENTITY_COOKIE}'`,
      );
    }
  }

  async refresh(client: AuthClient): Promise<void> {
    await this.apply(client);
  }
}

export class CookieAuth implements AuthProvider {
  readonly #cookieValue: string;
  readonly #cookieName: string;

  constructor(cookieValue: string, cookieName: string = IDENTITY_COOKIE) {
    if (!cookieValue) {
      throw new Error("cookie_value es obligatorio");
    }
    this.#cookieValue = cookieValue;
    this.#cookieName = cookieName;
  }

  async apply(client: AuthClient): Promise<void> {
    client.setCookie(this.#cookieName, this.#cookieValue);
  }

  async refresh(_client: AuthClient): Promise<void> {
    throw new AuthError(
      "La cookie provista expiró o fue rechazada. CookieAuth no puede " +
        "renovar la sesión: entrega una cookie fresca (o usa CredentialsAuth).",
    );
  }
}
