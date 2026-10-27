import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { AuthError, type AuthProvider } from "../src/auth.js";
import { BlueSurfClient } from "../src/client.js";
import type { FetchImpl } from "../src/session.js";
import { BlueSurfSession } from "../src/session.js";

const TICKET = {
  id: "wi-1",
  code: "PROJ-1",
  files: [{ id: "doc-1", workItemId: "wi-1", isImage: false }],
  comments: [{ id: "c-old", comment: "viejo", createdByFullName: "Ana" }],
};

const TRAS_ARCHIVO = {
  ...TICKET,
  files: [
    ...TICKET.files,
    { id: "doc-2", workItemId: "wi-1", isImage: false, name: "nota.txt" },
  ],
};

const TRAS_COMENTARIO = {
  ...TICKET,
  comments: [
    ...TICKET.comments,
    {
      id: "c-new",
      comment: "<p>hola &lt; b</p>",
      createdByFullName: "Ana",
      createdAt: "2026-10-27T00:00:00",
    },
  ],
};

class CountingAuth implements AuthProvider {
  refreshes = 0;

  async apply(): Promise<void> {}

  async refresh(): Promise<void> {
    this.refreshes += 1;
  }
}

async function clientContra(
  fetchImpl: FetchImpl,
  auth: CountingAuth = new CountingAuth(),
): Promise<{ client: BlueSurfClient; auth: CountingAuth }> {
  const client = new BlueSurfClient({
    baseUrl: "https://surf.test",
    fetchImpl,
  });
  await client.login(auth);
  return { client, auth };
}

describe("escrituras", () => {
  it("adjunta el nombre del archivo y devuelve el nuevo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-up-"));
    const origen = path.join(dir, "subdir", "nota.txt");
    await mkdir(path.dirname(origen), { recursive: true });
    await writeFile(origen, "hola <binario>");
    const metodos: string[] = [];

    const { client } = await clientContra(async (url, init) => {
      const parsed = new URL(url);
      metodos.push(init?.method ?? "GET");
      if (init?.method !== "POST" && parsed.pathname === "/api/workItem/PROJ-1") {
        return Response.json(TICKET);
      }
      assert.equal(init?.method, "POST");
      assert.equal(parsed.pathname, "/api/workItem/wi-1/file");
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      const form = init?.body;
      assert.ok(form instanceof FormData);
      const file = form.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.name, "nota.txt");
      assert.equal(file.type, "text/plain");
      assert.equal(await file.text(), "hola <binario>");
      assert.equal(form.get("comment"), null);
      return Response.json(TRAS_ARCHIVO);
    });

    try {
      const adjunto = await client.adjuntarArchivo("PROJ-1", origen);
      assert.deepEqual(
        { id: adjunto.id, name: adjunto.name, is_image: adjunto.is_image },
        { id: "doc-2", name: "nota.txt", is_image: false },
      );
      assert.deepEqual(metodos, ["GET", "POST"]);
    } finally {
      await client.aclose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("envuelve el comentario en un párrafo escapado", async () => {
    const { client } = await clientContra(async (url, init) => {
      const parsed = new URL(url);
      if (init?.method !== "POST" && parsed.pathname === "/api/workItem/PROJ-1") {
        return Response.json(TICKET);
      }
      assert.equal(parsed.pathname, "/api/WorkItem/wi-1/comment");
      const form = init?.body;
      assert.ok(form instanceof FormData);
      assert.equal(
        form.get("comment"),
        '{"comment":"<p>hola &lt; b</p>"}',
      );
      assert.equal(typeof form.get("comment"), "string");
      return Response.json(TRAS_COMENTARIO);
    });

    try {
      const comentario = await client.agregarComentario("PROJ-1", "  hola < b  ");
      assert.deepEqual(
        {
          id: comentario.id,
          author: comentario.author,
          body: comentario.body,
          created_at: comentario.created_at,
        },
        {
          id: "c-new",
          author: "Ana",
          body: "<p>hola &lt; b</p>",
          created_at: "2026-10-27T00:00:00",
        },
      );
    } finally {
      await client.aclose();
    }
  });

  it("reintenta el multipart una vez ante 401", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-up401-"));
    const origen = path.join(dir, "nota.txt");
    await writeFile(origen, "hola");
    let posts = 0;
    const auth = new CountingAuth();
    const { client } = await clientContra(async (url, init) => {
      const parsed = new URL(url);
      if (init?.method !== "POST" && parsed.pathname === "/api/workItem/PROJ-1") {
        return Response.json(TICKET);
      }
      posts += 1;
      const form = init?.body;
      assert.ok(form instanceof FormData);
      const file = form.get("file");
      assert.ok(file instanceof File);
      assert.equal(await file.text(), "hola");
      if (posts === 1) return new Response(null, { status: 401 });
      return Response.json(TRAS_ARCHIVO);
    }, auth);

    try {
      const adjunto = await client.adjuntarArchivo("PROJ-1", origen);
      assert.equal(posts, 2);
      assert.equal(auth.refreshes, 1);
      assert.equal(adjunto.id, "doc-2");
    } finally {
      await client.aclose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no reintenta el multipart más de una vez", async () => {
    let posts = 0;
    const auth = new CountingAuth();
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: () => {
        posts += 1;
        return Promise.resolve(new Response(null, { status: 401 }));
      },
    });
    await session.login(auth);
    await assert.rejects(
      () =>
        session.postMultipart("/api/workItem/wi-1/file", () => {
          const form = new FormData();
          form.append("file", new Blob(["hola"], { type: "text/plain" }), "nota.txt");
          return form;
        }),
      AuthError,
    );
    assert.equal(posts, 2);
    assert.equal(auth.refreshes, 1);
    await session.aclose();
  });
});
