import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
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
  files: [
    { id: "img-1", workItemId: "wi-1", isImage: true },
    { id: "doc-1", workItemId: "wi-1", isImage: false },
  ],
};

class CountingAuth implements AuthProvider {
  refreshes = 0;

  async apply(): Promise<void> {}

  async refresh(): Promise<void> {
    this.refreshes += 1;
  }
}

function routes(requestUrl: string, init?: RequestInit): Response {
  const url = new URL(requestUrl);
  const accept = new Headers(init?.headers).get("accept");
  if (url.pathname === "/api/workItem/PROJ-1") {
    assert.equal(accept, "application/json");
    return Response.json(TICKET);
  }
  if (url.pathname === "/api/workItem/wi-1/fileName/img-1") {
    return Response.json("foto.png");
  }
  if (url.pathname === "/api/workItem/wi-1/fileName/doc-1") {
    return new Response("../secreto.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  if (url.pathname === "/api/workItem/wi-1/image/img-1") {
    assert.equal(accept, "*/*");
    return new Response(Buffer.from("PNG"), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }
  if (url.pathname === "/api/workItem/wi-1/file/doc-1") {
    assert.equal(accept, "*/*");
    return new Response(Buffer.from("PDF"), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  }
  return Response.json({ path: url.pathname }, { status: 404 });
}

async function clientContra(fetchImpl: FetchImpl): Promise<BlueSurfClient> {
  const client = new BlueSurfClient({
    baseUrl: "https://surf.test",
    fetchImpl,
  });
  await client.login(new CountingAuth());
  return client;
}

describe("adjuntos", () => {
  it("resuelve nombres y descarga imagen o archivo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-adj-"));
    const client = await clientContra((url, init) =>
      Promise.resolve(routes(url, init)),
    );
    try {
      const adjuntos = await client.listarAdjuntos("PROJ-1");
      assert.deepEqual(
        adjuntos.map((adjunto) => [adjunto.id, adjunto.name, adjunto.is_image]),
        [
          ["img-1", "foto.png", true],
          ["doc-1", "../secreto.txt", false],
        ],
      );

      const guardados = await client.descargarAdjuntos("PROJ-1", dir);
      const porId = new Map(guardados.map((archivo) => [archivo.id, archivo]));
      const imagen = porId.get("img-1");
      const documento = porId.get("doc-1");
      assert.ok(imagen);
      assert.ok(documento);

      assert.deepEqual(imagen.content, Buffer.from("PNG"));
      assert.equal(imagen.content_type, "image/png");
      assert.equal(path.basename(imagen.path ?? ""), "foto.png");
      assert.deepEqual(await readFile(imagen.path ?? ""), Buffer.from("PNG"));

      assert.equal(documento.name, "secreto.txt");
      assert.deepEqual(documento.content, Buffer.from("PDF"));
      const destino = documento.path ?? "";
      assert.equal(path.basename(destino), "secreto.txt");
      assert.equal(path.resolve(path.dirname(destino)), path.resolve(dir));
      assert.deepEqual(await readFile(destino), Buffer.from("PDF"));
      assert.equal(path.resolve(destino), path.resolve(dir, "secreto.txt"));
    } finally {
      await client.aclose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("añade el id si el nombre ya existe", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-dup-"));
    await writeFile(path.join(dir, "foto.png"), "viejo");
    const client = await clientContra((url, init) =>
      Promise.resolve(routes(url, init)),
    );
    try {
      const guardados = await client.descargarAdjuntos("PROJ-1", dir, {
        archivoId: "img-1",
      });
      assert.equal(guardados.length, 1);
      const imagen = guardados[0];
      assert.ok(imagen);
      assert.equal(imagen.name, "foto-img-1.png");
      assert.equal(
        path.resolve(imagen.path ?? ""),
        path.resolve(dir, "foto-img-1.png"),
      );
      assert.equal(await readFile(path.join(dir, "foto.png"), "utf8"), "viejo");
    } finally {
      await client.aclose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reintenta una vez ante 401", async () => {
    let calls = 0;
    const auth = new CountingAuth();
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: (_url, init) => {
        calls += 1;
        assert.equal(new Headers(init?.headers).get("accept"), "*/*");
        if (calls === 1) return Promise.resolve(new Response(null, { status: 401 }));
        return Promise.resolve(
          new Response(Buffer.from("ok"), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
        );
      },
    });
    await session.login(auth);
    try {
      const body = await session.getBytes("/api/workItem/wi-1/file/doc-1");
      assert.deepEqual(body.content, Buffer.from("ok"));
      assert.equal(body.contentType, "application/pdf");
      assert.equal(auth.refreshes, 1);
      assert.equal(calls, 2);
    } finally {
      await session.aclose();
    }
  });

  it("no reintenta más de una vez", async () => {
    const auth = new CountingAuth();
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: () => Promise.resolve(new Response(null, { status: 401 })),
    });
    await session.login(auth);
    try {
      await assert.rejects(
        () => session.getBytes("/api/workItem/wi-1/file/doc-1"),
        AuthError,
      );
      assert.equal(auth.refreshes, 1);
    } finally {
      await session.aclose();
    }
  });

  it("exige login antes de leer", async () => {
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: () => Promise.resolve(Response.json({})),
    });
    await assert.rejects(
      () => session.getJson("/api/instance/currentUser"),
      /login\(\)/,
    );
  });
});
