import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthProvider } from "../src/auth.js";
import { BlueSurfClient } from "../src/client.js";
import type { FetchImpl } from "../src/session.js";

const openAuth: AuthProvider = {
  async apply() {},
  async refresh() {},
};

describe("misTickets", () => {
  it("filtra por asignado y omite estados finales", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/instance/currentUser") {
        return Response.json({ id: "me", fullName: "Me" });
      }
      if (parsed.pathname === "/api/project/PROJ/kanban") {
        assert.equal(parsed.searchParams.get("skipWorkItems"), "false");
        assert.equal(init?.method, "POST");
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json([
          {
            statuses: [
              {
                workItems: [
                  {
                    id: "1",
                    code: "PROJ-1",
                    assignedToId: "me",
                    statusIsFinal: false,
                    name: "Abierto",
                  },
                  {
                    id: "2",
                    code: "PROJ-2",
                    assignedToId: "me",
                    statusIsFinal: true,
                    name: "Cerrado",
                  },
                  {
                    id: "3",
                    code: "PROJ-3",
                    assignedToId: "other",
                    statusIsFinal: false,
                    name: "Ajeno",
                  },
                ],
              },
            ],
          },
        ]);
      }
      return Response.json({ path: parsed.pathname }, { status: 404 });
    };

    const client = new BlueSurfClient({
      baseUrl: "https://surf.test",
      fetchImpl,
    });
    await client.login(openAuth);
    try {
      const abiertos = await client.misTickets("PROJ");
      assert.deepEqual(
        abiertos.map((ticket) => ticket.code),
        ["PROJ-1"],
      );
      const todos = await client.misTickets("PROJ", { includeClosed: true });
      assert.deepEqual(
        todos.map((ticket) => ticket.code),
        ["PROJ-1", "PROJ-2"],
      );
      assert.deepEqual(bodies[0], {
        statuses: [],
        tags: [],
        sprints: [],
        priorities: [],
        assignedTo: ["me"],
        reportedBy: [],
        colors: [],
        defectsOrigins: [],
        tagCondition: "and",
        search: "",
        quantityPerStatus: [],
      });
    } finally {
      await client.aclose();
    }
  });
});
