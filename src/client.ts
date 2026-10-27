/** Cliente de BlueSurf.

Expone los tickets asignados al usuario. No hay endpoint "asignados a mí":
se consulta el kanban del proyecto con el filtro `assignedTo` en el id del
usuario actual. También adjunta un archivo y publica un comentario.
*/

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthProvider } from "./auth.js";
import { IDENTITY_COOKIE } from "./constants.js";
import {
  attachmentFromJson,
  commentsOf,
  isRecord,
  ticketFromJson,
  userFromCurrentUser,
  type Attachment,
  type Comment,
  type DownloadedFile,
  type Ticket,
  type User,
} from "./models.js";
import {
  BlueSurfSession,
  type FetchImpl,
  type SessionOptions,
} from "./session.js";

const PATH_CURRENT_USER = "/api/instance/currentUser";
const PATH_MY_PROJECTS = "/api/user/current/project";
const PATH_KANBAN = "/api/project/{project}/kanban";
const PATH_WORKITEM = "/api/workItem/{code}";
const PATH_FILE_NAME = "/api/workItem/{work_item_id}/fileName/{file_id}";
const PATH_FILE = "/api/workItem/{work_item_id}/file/{file_id}";
const PATH_IMAGE = "/api/workItem/{work_item_id}/image/{file_id}";
const PATH_UPLOAD = "/api/workItem/{work_item_id}/file";
const PATH_COMMENT = "/api/WorkItem/{work_item_id}/comment";

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

export class BlueSurfClient {
  readonly #session: BlueSurfSession;
  #currentUser: User | null = null;

  constructor(options: ClientOptions = {}) {
    const sessionOptions: SessionOptions = {
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    };
    this.#session = new BlueSurfSession(sessionOptions);
  }

  async login(auth: AuthProvider): Promise<this> {
    await this.#session.login(auth);
    return this;
  }

  get authenticated(): boolean {
    return this.#session.authenticated;
  }

  sessionCookie(name: string = IDENTITY_COOKIE): string | null {
    return this.#session.cookie(name);
  }

  async aclose(): Promise<void> {
    await this.#session.aclose();
  }

  async currentUser(): Promise<User> {
    if (this.#currentUser === null) {
      const data = await this.#session.getJson(PATH_CURRENT_USER);
      if (!isRecord(data)) {
        throw new Error("currentUser no devolvió un objeto");
      }
      this.#currentUser = userFromCurrentUser(data);
    }
    return this.#currentUser;
  }

  /** Proyectos del usuario, tal como los devuelve la API. */
  async misProyectos(): Promise<Record<string, unknown>[]> {
    const data = await this.#session.getJson(PATH_MY_PROJECTS);
    if (!Array.isArray(data)) return [];
    return data.filter(isRecord);
  }

  async misTickets(
    project: string,
    options?: { includeClosed?: boolean },
  ): Promise<Ticket[]> {
    const includeClosed = options?.includeClosed ?? false;
    const me = await this.currentUser();
    const data = await this.#session.queryJson(
      fill(PATH_KANBAN, { project }),
      kanbanFilter(me.id),
      { params: { skipWorkItems: "false" } },
    );

    const tickets: Ticket[] = [];
    for (const raw of iterWorkItems(data)) {
      const ticket = ticketFromJson(raw);
      if (ticket.assignee === null || ticket.assignee.id !== me.id) continue;
      if (!includeClosed && ticket.status_is_final) continue;
      tickets.push(ticket);
    }
    return tickets;
  }

  async obtenerTicket(code: string): Promise<Ticket> {
    const data = await this.#session.getJson(fill(PATH_WORKITEM, { code }));
    if (!isRecord(data)) {
      throw new Error(`El ticket ${code} no devolvió un objeto`);
    }
    return ticketFromJson(data);
  }

  async listarAdjuntos(code: string): Promise<Attachment[]> {
    const ticket = await this.obtenerTicket(code);
    const files = ticket.raw.files;
    if (!Array.isArray(files)) return [];

    const adjuntos: Attachment[] = [];
    for (const raw of files) {
      if (!isRecord(raw)) continue;
      const adjunto = attachmentFromJson(raw);
      if (!adjunto.work_item_id) adjunto.work_item_id = ticket.id;
      adjunto.name = await this.#nombreAdjunto(adjunto.work_item_id, adjunto.id);
      adjuntos.push(adjunto);
    }
    return adjuntos;
  }

  async descargarAdjunto(
    code: string,
    archivoId: string,
    destino?: string | null,
  ): Promise<DownloadedFile> {
    const guardados = await this.descargarAdjuntos(code, destino, {
      archivoId,
    });
    const archivo = guardados[0];
    if (!archivo) {
      throw new Error(
        `El ticket ${code} no tiene un adjunto con id ${archivoId}`,
      );
    }
    return archivo;
  }

  async descargarAdjuntos(
    code: string,
    destino?: string | null,
    options?: { archivoId?: string | null },
  ): Promise<DownloadedFile[]> {
    let adjuntos = await this.listarAdjuntos(code);
    const archivoId = options?.archivoId;
    if (archivoId != null) {
      adjuntos = adjuntos.filter((adjunto) => adjunto.id === archivoId);
      if (adjuntos.length === 0) {
        throw new Error(
          `El ticket ${code} no tiene un adjunto con id ${archivoId}`,
        );
      }
    }

    if (destino != null) {
      await mkdir(destino, { recursive: true });
    }

    const descargados: DownloadedFile[] = [];
    for (const adjunto of adjuntos) {
      descargados.push(await this.#bajarAdjunto(adjunto, destino ?? null));
    }
    return descargados;
  }

  /** Sube un archivo local. El POST va al id del work item, no al código. */
  async adjuntarArchivo(code: string, ruta: string): Promise<Attachment> {
    const ticket = await this.obtenerTicket(code);
    if (!ticket.id) throw new Error(`El ticket ${code} no tiene id`);
    const previos = idsDeArchivos(ticket);
    const contenido = await leerArchivo(ruta);
    const nombre = nombreSeguro(path.basename(ruta), path.basename(ruta));
    const tipo = contentTypeFor(nombre);
    const data = await this.#session.postMultipart(
      fill(PATH_UPLOAD, { work_item_id: ticket.id }),
      () => {
        const form = new FormData();
        form.append("file", new Blob([contenido], { type: tipo }), nombre);
        return form;
      },
    );
    return adjuntoNuevo(data, previos, nombre, ticket.id);
  }

  /** Publica un comentario. El texto se escapa y se envuelve en `<p>`. */
  async agregarComentario(code: string, texto: string): Promise<Comment> {
    const limpio = texto.trim();
    if (!limpio) throw new Error("El comentario está vacío");
    const ticket = await this.obtenerTicket(code);
    if (!ticket.id) throw new Error(`El ticket ${code} no tiene id`);
    const previos = new Set(
      commentsOf(ticket)
        .map((item) => item.id)
        .filter((id) => id),
    );
    const payload = JSON.stringify({
      comment: `<p>${escapeHtml(limpio)}</p>`,
    });
    const data = await this.#session.postMultipart(
      fill(PATH_COMMENT, { work_item_id: ticket.id }),
      () => {
        const form = new FormData();
        form.append("comment", payload);
        return form;
      },
    );
    return comentarioNuevo(data, previos);
  }

  async #nombreAdjunto(
    workItemId: string,
    fileId: string,
  ): Promise<string | null> {
    const body = await this.#session.getBytes(
      fill(PATH_FILE_NAME, { work_item_id: workItemId, file_id: fileId }),
    );
    return parseFileName(body.content, body.contentType) || null;
  }

  async #bajarAdjunto(
    adjunto: Attachment,
    destino: string | null,
  ): Promise<DownloadedFile> {
    const template = adjunto.is_image ? PATH_IMAGE : PATH_FILE;
    const body = await this.#session.getBytes(
      fill(template, {
        work_item_id: adjunto.work_item_id,
        file_id: adjunto.id,
      }),
    );
    const nombre = nombreSeguro(adjunto.name, adjunto.id);
    let ruta: string | null = null;
    if (destino !== null) {
      ruta = rutaDestino(destino, nombre, adjunto.id);
      await writeFile(ruta, body.content);
    }
    return {
      id: adjunto.id,
      name: ruta !== null ? path.basename(ruta) : nombre,
      content_type: body.contentType,
      content: body.content,
      path: ruta,
    };
  }
}

async function leerArchivo(ruta: string): Promise<Buffer> {
  try {
    return await readFile(ruta);
  } catch (error) {
    if (isEnoent(error)) throw new Error(`No existe el archivo ${ruta}`);
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function idsDeArchivos(ticket: Ticket): Set<string> {
  const files = ticket.raw.files;
  const ids = new Set<string>();
  if (!Array.isArray(files)) return ids;
  for (const raw of files) {
    if (isRecord(raw) && raw.id != null && String(raw.id)) {
      ids.add(String(raw.id));
    }
  }
  return ids;
}

function adjuntoNuevo(
  data: unknown,
  previos: Set<string>,
  nombre: string,
  workItemId: string,
): Attachment {
  const ticket = ticketDeRespuesta(data);
  const files = ticket.raw.files;
  const nuevos: Attachment[] = [];
  if (Array.isArray(files)) {
    for (const raw of files) {
      if (!isRecord(raw)) continue;
      const adjunto = attachmentFromJson(raw);
      if (!adjunto.id || previos.has(adjunto.id)) continue;
      if (!adjunto.name) adjunto.name = nombre;
      if (!adjunto.work_item_id) adjunto.work_item_id = workItemId;
      nuevos.push(adjunto);
    }
  }
  const nuevo = nuevos.at(-1);
  if (!nuevo) throw new Error("BlueSurf no devolvió el archivo nuevo");
  return nuevo;
}

function comentarioNuevo(data: unknown, previos: Set<string>): Comment {
  const nuevos = commentsOf(ticketDeRespuesta(data)).filter(
    (item) => item.id && !previos.has(item.id),
  );
  const nuevo = nuevos.at(-1);
  if (!nuevo) throw new Error("BlueSurf no devolvió el comentario nuevo");
  return nuevo;
}

function ticketDeRespuesta(data: unknown): Ticket {
  if (!isRecord(data)) throw new Error("BlueSurf no devolvió el work item");
  return ticketFromJson(data);
}

/** Misma sustitución que `html.escape` de Python. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const MIME_POR_EXTENSION: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".json": "application/json",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function contentTypeFor(filename: string): string {
  return (
    MIME_POR_EXTENSION[path.extname(filename).toLowerCase()] ??
    "application/octet-stream"
  );
}

function kanbanFilter(userId: string): Record<string, unknown> {
  return {
    statuses: [],
    tags: [],
    sprints: [],
    priorities: [],
    assignedTo: [userId],
    reportedBy: [],
    colors: [],
    defectsOrigins: [],
    tagCondition: "and",
    search: "",
    quantityPerStatus: [],
  };
}

function iterWorkItems(kanban: unknown): Record<string, unknown>[] {
  if (!Array.isArray(kanban)) return [];
  const items: Record<string, unknown>[] = [];
  for (const branch of kanban) {
    if (!isRecord(branch) || !Array.isArray(branch.statuses)) continue;
    for (const status of branch.statuses) {
      if (!isRecord(status) || !Array.isArray(status.workItems)) continue;
      for (const workItem of status.workItems) {
        if (isRecord(workItem)) items.push(workItem);
      }
    }
  }
  return items;
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Falta el parámetro ${key} en ${template}`);
    }
    return value;
  });
}

/** El endpoint fileName responde texto plano o un string JSON. */
function parseFileName(content: Buffer, contentType: string | null): string {
  const text = stripNulls(content.toString("utf8").replace(/^\uFEFF/, "").trim());
  if (!text) return "";
  const looksJson =
    text.startsWith('"') ||
    text.startsWith("{") ||
    text.startsWith("[") ||
    (contentType !== null && contentType.toLowerCase().includes("json"));
  if (!looksJson) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed.trim();
    if (isRecord(parsed)) {
      for (const key of ["name", "fileName", "filename"] as const) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  } catch {
    return text;
  }
  return text;
}

function stripNulls(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 0) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 0) end -= 1;
  return value.slice(start, end);
}

/** Solo el nombre de archivo: descarta directorios. */
function nombreSeguro(name: string | null, archivoId: string): string {
  const candidate = path.basename(name ?? "").trim().replace(/\.+$/u, "");
  if (!candidate || candidate === "." || candidate === "..") return archivoId;
  return candidate;
}

/** Ruta dentro de `destino`. Si el nombre ya existe, le añade el id. */
function rutaDestino(destino: string, nombre: string, archivoId: string): string {
  const root = path.resolve(destino);
  let filename = nombreSeguro(nombre, archivoId);
  let candidate = path.resolve(root, filename);
  if (!isInside(root, candidate)) {
    filename = archivoId;
    candidate = path.resolve(root, filename);
  }
  if (existsSync(candidate)) {
    const parsed = path.parse(filename);
    candidate = path.resolve(root, `${parsed.name}-${archivoId}${parsed.ext}`);
  }
  return candidate;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
