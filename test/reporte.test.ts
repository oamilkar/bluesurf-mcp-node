import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthProvider } from "../src/auth.js";
import { BlueSurfClient } from "../src/client.js";
import type { FetchImpl } from "../src/session.js";
import { BlueSurfSession } from "../src/session.js";
import {
  listarCategorias,
  miReporteDiario,
  proyectosReporte,
  registrarTiempo,
  resetClientFactory,
  setClientFactory,
  type SurfClient,
} from "../src/server.js";
import type { ReporteDiario } from "../src/models.js";

const FECHA = "2026-10-13";

const PROYECTOS = [
  {
    id: "p-rwsg",
    smallCode: "RWSG2",
    code: "WSG",
    name: "WSG Rewrite",
    status: 1,
    categories: [{ categoryId: "cat-dev" }],
  },
  {
    id: "p-off",
    smallCode: "OFF",
    code: "OFF",
    name: "Inactivo",
    status: 0,
    categories: [],
  },
];

const CATEGORIAS = [
  {
    id: "sub-gc",
    name: "Google Calendar",
    categoryId: "cat-google",
    categoryName: "Google",
  },
  {
    id: "sub-code",
    name: "Construcción / Codificación",
    categoryId: "cat-dev",
    categoryName: "Desarrollo",
  },
  {
    id: "sub-gen-g",
    name: "General",
    categoryId: "cat-ges",
    categoryName: "Gestión",
  },
  {
    id: "sub-gen-o",
    name: "General",
    categoryId: "cat-otro",
    categoryName: "Otro",
  },
];

const PREVIO = {
  id: "eff-1",
  description: "Daily",
  executed: 0.25,
  projectId: "p-rwsg",
  categoryId: "cat-google",
  subcategoryId: "sub-gc",
  reporterId: "user-1",
};

const TICKET = {
  id: "wi-9",
  code: "RWSG2-9",
  projectId: "p-rwsg",
  name: "Tarea",
};

class NoopAuth implements AuthProvider {
  async apply(): Promise<void> {}
  async refresh(): Promise<void> {}
}

function reporte(status: number, efforts: unknown[]) {
  const horas = efforts.reduce<number>((sum, effort) => {
    const executed =
      effort && typeof effort === "object" && "executed" in effort
        ? Number(effort.executed)
        : 0;
    return sum + executed;
  }, 0);
  return {
    id: "rep-1",
    date: `${FECHA}T00:00:00`,
    status,
    reporterId: "user-1",
    reporterFullName: "Ana",
    activitiesCount: efforts.length,
    executedHours: horas,
    efforts,
  };
}

async function clientContra(
  fetchImpl: FetchImpl,
): Promise<BlueSurfClient> {
  const client = new BlueSurfClient({
    baseUrl: "https://surf.test",
    fetchImpl,
  });
  await client.login(new NoopAuth());
  return client;
}

describe("daily report", () => {
  it("postJson tolera un cuerpo vacío", async () => {
    const session = new BlueSurfSession({
      baseUrl: "https://surf.test",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    await session.login(new NoopAuth());
    try {
      assert.equal(await session.postJson("/api/Effort/DailyReport", {}), null);
    } finally {
      await session.aclose();
    }
  });

  it("proyectos_reporte deja fuera los inactivos", async () => {
    const client = await clientContra(async (url) => {
      assert.equal(new URL(url).pathname, "/api/project");
      assert.equal(new URL(url).searchParams.get("includeCategories"), "true");
      return Response.json(PROYECTOS);
    });
    try {
      assert.deepEqual(await client.proyectosReporte(), [
        {
          id: "p-rwsg",
          smallCode: "RWSG2",
          code: "WSG",
          name: "WSG Rewrite",
          categoryIds: ["cat-dev"],
        },
      ]);
    } finally {
      await client.aclose();
    }
  });

  it("listar_categorias filtra por las categorías del proyecto", async () => {
    const client = await clientContra(async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/user/current/subcategory") return Response.json(CATEGORIAS);
      if (path === "/api/project") return Response.json(PROYECTOS);
      throw new Error(path);
    });
    try {
      assert.deepEqual(
        await client.listarCategorias("rwsg2"),
        [
          {
            id: "sub-code",
            name: "Construcción / Codificación",
            categoryId: "cat-dev",
            categoryName: "Desarrollo",
          },
        ],
      );
    } finally {
      await client.aclose();
    }
  });

  it("registra las tres formas en un solo POST y reenvía lo previo", async () => {
    const posts: unknown[] = [];
    let lecturas = 0;
    const guardado = reporte(2, [
      PREVIO,
      { id: "eff-nueva" },
      { id: "eff-proy" },
      { id: "eff-wi" },
    ]);

    const client = await clientContra(async (url, init) => {
      const path = new URL(url).pathname;
      if (init?.method === "POST" && path === "/api/Effort/DailyReport") {
        posts.push(JSON.parse(String(init.body)));
        return new Response("", { status: 200 });
      }
      if (path === `/api/effort/myDailyReport/${FECHA}`) {
        lecturas += 1;
        return Response.json(lecturas === 1 ? reporte(0, [PREVIO]) : guardado);
      }
      if (path === "/api/user/current/subcategory") return Response.json(CATEGORIAS);
      if (path === "/api/project") return Response.json(PROYECTOS);
      if (path === "/api/workItem/RWSG2-9") return Response.json(TICKET);
      throw new Error(`${init?.method} ${path}`);
    });

    try {
      const guardadoDia = await client.registrarTiempo({
        fecha: FECHA,
        confirmar: true,
        lineas: [
          {
            horas: 20 / 60,
            categoria: "Google: Google Calendar",
            descripcion: "Cursor skills",
          },
          {
            horas: 1,
            categoria: "Construcción / Codificación",
            descripcion: "Daily Meeting",
            proyecto: "RWSG2",
          },
          {
            horas: 2,
            categoria: "Desarrollo: Construcción / Codificación",
            proyecto: "RWSG2",
            ticket: "RWSG2-9",
            pendiente: 3,
          },
        ],
      });

      assert.equal(posts.length, 1);
      const cuerpo = posts[0] as { status: number; efforts: unknown[] };
      assert.equal(cuerpo.status, 2);
      assert.deepEqual(cuerpo.efforts[0], PREVIO);
      assert.deepEqual(cuerpo.efforts.slice(1), [
        {
          projectId: null,
          taskId: null,
          workItemId: null,
          description: "Cursor skills",
          executed: 0.333,
          pending: null,
          categoryId: "cat-google",
          subcategoryId: "sub-gc",
          deleted: false,
        },
        {
          projectId: "p-rwsg",
          taskId: null,
          workItemId: null,
          description: "Daily Meeting",
          executed: 1,
          pending: null,
          categoryId: "cat-dev",
          subcategoryId: "sub-code",
          deleted: false,
        },
        {
          projectId: "p-rwsg",
          taskId: null,
          workItemId: "wi-9",
          description: null,
          executed: 2,
          pending: 3,
          categoryId: "cat-dev",
          subcategoryId: "sub-code",
          deleted: false,
        },
      ]);
      assert.equal(guardadoDia.cerrado, true);
      assert.equal(guardadoDia.efforts[3]?.id, "eff-wi");
    } finally {
      await client.aclose();
    }
  });

  it("no escribe si no hay líneas o una de ellas es inválida", async () => {
    let posts = 0;
    const client = await clientContra(async (_url, init) => {
      if (init?.method === "POST") posts += 1;
      throw new Error("no debería consultar BlueSurf");
    });
    try {
      await assert.rejects(
        () => client.registrarTiempo({ fecha: FECHA, lineas: [] }),
        /al menos una línea/,
      );
      await assert.rejects(
        () =>
          client.registrarTiempo({
            fecha: FECHA,
            lineas: [
              {
                horas: 1,
                categoria: "Google Calendar",
                descripcion: "válida",
              },
              { horas: 1, categoria: "Google Calendar" },
            ],
          }),
        /Línea 2: La descripción es obligatoria/,
      );
      assert.equal(posts, 0);
    } finally {
      await client.aclose();
    }
  });

  it("no escribe si el día está cerrado", async () => {
    let posts = 0;
    const client = await clientContra(async (url, init) => {
      if (init?.method === "POST") posts += 1;
      assert.equal(new URL(url).pathname, `/api/effort/myDailyReport/${FECHA}`);
      return Response.json(reporte(2, [PREVIO]));
    });
    try {
      await assert.rejects(
        () =>
          client.registrarTiempo({
            fecha: FECHA,
            lineas: [
              {
                horas: 1,
                categoria: "Google Calendar",
                descripcion: "tarde",
              },
            ],
          }),
        /ya está cerrado/,
      );
      assert.equal(posts, 0);
    } finally {
      await client.aclose();
    }
  });

  it("una categoría ambigua falla y el nombre calificado la resuelve", async () => {
    const posts: Array<{ efforts: Array<Record<string, unknown>> }> = [];
    let lecturas = 0;
    const client = await clientContra(async (url, init) => {
      const path = new URL(url).pathname;
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response("", { status: 200 });
      }
      if (path === `/api/effort/myDailyReport/${FECHA}`) {
        lecturas += 1;
        const efforts =
          lecturas < 3
            ? [PREVIO]
            : [PREVIO, { id: "eff-gen", subcategoryId: "sub-gen-g" }];
        return Response.json(reporte(0, efforts));
      }
      if (path === "/api/user/current/subcategory") return Response.json(CATEGORIAS);
      throw new Error(path);
    });
    try {
      await assert.rejects(
        () =>
          client.registrarTiempo({
            fecha: FECHA,
            lineas: [
              { horas: 1, categoria: "General", descripcion: "junta" },
            ],
          }),
        /Línea 1: .*ambigua/,
      );
      assert.equal(posts.length, 0);
      const guardado = await client.registrarTiempo({
        fecha: FECHA,
        lineas: [
          { horas: 1, categoria: "Gestión: General", descripcion: "junta" },
        ],
      });
      assert.equal(posts[0]?.efforts[1]?.subcategoryId, "sub-gen-g");
      assert.equal(guardado.efforts[1]?.id, "eff-gen");
    } finally {
      await client.aclose();
    }
  });
});

describe("tools de daily report", () => {
  it("reexpone el cliente sin el documento crudo", async () => {
    const reporte: ReporteDiario = {
      id: "rep-1",
      fecha: FECHA,
      status: 0,
      cerrado: false,
      executedHours: 1,
      efforts: [
        {
          id: "eff-1",
          description: "Daily",
          executed: 1,
          pending: null,
          projectId: null,
          workItemId: null,
          taskId: null,
          categoryId: "cat-google",
          subcategoryId: "sub-gc",
        },
      ],
      raw: { secreto: true },
    };
    setClientFactory(async () => {
      const fake: Partial<SurfClient> = {
        async proyectosReporte() {
          return [
            {
              id: "p-rwsg",
              smallCode: "RWSG2",
              code: "WSG",
              name: "WSG",
              categoryIds: ["cat-dev"],
            },
          ];
        },
        async listarCategorias(proyecto) {
          assert.equal(proyecto, "RWSG2");
          return [
            {
              id: "sub-code",
              name: "Construcción / Codificación",
              categoryId: "cat-dev",
              categoryName: "Desarrollo",
            },
          ];
        },
        async miReporteDiario(fecha) {
          assert.equal(fecha, FECHA);
          return reporte;
        },
        async registrarTiempo(input) {
          assert.equal(input.confirmar ?? false, false);
          assert.equal(input.lineas[0]?.ticket, "RWSG2-9");
          return reporte;
        },
        async aclose() {},
      };
      return fake as SurfClient;
    });
    try {
      assert.deepEqual(await proyectosReporte(), [
        {
          id: "p-rwsg",
          smallCode: "RWSG2",
          code: "WSG",
          name: "WSG",
          categoryIds: ["cat-dev"],
        },
      ]);
      assert.equal((await listarCategorias("RWSG2"))[0]?.id, "sub-code");
      const leido = await miReporteDiario(FECHA);
      assert.equal("raw" in leido, false);
      assert.equal(leido.fecha, FECHA);
      const escrito = await registrarTiempo({
        fecha: FECHA,
        lineas: [{ horas: 1, categoria: "Google Calendar", ticket: "RWSG2-9" }],
      });
      assert.equal("raw" in escrito, false);
      assert.equal(escrito.id, "rep-1");
    } finally {
      resetClientFactory();
    }
  });
});
