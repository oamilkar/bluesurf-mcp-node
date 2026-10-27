/** Servidor MCP local para tickets de BlueSurf.

Adaptador delgado: lee tickets y, además, adjunta un archivo y publica un
comentario. La cookie de sesión vive en memoria mientras corre el proceso.
La contraseña, si hace falta, sale del almacén del sistema (servicio
`bluesurf-mcp-node`) o de las variables de entorno.
*/

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { AuthProvider } from "./auth.js";
import { CookieAuth, CredentialsAuth } from "./auth.js";
import { BlueSurfClient } from "./client.js";
import { DEFAULT_BASE_URL } from "./constants.js";
import { loadStored } from "./credentials-store.js";
import { envValue } from "./env.js";
import {
  ticketToDict,
  type Attachment,
  type Comment,
  type DownloadedFile,
  type Ticket,
} from "./models.js";

export interface SurfClient {
  misProyectos(): Promise<Record<string, unknown>[]>;
  misTickets(
    project: string,
    options?: { includeClosed?: boolean },
  ): Promise<Ticket[]>;
  obtenerTicket(code: string): Promise<Ticket>;
  listarAdjuntos(code: string): Promise<Attachment[]>;
  descargarAdjuntos(
    code: string,
    destino?: string | null,
    options?: { archivoId?: string | null },
  ): Promise<DownloadedFile[]>;
  adjuntarArchivo(code: string, ruta: string): Promise<Attachment>;
  agregarComentario(code: string, texto: string): Promise<Comment>;
  aclose(): Promise<void>;
}

const AUTH_ERROR =
  "Falta configuración de autenticación: corre `bluesurf-mcp login`, " +
  "o define BLUESURF_COOKIE, o bien BLUESURF_USERNAME y BLUESURF_PASSWORD.";

export function buildAuth(
  env: NodeJS.ProcessEnv = process.env,
  load: () => readonly [string, string] | null = () => loadStored(),
): AuthProvider {
  const cookie = envValue(env, "BLUESURF_COOKIE", "SURF_COOKIE");
  if (cookie) return new CookieAuth(cookie);

  const username = envValue(env, "BLUESURF_USERNAME", "SURF_USERNAME");
  const password = envValue(env, "BLUESURF_PASSWORD", "SURF_PASSWORD");
  if (username && password) return new CredentialsAuth(username, password);

  const stored = load();
  if (stored) return new CredentialsAuth(stored[0], stored[1]);

  throw new Error(AUTH_ERROR);
}

export function baseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return envValue(env, "BLUESURF_BASE_URL", "SURF_BASE_URL") || DEFAULT_BASE_URL;
}

async function defaultOpenClient(): Promise<SurfClient> {
  const client = new BlueSurfClient({ baseUrl: baseUrlFromEnv() });
  await client.login(buildAuth());
  return client;
}

let openClient: () => Promise<SurfClient> = defaultOpenClient;

export function setClientFactory(factory: () => Promise<SurfClient>): void {
  openClient = factory;
}

export function resetClientFactory(): void {
  openClient = defaultOpenClient;
}

async function usingClient<T>(
  fn: (client: SurfClient) => Promise<T>,
): Promise<T> {
  const client = await openClient();
  try {
    return await fn(client);
  } finally {
    await client.aclose();
  }
}

export async function misProyectos(): Promise<Record<string, unknown>[]> {
  return usingClient(async (client) => {
    const proyectos = await client.misProyectos();
    return proyectos.map((project) => ({
      id: project.id ?? null,
      smallCode: project.smallCode ?? null,
      code: project.code ?? null,
      name: project.name ?? null,
    }));
  });
}

export async function buscarMisTickets(
  project: string,
  includeClosed = false,
): Promise<Record<string, unknown>[]> {
  return usingClient(async (client) => {
    const tickets = await client.misTickets(project, { includeClosed });
    return tickets.map(ticketToDict);
  });
}

export async function obtenerTicket(
  code: string,
): Promise<Record<string, unknown>> {
  return usingClient(async (client) => ticketToDict(await client.obtenerTicket(code)));
}

export async function listarAdjuntos(code: string): Promise<
  Array<{ id: string; name: string | null; is_image: boolean }>
> {
  return usingClient(async (client) => {
    const adjuntos = await client.listarAdjuntos(code);
    return adjuntos.map((adjunto) => ({
      id: adjunto.id,
      name: adjunto.name,
      is_image: adjunto.is_image,
    }));
  });
}

export async function descargarAdjuntos(
  code: string,
  destino: string,
  archivoId?: string | null,
): Promise<
  Array<{
    id: string;
    name: string;
    path: string | null;
    content_type: string | null;
    size: number;
  }>
> {
  return usingClient(async (client) => {
    const archivos = await client.descargarAdjuntos(
      code,
      destino,
      archivoId != null ? { archivoId } : undefined,
    );
    return archivos.map((archivo) => ({
      id: archivo.id,
      name: archivo.name,
      path: archivo.path,
      content_type: archivo.content_type,
      size: archivo.content.length,
    }));
  });
}

export async function adjuntarArchivo(
  code: string,
  ruta: string,
): Promise<{ id: string; name: string | null; is_image: boolean }> {
  return usingClient(async (client) => {
    const adjunto = await client.adjuntarArchivo(code, ruta);
    return {
      id: adjunto.id,
      name: adjunto.name,
      is_image: adjunto.is_image,
    };
  });
}

export async function agregarComentario(
  code: string,
  texto: string,
): Promise<{
  id: string;
  author: string | null;
  body: string | null;
  created_at: string | null;
}> {
  return usingClient(async (client) => {
    const comentario = await client.agregarComentario(code, texto);
    return {
      id: comentario.id,
      author: comentario.author,
      body: comentario.body,
      created_at: comentario.created_at,
    };
  });
}

function jsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "bluesurf", version: "0.3.0" });
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "mis_proyectos",
    {
      description:
        'Lista los proyectos del usuario (id, smallCode, code, name). El smallCode (p. ej. "PROJ") es lo que se pasa a buscar_mis_tickets.',
      annotations: readOnly,
    },
    async () => jsonText(await misProyectos()),
  );

  server.registerTool(
    "buscar_mis_tickets",
    {
      description:
        "Lista los tickets asignados al usuario en un proyecto de BlueSurf.",
      inputSchema: {
        project: z
          .string()
          .describe(
            'smallCode del proyecto (p. ej. "PROJ"), prefijo de los códigos de ticket (PROJ-123). Usa mis_proyectos para descubrirlo.',
          ),
        include_closed: z
          .boolean()
          .optional()
          .describe(
            "Si es true incluye tickets en estados finales; por defecto solo los abiertos.",
          ),
      },
      annotations: readOnly,
    },
    async ({ project, include_closed }) =>
      jsonText(await buscarMisTickets(project, include_closed ?? false)),
  );

  server.registerTool(
    "obtener_ticket",
    {
      description:
        "Devuelve el detalle de un ticket de BlueSurf por su código (p. ej. PROJ-123).",
      inputSchema: {
        code: z.string().describe("Código del ticket, por ejemplo PROJ-123."),
      },
      annotations: readOnly,
    },
    async ({ code }) => jsonText(await obtenerTicket(code)),
  );

  server.registerTool(
    "listar_adjuntos",
    {
      description:
        "Lista los archivos de la sección Files de un ticket, sin descargarlos.",
      inputSchema: {
        code: z.string().describe("Código del ticket, por ejemplo PROJ-123."),
      },
      annotations: readOnly,
    },
    async ({ code }) => jsonText(await listarAdjuntos(code)),
  );

  server.registerTool(
    "descargar_adjuntos",
    {
      description:
        "Descarga los adjuntos de un ticket a una carpeta local. Con archivo_id descarga solo uno; si no, todos.",
      inputSchema: {
        code: z.string().describe("Código del ticket, por ejemplo PROJ-123."),
        destino: z
          .string()
          .describe(
            "Directorio donde se guardan los archivos. Se crea si no existe.",
          ),
        archivo_id: z
          .string()
          .optional()
          .describe("Si se indica, descarga solo ese adjunto."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ code, destino, archivo_id }) =>
      jsonText(await descargarAdjuntos(code, destino, archivo_id)),
  );

  const writes = { readOnlyHint: false, destructiveHint: false };

  server.registerTool(
    "adjuntar_archivo",
    {
      description:
        "Adjunta un archivo local a un ticket de BlueSurf. Se sube solo el nombre, sin directorios.",
      inputSchema: {
        code: z.string().describe("Código del ticket, por ejemplo PROJ-123."),
        ruta: z.string().describe("Ruta local del archivo a subir."),
      },
      annotations: writes,
    },
    async ({ code, ruta }) => jsonText(await adjuntarArchivo(code, ruta)),
  );

  server.registerTool(
    "agregar_comentario",
    {
      description:
        "Publica un comentario en un ticket de BlueSurf. El texto se escapa y se envuelve en un párrafo HTML.",
      inputSchema: {
        code: z.string().describe("Código del ticket, por ejemplo PROJ-123."),
        texto: z.string().describe("Comentario en texto plano."),
      },
      annotations: writes,
    },
    async ({ code, texto }) => jsonText(await agregarComentario(code, texto)),
  );

  return server;
}

export async function runServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
