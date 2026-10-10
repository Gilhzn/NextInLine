import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminLegStatusSchema, BENEFIT_CATEGORIES, LEG_STATUSES } from "@magiali/shared";
import { publishCatalogVersion } from "../catalog";
import type { Deps } from "../context";
import { safeEqualHex, sha256Hex } from "../crypto";
import { AppError } from "../errors";
import { parse } from "../http";
import { audit } from "../services/audit";
import { transitionLeg } from "../services/claims";
import { resolveFee } from "../services/fees";

/** Operations back-office. MVP: shared token; production: SSO + per-operator identity. */
export async function adminRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const token = req.headers["x-admin-token"];
    if (typeof token !== "string" || !safeEqualHex(sha256Hex(token), sha256Hex(deps.config.ADMIN_TOKEN))) {
      throw new AppError("unauthorized", "admin token required");
    }
  });

  app.get<{ Querystring: { status?: string } }>("/legs", async (req) => {
    const { status } = parse(z.object({ status: z.enum(LEG_STATUSES).optional() }), req.query);
    return deps.sql`
      SELECT l.id, l.claim_id, l.seq, l.status, l.payer_id, l.expected_agorot, l.submitted_at, l.submission_channel,
             c.category, c.amount_agorot, c.service_date, m.full_name AS member_name
      FROM claim_legs l JOIN claims c ON c.id = l.claim_id JOIN members m ON m.id = c.member_id
      WHERE (${status ?? null}::text IS NULL OR l.status = ${status ?? null})
      ORDER BY l.updated_at LIMIT 200`;
  });

  app.post<{ Params: { id: string } }>("/legs/:id/status", async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const input = parse(adminLegStatusSchema, req.body);
    await transitionLeg(deps, id, {
      to: input.status,
      amountAgorot: input.amountAgorot,
      reason: input.reason,
      payerReference: input.payerReference,
      actor: "ops",
      actorId: "admin",
    });
    await audit(deps.sql, { actorKind: "ops", action: "leg_status_set", entity: "claim_leg", entityId: id, meta: { to: input.status } });
    const [leg] = await deps.sql`SELECT id, status, paid_agorot FROM claim_legs WHERE id = ${id}`;
    return leg;
  });

  app.get("/fees/disputed", async () => deps.sql`SELECT * FROM fees WHERE status IN ('disputed', 'failed') ORDER BY updated_at`);

  app.post<{ Params: { id: string } }>("/fees/:id/resolve", async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { action } = parse(z.object({ action: z.enum(["charge", "waive"]) }), req.body);
    return resolveFee(deps, id, action);
  });

  app.post("/catalog/publish", async (req) => {
    const input = parse(
      z.object({
        notes: z.string().min(3).max(500),
        benefits: z
          .array(
            z.object({
              planId: z.string(),
              category: z.enum(BENEFIT_CATEGORIES),
              rule: z.unknown(),
              sourceNote: z.string().min(3).max(500),
            }),
          )
          .min(1),
      }),
      req.body,
    );
    const version = await publishCatalogVersion(deps.sql, input.benefits, input.notes);
    await audit(deps.sql, { actorKind: "ops", action: "catalog_published", entity: "catalog", entityId: String(version) });
    return { version };
  });

  app.get("/jobs/failed", async () =>
    deps.sql`SELECT id, type, attempts, last_error, failed_at FROM jobs WHERE failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 100`,
  );
}
