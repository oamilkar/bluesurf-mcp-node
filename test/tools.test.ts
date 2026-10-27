import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import type { Attachment, Comment, DownloadedFile } from "../src/models.js";
import {
  agregarComentario,
  adjuntarArchivo,
  buscarMisTickets,
  descargarAdjuntos,
  listarAdjuntos,
  misProyectos,
  resetClientFactory,
  setClientFactory,
  type SurfClient,
} from "../src/server.js";

describe("tools MCP", () => {
  afterEach(() => {
    resetClientFactory();
  });

  it("mis_proyectos devuelve solo id, smallCode, code y name", async () => {
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async misProyectos() {
          return [
            {
              id: "1",
              smallCode: "PROJ",
              code: "P",
              name: "Proyecto",
              extra: "no",
            },
          ];
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    assert.deepEqual(await misProyectos(), [
      { id: "1", smallCode: "PROJ", code: "P", name: "Proyecto" },
    ]);
  });

  it("buscar_mis_tickets reenvía include_closed", async () => {
    let seen: { project?: string; includeClosed?: boolean } = {};
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async misTickets(project, options) {
          seen = { project, includeClosed: options?.includeClosed };
          return [];
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    assert.deepEqual(await buscarMisTickets("PROJ", true), []);
    assert.deepEqual(seen, { project: "PROJ", includeClosed: true });
  });

  it("listar_adjuntos no incluye bytes", async () => {
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async listarAdjuntos(code) {
          assert.equal(code, "PROJ-1");
          const adjunto: Attachment = {
            id: "f1",
            work_item_id: "wi-1",
            name: "nota.txt",
            is_image: false,
            raw: {},
          };
          return [adjunto];
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    assert.deepEqual(await listarAdjuntos("PROJ-1"), [
      { id: "f1", name: "nota.txt", is_image: false },
    ]);
  });

  it("descargar_adjuntos devuelve la ruta y el tamaño", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bluesurf-tool-"));
    try {
      setClientFactory(async () => {
        const fake: Partial<SurfClient> = {
          async descargarAdjuntos(code, destino, options) {
            assert.equal(code, "PROJ-1");
            assert.equal(destino, dir);
            assert.equal(options?.archivoId ?? null, null);
            const ruta = path.join(dir, "nota.txt");
            const content = Buffer.from("hola");
            const archivo: DownloadedFile = {
              id: "f1",
              name: "nota.txt",
              content_type: "text/plain",
              content,
              path: ruta,
            };
            return [archivo];
          },
          async aclose() {},
        };
        return fake as SurfClient;
      });

      writeFileSync(path.join(dir, "nota.txt"), "hola");
      assert.deepEqual(await descargarAdjuntos("PROJ-1", dir), [
        {
          id: "f1",
          name: "nota.txt",
          path: path.join(dir, "nota.txt"),
          content_type: "text/plain",
          size: 4,
        },
      ]);
      assert.equal(readFileSync(path.join(dir, "nota.txt"), "utf8"), "hola");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adjuntar_archivo devuelve el archivo nuevo", async () => {
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async adjuntarArchivo(code, ruta) {
          assert.equal(code, "PROJ-1");
          assert.equal(ruta, "C:/tmp/nota.txt");
          const adjunto: Attachment = {
            id: "doc-2",
            work_item_id: "wi-1",
            name: "nota.txt",
            is_image: false,
            raw: {},
          };
          return adjunto;
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    assert.deepEqual(await adjuntarArchivo("PROJ-1", "C:/tmp/nota.txt"), {
      id: "doc-2",
      name: "nota.txt",
      is_image: false,
    });
  });

  it("agregar_comentario devuelve el comentario nuevo", async () => {
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async agregarComentario(code, texto) {
          assert.equal(code, "PROJ-1");
          assert.equal(texto, "hola");
          const comentario: Comment = {
            id: "c-new",
            author: "Ana",
            body: "<p>hola</p>",
            created_at: "2026-10-27T00:00:00",
            raw: {},
          };
          return comentario;
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    assert.deepEqual(await agregarComentario("PROJ-1", "hola"), {
      id: "c-new",
      author: "Ana",
      body: "<p>hola</p>",
      created_at: "2026-10-27T00:00:00",
    });
  });
});
