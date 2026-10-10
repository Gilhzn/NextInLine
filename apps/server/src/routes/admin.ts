import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminLegStatusSchema, BENEFIT_CATEGORIES, CATEGORY_INFO, LEG_STATUSES, type BenefitCategory } from "@magiali/shared";
import { publishCatalogVersion } from "../catalog";
import type { Deps } from "../context";
import { safeEqualHex, sha256Hex } from "../crypto";
import { AppError } from "../errors";
import { parse } from "../http";
import { audit } from "../services/audit";
import { transitionLeg } from "../services/claims";
import { refundFee, resolveFee } from "../services/fees";
import { adminTokenAllowed, verifyOpsSession } from "../services/ops-auth";

/** Operations back-office. MVP: shared token; production: SSO + per-operator identity. */
export async function adminRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  // Each operator signs in with their own phone (Bearer ops session); every action is attributed to them.
  // The shared x-admin-token works only outside production (local demo, tests).
  app.decorateRequest("operator", "");
  app.addHook("onRequest", async (req) => {
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
    const operator = bearer ? await verifyOpsSession(deps, bearer) : null;
    if (operator) {
      req.operator = operator;
      return;
    }
    const token = req.headers["x-admin-token"];
    if (
      adminTokenAllowed(deps) &&
      typeof token === "string" &&
      safeEqualHex(sha256Hex(token), sha256Hex(deps.config.ADMIN_TOKEN))
    ) {
      req.operator = "admin-token";
      return;
    }
    throw new AppError("unauthorized", "נדרשת כניסת צוות");
  });

  app.get<{ Querystring: { status?: string } }>("/legs", async (req) => {
    const statuses = (req.query.status ?? "").split(",").filter(Boolean);
    parse(z.array(z.enum(LEG_STATUSES)), statuses);
    const rows = await deps.sql`
      SELECT l.id, l.claim_id, l.seq, l.status, l.payer_id, p.name_he AS payer_name, l.expected_agorot, l.approved_agorot,
             l.paid_agorot, l.submitted_at, l.submission_channel, l.updated_at,
             c.category, c.amount_agorot, c.service_date, c.provider_name, c.status AS claim_status,
             m.full_name AS member_name, u.phone_e164 AS owner_phone
      FROM claim_legs l JOIN claims c ON c.id = l.claim_id JOIN members m ON m.id = c.member_id
      JOIN payers p ON p.id = l.payer_id JOIN households h ON h.id = c.household_id JOIN users u ON u.id = h.owner_user_id
      WHERE (${statuses.length === 0} OR l.status IN ${deps.sql(statuses.length ? statuses : ["-"])})
      ORDER BY l.updated_at DESC LIMIT 200`;
    return rows.map((r) => ({ ...r, categoryLabel: CATEGORY_INFO[r.category as BenefitCategory]?.label ?? r.category }));
  });

  app.get("/overview", async () => {
    const [users] = await deps.sql`SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL`;
    const claims = await deps.sql`SELECT status, count(*)::int AS n FROM claims GROUP BY status`;
    const legs = await deps.sql`SELECT status, count(*)::int AS n FROM claim_legs GROUP BY status`;
    const fees = await deps.sql`SELECT status, count(*)::int AS n, COALESCE(sum(amount_agorot), 0)::int AS agorot FROM fees GROUP BY status`;
    const [paid] = await deps.sql`SELECT COALESCE(sum(paid_agorot), 0)::int AS agorot FROM claim_legs WHERE status = 'paid'`;
    const [failedJobs] = await deps.sql`SELECT count(*)::int AS n FROM jobs WHERE failed_at IS NOT NULL`;
    return { users: users!.n, paidToUsersAgorot: paid!.agorot, failedJobs: failedJobs!.n, claims, legs, fees };
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
      actorId: req.operator,
    });
    await audit(deps.sql, { actorKind: "ops", action: "leg_status_set", entity: "claim_leg", entityId: id, meta: { to: input.status, operator: req.operator } });
    const [leg] = await deps.sql`SELECT id, status, paid_agorot FROM claim_legs WHERE id = ${id}`;
    return leg;
  });

  app.get("/fees", async () =>
    deps.sql`
      SELECT f.*, u.phone_e164 AS owner_phone FROM fees f JOIN households h ON h.id = f.household_id
      JOIN users u ON u.id = h.owner_user_id ORDER BY f.updated_at DESC LIMIT 200`,
  );

  app.post<{ Params: { id: string } }>("/fees/:id/resolve", async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const input = parse(
      z.object({ action: z.enum(["charge", "waive", "charge_now", "refund"]), reason: z.string().max(300).optional() }),
      req.body,
    );
    await audit(deps.sql, { actorKind: "ops", action: `fee_${input.action}`, entity: "fee", entityId: id, meta: { operator: req.operator } });
    if (input.action === "refund") return refundFee(deps, id, input.reason ?? "ops");
    return resolveFee(deps, id, input.action);
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
    await audit(deps.sql, { actorKind: "ops", action: "catalog_published", entity: "catalog", entityId: String(version), meta: { operator: req.operator } });
    return { version };
  });

  app.get("/jobs/failed", async () =>
    deps.sql`SELECT id, type, attempts, last_error, failed_at FROM jobs WHERE failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 100`,
  );
}

declare module "fastify" {
  interface FastifyRequest {
    /** Who is acting in /admin: the operator's phone, or "admin-token" outside production. */
    operator: string;
  }
}
