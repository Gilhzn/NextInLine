import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CATEGORY_INFO,
  CLAIM_STATUSES,
  claimCreateSchema,
  claimDocProvideSchema,
  consentSchema,
  enrollmentsPutSchema,
  policyTermPutSchema,
  feeDisputeSchema,
  legStatusUpdateSchema,
  meUpdateSchema,
  memberConsentConfirmSchema,
  memberCreateSchema,
  memberUpdateSchema,
  pushTokenSchema,
  receiptConfirmSchema,
  searchCategories,
  simulateSchema,
  type PlanDto,
} from "@magiali/shared";
import type { Deps } from "../context";
import { AppError } from "../errors";
import { auth, parse } from "../http";
import { verifyAccessToken } from "../services/auth";
import {
  cancelClaim,
  createClaim,
  getClaim,
  getSubmissionPack,
  listClaims,
  provideClaimDocument,
  submitClaim,
  userUpdateLeg,
} from "../services/claims";
import { audit } from "../services/audit";
import { coverageMap, getPolicyTerms, routeForMember, setPolicyTerm } from "../services/coverage";
import { disputeFee, listFees } from "../services/fees";
import { refreshCardSetup, startCardSetup } from "../services/payments";
import { publicOrigin } from "./payments";
import { getHome } from "../services/home";
import { getMe, getMemberForHousehold, listMembers, memberDto } from "../services/households";
import {
  confirmMemberConsent,
  createMember,
  deleteMember,
  listEnrollments,
  putEnrollments,
  sendConsentCode,
  updateMember,
} from "../services/members";
import { deleteAccount, exportData } from "../services/privacy";
import { confirmReceipt, deleteReceipt, getReceipt, listReceipts, MAX_UPLOAD_BYTES, storeDocument, uploadReceipt } from "../services/receipts";

const idParam = z.object({ id: z.uuid() });
const claimLegParams = z.object({ id: z.uuid(), legId: z.uuid() });

async function readUpload(req: FastifyRequest): Promise<{ data: Buffer; mimeType: string; fields: Record<string, string> }> {
  const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  if (!file) throw new AppError("validation_error", "לא צורף קובץ");
  let data: Buffer;
  try {
    data = await file.toBuffer();
  } catch {
    throw new AppError("payload_too_large", "הקובץ גדול מדי (עד 15MB)");
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(file.fields)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v && v.type === "field" && typeof v.value === "string") fields[key] = v.value;
  }
  return { data, mimeType: file.mimetype, fields };
}

export async function userRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("unauthorized", "נדרשת התחברות");
    req.auth = await verifyAccessToken(deps, header.slice(7));
  });

  // ---------- me ----------
  app.get("/me", async (req) => getMe(deps, auth(req).userId));

  app.patch("/me", async (req) => {
    const ctx = auth(req);
    const input = parse(meUpdateSchema, req.body);
    await deps.sql`
      UPDATE users SET display_name = COALESCE(${input.displayName ?? null}, display_name),
             onboarding_step = COALESCE(${input.onboardingStep ?? null}, onboarding_step), updated_at = ${deps.now()}
      WHERE id = ${ctx.userId}`;
    if (input.displayName) {
      await deps.sql`UPDATE members SET full_name = ${input.displayName} WHERE household_id = ${ctx.householdId} AND relation = 'self'`;
    }
    return getMe(deps, ctx.userId);
  });

  app.delete("/me", async (req, reply) => {
    await deleteAccount(deps, auth(req));
    return reply.code(204).send();
  });

  app.post("/consents", async (req) => {
    const ctx = auth(req);
    const input = parse(consentSchema, req.body);
    await deps.sql`
      INSERT INTO consents (user_id, kind, version, evidence)
      VALUES (${ctx.userId}, ${input.kind}, ${input.version},
              ${deps.sql.json({ ip: req.ip, userAgent: req.headers["user-agent"] ?? null } as never)})`;
    return getMe(deps, ctx.userId);
  });

  app.get("/privacy/export", async (req) => exportData(deps, auth(req)));

  // ---------- members ----------
  app.get("/members", async (req) => (await listMembers(deps.sql, auth(req).householdId)).map(memberDto));

  app.post("/members", async (req, reply) => {
    const member = await createMember(deps, auth(req), parse(memberCreateSchema, req.body));
    return reply.code(201).send(member);
  });

  app.patch("/members/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return updateMember(deps, auth(req), id, parse(memberUpdateSchema, req.body));
  });

  app.delete("/members/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deleteMember(deps, auth(req), id);
    return reply.code(204).send();
  });

  app.post("/members/:id/consent/resend", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await sendConsentCode(deps, auth(req), id);
    return reply.code(204).send();
  });

  app.post("/members/consent/confirm", async (req) => {
    const { memberId, code } = parse(memberConsentConfirmSchema, req.body);
    return confirmMemberConsent(deps, auth(req), memberId, code);
  });

  app.get<{ Params: { id: string; planId: string } }>("/members/:id/enrollments/:planId/terms", async (req) => {
    const { id } = parse(idParam, { id: req.params.id });
    return getPolicyTerms(deps.sql, auth(req).householdId, id, parse(z.string().max(60), req.params.planId));
  });

  app.put<{ Params: { id: string; planId: string } }>("/members/:id/enrollments/:planId/terms", async (req) => {
    const { id } = parse(idParam, { id: req.params.id });
    const planId = parse(z.string().max(60), req.params.planId);
    const input = parse(policyTermPutSchema, req.body);
    const ctx = auth(req);
    await setPolicyTerm(deps.sql, ctx.householdId, id, planId, input.category, input.rule);
    await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "policy_terms_set", entity: "enrollment", entityId: `${id}:${planId}`, meta: { category: input.category } });
    return getPolicyTerms(deps.sql, ctx.householdId, id, planId);
  });

  app.get("/members/:id/enrollments", async (req) => {
    const { id } = parse(idParam, req.params);
    return listEnrollments(deps, auth(req), id);
  });

  app.put("/members/:id/enrollments", async (req) => {
    const { id } = parse(idParam, req.params);
    const { enrollments } = parse(enrollmentsPutSchema, req.body);
    await putEnrollments(deps, auth(req), id, enrollments);
    return listEnrollments(deps, auth(req), id);
  });

  // ---------- catalog & coverage ----------
  app.get("/catalog/plans", async (): Promise<PlanDto[]> => {
    const rows = await deps.sql`
      SELECT p.id, p.name_he, p.payer_id, py.name_he AS payer_name, p.plan_kind, p.description
      FROM plans p JOIN payers py ON py.id = p.payer_id WHERE p.active
      ORDER BY CASE p.plan_kind WHEN 'shaban' THEN 0 WHEN 'private_individual' THEN 1 ELSE 2 END, py.id, p.id`;
    return rows.map((r) => ({
      id: r.id as string,
      name: r.nameHe as string,
      payerId: r.payerId as string,
      payerName: r.payerName as string,
      kind: r.planKind as PlanDto["kind"],
      description: (r.description as string | null) ?? null,
    }));
  });

  app.get("/coverage/map", async (req) => coverageMap(deps.sql, auth(req).householdId, deps.now()));

  app.get<{ Querystring: { q?: string } }>("/coverage/search", async (req) => {
    const categories = searchCategories(req.query.q ?? "");
    const map = await coverageMap(deps.sql, auth(req).householdId, deps.now());
    return {
      categories: categories.map((c) => ({ category: c, label: CATEGORY_INFO[c].label, icon: CATEGORY_INFO[c].icon })),
      items: map.filter((i) => categories.includes(i.category)),
    };
  });

  app.post("/coverage/simulate", async (req) => {
    const ctx = auth(req);
    const input = parse(simulateSchema, req.body);
    const member = await getMemberForHousehold(deps.sql, ctx.householdId, input.memberId);
    const { routing } = await routeForMember(deps.sql, {
      memberId: member.id,
      birthDate: member.birthDate,
      category: input.category,
      amountAgorot: input.amountAgorot,
      sessions: input.sessions,
      serviceDate: input.serviceDate ?? deps.now().toISOString().slice(0, 10),
    });
    return routing;
  });

  // ---------- receipts & documents ----------
  app.post("/receipts", async (req, reply) => {
    const upload = await readUpload(req);
    const memberId = upload.fields.memberId ? parse(z.uuid(), upload.fields.memberId) : null;
    const receipt = await uploadReceipt(deps, auth(req), { data: upload.data, mimeType: upload.mimeType, memberId });
    return reply.code(201).send(receipt);
  });

  app.get<{ Querystring: { unclaimed?: string } }>("/receipts", async (req) =>
    listReceipts(deps, auth(req), { unclaimedOnly: req.query.unclaimed === "true" }),
  );

  app.get("/receipts/:id", async (req) => getReceipt(deps, auth(req), parse(idParam, req.params).id));

  app.patch("/receipts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return confirmReceipt(deps, auth(req), id, parse(receiptConfirmSchema, req.body));
  });

  app.delete("/receipts/:id", async (req, reply) => {
    await deleteReceipt(deps, auth(req), parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post("/documents", async (req, reply) => {
    const upload = await readUpload(req);
    const kind = parse(z.enum(["visit_summary", "referral", "payer_payment_proof", "other"]), upload.fields.kind);
    const doc = await storeDocument(deps, auth(req), { data: upload.data, mimeType: upload.mimeType, kind });
    return reply.code(201).send({ id: doc.id, kind });
  });

  // ---------- claims ----------
  app.post("/claims", async (req, reply) => {
    const claim = await createClaim(deps, auth(req), parse(claimCreateSchema, req.body));
    return reply.code(201).send(claim);
  });

  app.get<{ Querystring: { status?: string; memberId?: string } }>("/claims", async (req) => {
    const q = parse(z.object({ status: z.enum(CLAIM_STATUSES).optional(), memberId: z.uuid().optional() }), req.query);
    return listClaims(deps, auth(req), q);
  });

  app.get("/claims/:id", async (req) => getClaim(deps, auth(req), parse(idParam, req.params).id));

  app.post("/claims/:id/documents", async (req) => {
    const { id } = parse(idParam, req.params);
    return provideClaimDocument(deps, auth(req), id, parse(claimDocProvideSchema, req.body));
  });

  app.post("/claims/:id/submit", async (req) => submitClaim(deps, auth(req), parse(idParam, req.params).id));

  app.post("/claims/:id/cancel", async (req) => cancelClaim(deps, auth(req), parse(idParam, req.params).id));

  app.get("/claims/:id/legs/:legId/pack", async (req) => {
    const { id, legId } = parse(claimLegParams, req.params);
    return getSubmissionPack(deps, auth(req), id, legId);
  });

  app.post("/claims/:id/legs/:legId/status", async (req) => {
    const { id, legId } = parse(claimLegParams, req.params);
    return userUpdateLeg(deps, auth(req), id, legId, parse(legStatusUpdateSchema, req.body));
  });

  // ---------- money ----------
  app.get("/fees", async (req) => listFees(deps, auth(req)));

  app.post("/fees/:id/dispute", async (req) => {
    const { id } = parse(idParam, req.params);
    return disputeFee(deps, auth(req), id, parse(feeDisputeSchema, req.body).reason);
  });

  app.get("/payment-methods", async (req) => {
    const rows = await deps.sql`
      SELECT id, provider, brand, last4, exp_month, exp_year, is_default, created_at FROM payment_methods
      WHERE user_id = ${auth(req).userId} AND deleted_at IS NULL ORDER BY created_at DESC`;
    return rows;
  });

  // Saving a card: the app opens the provider's hosted page, then polls until the provider confirms.
  app.post("/payment-methods/setup", async (req) => {
    const input = parse(
      z.object({ platform: z.enum(["web", "native"]), returnUrl: z.string().max(300).optional() }),
      req.body,
    );
    return startCardSetup(deps, auth(req), { ...input, origin: publicOrigin(deps, req) });
  });

  app.get("/payment-methods/setup/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const ctx = auth(req);
    const status = await refreshCardSetup(deps, id, { userId: ctx.userId });
    return { status, me: status === "completed" ? await getMe(deps, ctx.userId) : undefined };
  });

  app.delete("/payment-methods/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deps.sql`
      UPDATE payment_methods SET deleted_at = ${deps.now()}, provider_token_enc = ''
      WHERE id = ${id} AND user_id = ${auth(req).userId}`;
    return reply.code(204).send();
  });

  // ---------- home & notifications ----------
  app.get("/home", async (req) => getHome(deps, auth(req)));

  app.post("/push-tokens", async (req, reply) => {
    const input = parse(pushTokenSchema, req.body);
    await deps.sql`
      INSERT INTO push_tokens (user_id, expo_token, platform) VALUES (${auth(req).userId}, ${input.expoToken}, ${input.platform})
      ON CONFLICT (expo_token) DO UPDATE SET user_id = EXCLUDED.user_id, last_seen_at = now()`;
    return reply.code(204).send();
  });

  app.get("/notifications", async (req) => {
    return deps.sql`
      SELECT id, type, title, body, data, created_at, read_at FROM notifications
      WHERE user_id = ${auth(req).userId} ORDER BY created_at DESC LIMIT 50`;
  });

  app.post("/notifications/:id/read", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deps.sql`UPDATE notifications SET read_at = ${deps.now()} WHERE id = ${id} AND user_id = ${auth(req).userId}`;
    return reply.code(204).send();
  });
}
