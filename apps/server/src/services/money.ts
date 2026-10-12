import {
  CATEGORY_INFO,
  formatILS,
  type BenefitCategory,
  type MoneyDto,
  type MoneyItemDto,
  type MoneyServiceDto,
} from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { currentCatalogVersion } from "../catalog";
import { loadRoutingEnrollments, routeForMember } from "./coverage";
import { unusedQuotas } from "./quota";
import { listMembers } from "./households";

const CLAIM_WINDOW_DAYS = 3 * 365;
const EXPIRY_WARNING_DAYS = 90;
const LOW_REFUND_SHARE = 0.3;
const LOW_REFUND_MIN_PAID = 50000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dateHe = (iso: string) => iso.split("-").reverse().join("/");
const sum = (items: MoneyItemDto[]) => items.reduce((s, i) => s + (i.amountAgorot ?? 0), 0);

/** Same amount (±₪1) within a week = the same payment. */
export function samePayment(a: { amountAgorot: number; date: string }, b: { amountAgorot: number; date: string }): boolean {
  const days = Math.abs(new Date(`${a.date}T00:00:00Z`).getTime() - new Date(`${b.date}T00:00:00Z`).getTime()) / 86_400_000;
  return Math.abs(a.amountAgorot - b.amountAgorot) <= 100 && days <= 7;
}

/**
 * "Our health money" – one view of the household's medical spending and refunds:
 * what we paid and got back, what we missed (or are about to), what's on its way, and where we can still save.
 * Every item comes with the one action that moves it forward.
 */
export async function moneyOverview(deps: Deps, ctx: AuthContext, range: "year" | "3y"): Promise<MoneyDto> {
  const now = deps.now();
  const to = isoDay(now);
  const from = range === "year" ? `${now.getUTCFullYear()}-01-01` : isoDay(new Date(now.getTime() - CLAIM_WINDOW_DAYS * 86_400_000));
  const members = (await listMembers(deps.sql, ctx.householdId)).filter((m) => m.consentStatus !== "pending");
  const memberById = new Map(members.map((m) => [m.id, m]));
  const self = members.find((m) => m.relation === "self") ?? members[0];
  const catalogVersion = await currentCatalogVersion(deps.sql);
  const enrollments = new Map<string, Awaited<ReturnType<typeof loadRoutingEnrollments>>>();
  for (const m of members) enrollments.set(m.id, await loadRoutingEnrollments(deps.sql, m.id, catalogVersion));
  const covers = (memberId: string, c: BenefitCategory) => (enrollments.get(memberId) ?? []).some((e) => e.benefits[c]);

  // ---------- receipts ----------
  const receipts = await deps.sql`
    SELECT r.id, r.member_id, r.category, r.provider_name, r.service_date::text AS service_date, r.amount_agorot, r.sessions,
           r.confirmed_at, r.extraction_status,
           EXISTS (SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
                   WHERE cr.receipt_id = r.id AND c.status <> 'cancelled') AS claimed
    FROM receipts r
    WHERE r.household_id = ${ctx.householdId} AND r.deleted_at IS NULL
    ORDER BY r.service_date DESC NULLS FIRST`;

  const missed: MoneyItemDto[] = [];
  const unclaimedByService = new Map<string, number>();
  for (const r of receipts) {
    if (r.claimed) continue;
    const memberId = r.memberId as string | null;
    const member = memberId ? memberById.get(memberId) : undefined;
    const serviceDate = r.serviceDate as string | null;
    if (serviceDate && new Date(`${serviceDate}T00:00:00Z`).getTime() < now.getTime() - CLAIM_WINDOW_DAYS * 86_400_000) continue;
    if (!r.confirmedAt || !member || !r.category || !r.amountAgorot || !serviceDate) {
      if (r.extractionStatus === "pending" || r.extractionStatus === "processing") continue;
      missed.push({
        kind: "receipt_needs_details",
        title: "🧾 קבלה מחכה לאישור פרטים",
        detail: [r.providerName, r.amountAgorot ? `שולם ${formatILS(r.amountAgorot as number)}` : null].filter(Boolean).join(" · ") || null,
        amountAgorot: null,
        urgent: false,
        action: { type: "receipt", id: r.id as string },
      });
      continue;
    }
    const category = r.category as BenefitCategory;
    const { routing } = await routeForMember(deps.sql, {
      memberId: member.id,
      birthDate: member.birthDate,
      category,
      amountAgorot: r.amountAgorot as number,
      sessions: r.sessions as number,
      serviceDate,
    });
    const daysLeft = Math.floor(
      (new Date(`${serviceDate}T00:00:00Z`).getTime() + CLAIM_WINDOW_DAYS * 86_400_000 - now.getTime()) / 86_400_000,
    );
    const key = `${member.id}|${category}`;
    // The services list covers the selected range only; the "missed" list keeps everything still claimable.
    if (serviceDate >= from && serviceDate <= to) unclaimedByService.set(key, (unclaimedByService.get(key) ?? 0) + routing.totalExpectedAgorot);
    if (routing.totalExpectedAgorot === 0) continue;
    missed.push({
      kind: "unclaimed_receipt",
      title: `${CATEGORY_INFO[category].icon} ${CATEGORY_INFO[category].label} – ${member.fullName} לא נתבע`,
      detail: `${r.providerName ?? "קבלה"} · ${dateHe(serviceDate)} · שולם ${formatILS(r.amountAgorot as number)}${daysLeft <= EXPIRY_WARNING_DAYS ? ` · נשארו ${daysLeft} ימים לתבוע!` : ""}`,
      amountAgorot: routing.totalExpectedAgorot,
      urgent: daysLeft <= EXPIRY_WARNING_DAYS,
      action: { type: "receipt", id: r.id as string },
    });
  }

  // ---------- payments found on a card statement, still without a receipt ----------
  const leads = await deps.sql`
    SELECT id, merchant, paid_on::text AS paid_on, amount_agorot, category FROM payment_leads
    WHERE household_id = ${ctx.householdId} AND status = 'open' ORDER BY paid_on DESC`;
  for (const l of leads) {
    const lead = { amountAgorot: l.amountAgorot as number, date: l.paidOn as string };
    const matched = receipts.some(
      (r) => r.amountAgorot && r.serviceDate && samePayment(lead, { amountAgorot: r.amountAgorot as number, date: r.serviceDate as string }),
    );
    if (matched) continue;
    let estimate: number | null = null;
    if (l.category && self) {
      const { routing } = await routeForMember(deps.sql, {
        memberId: self.id,
        birthDate: self.birthDate,
        category: l.category as BenefitCategory,
        amountAgorot: lead.amountAgorot,
        sessions: 1,
        serviceDate: lead.date,
      });
      estimate = routing.totalExpectedAgorot;
    }
    missed.push({
      kind: "payment_without_receipt",
      title: `💳 שילמתם ל${l.merchant as string} – חסרה קבלה`,
      detail: `${dateHe(lead.date)} · ${formatILS(lead.amountAgorot)}${estimate ? " · החזר משוער" : ""}`,
      amountAgorot: estimate,
      urgent: false,
      action: { type: "lead", id: l.id as string },
    });
  }

  // ---------- claims ----------
  const claims = await deps.sql`
    SELECT c.id, c.member_id, c.category, c.status, c.provider_name, c.service_date::text AS service_date,
           c.amount_agorot, c.sessions,
           COALESCE(sum(l.paid_agorot) FILTER (WHERE l.status = 'paid'), 0)::int AS paid,
           COALESCE(sum(l.expected_agorot) FILTER (WHERE l.status NOT IN ('paid', 'rejected', 'skipped')), 0)::int AS open,
           COALESCE(sum(l.expected_agorot) FILTER (WHERE l.status = 'rejected'), 0)::int AS rejected
    FROM claims c LEFT JOIN claim_legs l ON l.claim_id = c.id
    WHERE c.household_id = ${ctx.householdId} AND c.status <> 'cancelled'
    GROUP BY c.id ORDER BY c.service_date DESC`;

  const waiting: MoneyItemDto[] = [];
  for (const c of claims) {
    const member = memberById.get(c.memberId as string);
    const category = c.category as BenefitCategory;
    const who = `${CATEGORY_INFO[category].icon} ${CATEGORY_INFO[category].label}${member ? ` – ${member.fullName}` : ""}`;
    const open = c.open as number;
    if (c.status === "awaiting_documents" && open > 0) {
      waiting.push({ kind: "missing_documents", title: `${who}: חסר מסמך`, detail: "בלי המסמך הכסף לא יוצא לדרך", amountAgorot: open, urgent: true, action: { type: "claim", id: c.id as string } });
    } else if (c.status === "ready" && open > 0) {
      waiting.push({ kind: "ready_to_submit", title: `${who}: מוכן להגשה`, detail: "נשאר רק להגיש", amountAgorot: open, urgent: false, action: { type: "claim", id: c.id as string } });
    } else if (open > 0) {
      waiting.push({ kind: "in_flight", title: `${who}: בטיפול`, detail: c.providerName as string | null, amountAgorot: open, urgent: false, action: { type: "claim", id: c.id as string } });
    }
    if ((c.rejected as number) > 0) {
      missed.push({
        kind: "rejected",
        title: `${who}: נדחה`,
        detail: "בדקו את סיבת הדחייה בתביעה – לפעמים חסר רק מסמך",
        amountAgorot: c.rejected as number,
        urgent: false,
        action: { type: "claim", id: c.id as string },
      });
    }
  }

  // ---------- services we use (member × category) in the range ----------
  const services = new Map<string, MoneyServiceDto>();
  const service = (memberId: string, category: BenefitCategory) => {
    const key = `${memberId}|${category}`;
    let s = services.get(key);
    if (!s) {
      const m = memberById.get(memberId);
      s = {
        memberId,
        memberName: m?.fullName ?? "",
        category,
        label: CATEGORY_INFO[category].label,
        icon: CATEGORY_INFO[category].icon,
        visits: 0,
        paidAgorot: 0,
        refundedAgorot: 0,
        waitingAgorot: 0,
        unclaimedAgorot: unclaimedByService.get(key) ?? 0,
        covered: covers(memberId, category),
      };
      services.set(key, s);
    }
    return s;
  };
  for (const r of receipts) {
    const d = r.serviceDate as string | null;
    if (!r.memberId || !r.category || !r.amountAgorot || !d || d < from || d > to || !memberById.has(r.memberId as string)) continue;
    const s = service(r.memberId as string, r.category as BenefitCategory);
    s.visits += r.sessions as number;
    s.paidAgorot += r.amountAgorot as number;
  }
  for (const c of claims) {
    const d = c.serviceDate as string;
    if (d < from || d > to || !memberById.has(c.memberId as string)) continue;
    const s = service(c.memberId as string, c.category as BenefitCategory);
    s.refundedAgorot += c.paid as number;
    s.waitingAgorot += c.open as number;
  }
  const serviceList = [...services.values()].sort((a, b) => b.paidAgorot - a.paidAgorot);

  // ---------- where we can still save ----------
  const save: MoneyItemDto[] = [];
  const yearEnd = `31/12/${now.getUTCFullYear()}`;
  // Quotas worth reminding about: services this person actually used in the range that have sessions left.
  for (const q of await unusedQuotas(deps, ctx.householdId, from)) {
    save.push({
      kind: "unused_quota",
      title: `${q.icon} נשארו ל${q.memberName} ${q.left} מפגשי ${q.label} עד ${yearEnd}`,
      detail: `${q.planName} · בערך ${formatILS(q.valueEachAgorot)} החזר לכל אחד`,
      amountAgorot: q.valueEachAgorot * q.left,
      urgent: now.getUTCMonth() >= 9,
      action: { type: "plan_visit", memberId: q.memberId, category: q.category },
    });
  }
  for (const s of serviceList) {
    if (!s.covered && s.paidAgorot > 0) {
      save.push({
        kind: "uncovered_spend",
        title: `${s.icon} שילמתם ${formatILS(s.paidAgorot)} על ${s.label}${members.length > 1 ? ` (${s.memberName})` : ""} – בלי כיסוי`,
        detail: "לא מצאנו ביטוח שמחזיר על זה. אם יש לכם פוליסה שלא הוספתם – ייבאו מהר הביטוח. (מידע, לא המלצה לרכוש ביטוח)",
        amountAgorot: null,
        urgent: false,
        action: { type: "benefits" },
      });
    } else if (s.covered && s.paidAgorot >= LOW_REFUND_MIN_PAID) {
      const share = (s.refundedAgorot + s.waitingAgorot + s.unclaimedAgorot) / s.paidAgorot;
      if (share < LOW_REFUND_SHARE) {
        save.push({
          kind: "low_refund",
          title: `${s.icon} על ${s.label}${members.length > 1 ? ` (${s.memberName})` : ""} חוזר רק ${Math.round(share * 100)}%`,
          detail: "כדאי לבדוק מטפל בהסדר של הקופה או הביטוח – לפעמים ההשתתפות העצמית נמוכה מהעלות נטו אצל פרטי",
          amountAgorot: null,
          urgent: false,
          action: { type: "benefits" },
        });
      }
    }
  }
  const missingTerms = await deps.sql`
    SELECT e.member_id, e.plan_id, p.name_he FROM enrollments e
    JOIN members m ON m.id = e.member_id JOIN plans p ON p.id = e.plan_id
    WHERE m.household_id = ${ctx.householdId} AND m.deleted_at IS NULL AND e.custom_benefits = '{}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM benefits b WHERE b.plan_id = e.plan_id AND b.catalog_version = ${catalogVersion})`;
  for (const t of missingTerms) {
    save.push({
      kind: "missing_terms",
      title: `✎ ${t.nameHe as string}: עוד לא יודעים כמה הוא מחזיר`,
      detail: "הזינו את התנאים מהפוליסה כדי שנחשב גם אותו",
      amountAgorot: null,
      urgent: false,
      action: { type: "policy", memberId: t.memberId as string, planId: t.planId as string },
    });
  }

  // Urgent first, then money.
  const order = (a: MoneyItemDto, b: MoneyItemDto) => Number(b.urgent) - Number(a.urgent) || (b.amountAgorot ?? 0) - (a.amountAgorot ?? 0);
  missed.sort(order);
  waiting.sort(order);
  save.sort(order);

  // Next steps: things the user can act on now. "In flight" claims only need patience.
  const NOT_ACTIONABLE = new Set<MoneyItemDto["kind"]>(["in_flight", "uncovered_spend", "low_refund"]);
  // Money already paid out comes before future savings; within each, urgent first, then the bigger amount.
  const nextSteps = [...[...missed, ...waiting].sort(order), ...save.filter((i) => i.amountAgorot)]
    .filter((i) => !NOT_ACTIONABLE.has(i.kind) && i.action)
    .slice(0, 4);

  const [found] = await deps.sql`
    SELECT
      (SELECT count(*)::int FROM receipts WHERE household_id = ${ctx.householdId} AND deleted_at IS NULL) AS receipts,
      EXISTS (SELECT 1 FROM enrollments e JOIN members m ON m.id = e.member_id
              WHERE m.household_id = ${ctx.householdId} AND e.source = 'har_habituach') AS imported,
      EXISTS (SELECT 1 FROM audit_log WHERE entity = 'household' AND entity_id = ${ctx.householdId}::text
              AND action = 'card_statement_scanned') AS scanned,
      EXISTS (SELECT 1 FROM enrollments e JOIN members m ON m.id = e.member_id
              WHERE m.household_id = ${ctx.householdId} AND e.monthly_premium_agorot IS NOT NULL) AS premiums,
      EXISTS (SELECT 1 FROM receipts WHERE household_id = ${ctx.householdId} AND source = 'email') AS email,
      EXISTS (SELECT 1 FROM bank_connections WHERE household_id = ${ctx.householdId} AND status = 'active') AS bank`;

  return {
    range,
    from,
    to,
    paidAgorot: serviceList.reduce((s, x) => s + x.paidAgorot, 0),
    refundedAgorot: serviceList.reduce((s, x) => s + x.refundedAgorot, 0),
    waitingAgorot: sum(waiting),
    missed: { totalAgorot: sum(missed), items: missed },
    waiting: { totalAgorot: sum(waiting), items: waiting },
    save: { totalAgorot: sum(save), items: save },
    services: serviceList,
    nextSteps,
    discovery: {
      receipts: found!.receipts as number,
      policiesImported: found!.imported as boolean,
      cardScanned: found!.scanned as boolean,
      premiumsEntered: found!.premiums as boolean,
      emailInbox: found!.email as boolean,
      bankConnected: found!.bank as boolean,
    },
  };
}
