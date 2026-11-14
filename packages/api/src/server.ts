import Fastify from "fastify";
import { z } from "zod";
import { createDb } from "@gatehouse/db";
import { assignGuardToShift, ComplianceError } from "./compliance";
import { commitGuardhouseImport, previewGuardsCsv, previewSitesCsv } from "./import/guardhouse";
import { applySyncBatch, syncBatch } from "./sync";

export function buildServer(db = createDb().db) {
  const app = Fastify({ logger: false });
  // TODO(auth): actor identity is taken from a header until real auth (sessions/JWT) lands.
  const actor = (h: Record<string, unknown>) => z.string().uuid().parse(h["x-actor-id"]);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ComplianceError) return reply.code(409).send({ error: err.code, violations: err.violations });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "VALIDATION", issues: err.issues });
    return reply.code(500).send({ error: "INTERNAL" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/sync/batch", async (req) => {
    const body = syncBatch.parse(req.body);
    return { results: await applySyncBatch(db, body, req.ip) };
  });

  app.post("/shifts/:id/assign", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ guardId: z.string().uuid(), overrideReason: z.string().optional() }).parse(req.body);
    return assignGuardToShift(db, { shiftId: id, actorId: actor(req.headers), ipAddress: req.ip, ...body });
  });

  app.post("/import/guardhouse/preview", async (req) => {
    const b = z.object({ guardsCsv: z.string().optional(), sitesCsv: z.string().optional() }).parse(req.body);
    return { guards: b.guardsCsv ? previewGuardsCsv(b.guardsCsv) : [], sites: b.sitesCsv ? previewSitesCsv(b.sitesCsv) : [] };
  });

  app.post("/import/guardhouse/commit", async (req) => {
    const b = z.object({ organisationId: z.string().uuid(), guardsCsv: z.string().optional(), sitesCsv: z.string().optional() }).parse(req.body);
    return commitGuardhouseImport(db, {
      organisationId: b.organisationId, actorId: actor(req.headers), ipAddress: req.ip,
      guards: b.guardsCsv ? previewGuardsCsv(b.guardsCsv) : [], sites: b.sitesCsv ? previewSitesCsv(b.sitesCsv) : [],
    });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildServer().listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
}
