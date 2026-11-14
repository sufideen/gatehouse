import Fastify from "fastify";
import { z } from "zod";
import { createDb } from "@gatehouse/db";
import { assignGuardToShift, ComplianceError } from "./compliance";
import { commitGuardhouseImport, previewGuardsCsv, previewSitesCsv } from "./import/guardhouse";
import { anonymiseUser, exportSubjectData, recordConsent, runRetention, SCOPES, withdrawConsent } from "./privacy";
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
    const b = z.object({
      organisationId: z.string().uuid(), guardsCsv: z.string().optional(), sitesCsv: z.string().optional(),
      dataOrigin: z.enum(["SYNTHETIC", "PILOT_CONSENTED"]).default("SYNTHETIC"),
      consents: z.record(z.object({ scopes: z.array(z.enum(SCOPES)), policyVersion: z.string().min(1) })).default({}),
    }).parse(req.body);
    return commitGuardhouseImport(db, {
      mode: b.dataOrigin === "SYNTHETIC" ? { dataOrigin: "SYNTHETIC" } : { dataOrigin: "PILOT_CONSENTED", consents: b.consents },
      organisationId: b.organisationId, actorId: actor(req.headers), ipAddress: req.ip,
      guards: b.guardsCsv ? previewGuardsCsv(b.guardsCsv) : [], sites: b.sitesCsv ? previewSitesCsv(b.sitesCsv) : [],
    });
  });

  // ---- Privacy / GDPR (pilot) ----
  const scopes = z.array(z.enum(SCOPES)).min(1);
  app.post("/privacy/consents", async (req) => {
    const b = z.object({ userId: z.string().uuid(), scopes, policyVersion: z.string().min(1) }).parse(req.body);
    return recordConsent(db, { ...b, recordedBy: actor(req.headers), ipAddress: req.ip });
  });
  app.post("/privacy/withdraw", async (req) => {
    const b = z.object({ userId: z.string().uuid(), scopes }).parse(req.body);
    return withdrawConsent(db, { ...b, actorId: actor(req.headers), ipAddress: req.ip });
  });
  app.get("/privacy/export/:userId", async (req) => exportSubjectData(db, z.string().uuid().parse((req.params as { userId: string }).userId)));
  app.post("/privacy/anonymise/:userId", async (req) =>
    anonymiseUser(db, { userId: z.string().uuid().parse((req.params as { userId: string }).userId), actorId: actor(req.headers), reason: "ERASURE_REQUEST", ipAddress: req.ip }));
  app.post("/privacy/retention/run", async () => runRetention(db));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildServer().listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
}
