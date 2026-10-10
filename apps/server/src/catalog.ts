import { benefitRuleSchema, type BenefitCategory, type BenefitRule, type PlanKind } from "@magiali/shared";
import type { Db } from "./db";

type RuleInput = Partial<BenefitRule> & ({ percent: number } | { perSessionFixedAgorot: number });

interface SeedPayer {
  id: string;
  name: string;
  kind: "shaban" | "insurer";
  webUrl: string;
  avgProcessingDays: number;
}

interface SeedPlan {
  id: string;
  payerId: string;
  name: string;
  kind: PlanKind;
  benefits: Partial<Record<BenefitCategory, RuleInput>>;
}

/**
 * ⚠️ ILLUSTRATIVE VALUES ONLY – for development and tests.
 * Before launch, operations replaces every rule with values verified against the plan's official terms
 * (תקנון שב"ן / נספח הפוליסה) and records the source in benefits.source_note.
 */
const SOURCE_NOTE = "seed: ערכי המחשה בלבד – יש לאמת מול תקנון/נספח לפני השקה";

export const SEED_PAYERS: SeedPayer[] = [
  { id: "clalit", name: "כללית", kind: "shaban", webUrl: "https://www.clalit.co.il", avgProcessingDays: 30 },
  {
    id: "maccabi",
    name: "מכבי",
    kind: "shaban",
    webUrl: "https://www.maccabi4u.co.il/31276/digital-services/administration/refund_request/",
    avgProcessingDays: 45,
  },
  { id: "meuhedet", name: "מאוחדת", kind: "shaban", webUrl: "https://www.meuhedet.co.il", avgProcessingDays: 30 },
  { id: "leumit", name: "לאומית", kind: "shaban", webUrl: "https://www.leumit.co.il", avgProcessingDays: 30 },
  { id: "harel", name: "הראל", kind: "insurer", webUrl: "https://www.harel-group.co.il", avgProcessingDays: 14 },
  {
    id: "clal",
    name: "כלל ביטוח",
    kind: "insurer",
    webUrl: "https://www.clalbit.co.il/claims/claimsmedicalexpenses/",
    avgProcessingDays: 14,
  },
  { id: "phoenix", name: "הפניקס", kind: "insurer", webUrl: "https://www.fnx.co.il", avgProcessingDays: 14 },
  { id: "migdal", name: "מגדל", kind: "insurer", webUrl: "https://www.migdal.co.il", avgProcessingDays: 14 },
];

const shabanBasic: SeedPlan["benefits"] = {
  specialist_visit: { percent: 50, perSessionCapAgorot: 25000, annualSessions: 6 },
  physiotherapy: { perSessionFixedAgorot: 6000, annualSessions: 12 },
  psychology: { perSessionFixedAgorot: 7000, annualSessions: 12, requiredDocs: ["receipt", "referral"] },
  child_development: {
    percent: 50,
    perSessionCapAgorot: 15000,
    annualSessions: 24,
    maxAge: 18,
    requiredDocs: ["receipt", "visit_summary"],
  },
  alternative_medicine: { perSessionFixedAgorot: 5000, annualSessions: 8 },
  glasses_lenses: { percent: 50, annualCapAgorot: 30000 },
  second_opinion: { percent: 75, perSessionCapAgorot: 50000, annualSessions: 2 },
};

const shabanPremium: SeedPlan["benefits"] = {
  specialist_visit: { percent: 75, perSessionCapAgorot: 35000, annualSessions: 8 },
  physiotherapy: { perSessionFixedAgorot: 8000, annualSessions: 16 },
  psychology: { perSessionFixedAgorot: 8500, annualSessions: 12, requiredDocs: ["receipt", "referral"] },
  child_development: {
    percent: 60,
    perSessionCapAgorot: 20000,
    annualSessions: 30,
    maxAge: 18,
    requiredDocs: ["receipt", "visit_summary"],
  },
  alternative_medicine: { perSessionFixedAgorot: 7000, annualSessions: 12 },
  glasses_lenses: { percent: 60, annualCapAgorot: 40000 },
  second_opinion: { percent: 80, perSessionCapAgorot: 70000, annualSessions: 3 },
  diagnostic_imaging: { percent: 50, annualCapAgorot: 150000, requiredDocs: ["receipt", "referral"] },
};

const privateAmbulatory: SeedPlan["benefits"] = {
  specialist_visit: { percent: 80, perSessionCapAgorot: 50000, annualSessions: 3, requiredDocs: ["receipt", "referral"] },
  diagnostic_imaging: { percent: 100, annualCapAgorot: 308000, requiredDocs: ["receipt", "referral"] },
  physiotherapy: { percent: 70, annualSessions: 12, requiredDocs: ["receipt", "referral"] },
  psychology: { percent: 50, perSessionCapAgorot: 40000, annualSessions: 20, requiredDocs: ["receipt", "referral"] },
  child_development: { percent: 60, maxAge: 18, requiredDocs: ["receipt", "visit_summary"] },
  second_opinion: { percent: 100, perSessionCapAgorot: 61000, annualSessions: 2 },
  medical_devices: { percent: 80, annualCapAgorot: 400000, requiredDocs: ["receipt", "referral"] },
};

const groupPlan: SeedPlan["benefits"] = {
  specialist_visit: { percent: 75, perSessionCapAgorot: 40000 },
  physiotherapy: { percent: 80, annualSessions: 20 },
  psychology: { percent: 50, perSessionCapAgorot: 40000, annualSessions: 20 },
  diagnostic_imaging: { percent: 100, annualCapAgorot: 300000, requiredDocs: ["receipt", "referral"] },
  alternative_medicine: { percent: 50, perSessionCapAgorot: 15000, annualSessions: 12 },
};

export const SEED_PLANS: SeedPlan[] = [
  { id: "clalit_mushlam", payerId: "clalit", name: "כללית מושלם", kind: "shaban", benefits: shabanBasic },
  { id: "clalit_platinum", payerId: "clalit", name: "כללית מושלם פלטינום", kind: "shaban", benefits: shabanPremium },
  { id: "maccabi_zahav", payerId: "maccabi", name: "מכבי זהב", kind: "shaban", benefits: shabanBasic },
  { id: "maccabi_sheli", payerId: "maccabi", name: "מכבי שלי", kind: "shaban", benefits: shabanPremium },
  { id: "meuhedet_adif", payerId: "meuhedet", name: "מאוחדת עדיף", kind: "shaban", benefits: shabanBasic },
  { id: "meuhedet_shia", payerId: "meuhedet", name: "מאוחדת שיא", kind: "shaban", benefits: shabanPremium },
  { id: "leumit_kesef", payerId: "leumit", name: "לאומית כסף", kind: "shaban", benefits: shabanBasic },
  { id: "leumit_zahav", payerId: "leumit", name: "לאומית זהב", kind: "shaban", benefits: shabanPremium },
  {
    id: "harel_ambulatory",
    payerId: "harel",
    name: "הראל – שירותים אמבולטוריים",
    kind: "private_individual",
    benefits: privateAmbulatory,
  },
  {
    id: "clal_ambulatory",
    payerId: "clal",
    name: "כלל – שירותים אמבולטוריים",
    kind: "private_individual",
    benefits: privateAmbulatory,
  },
  {
    id: "phoenix_ambulatory",
    payerId: "phoenix",
    name: "הפניקס – שירותים אמבולטוריים",
    kind: "private_individual",
    benefits: privateAmbulatory,
  },
  {
    id: "migdal_group",
    payerId: "migdal",
    name: "ביטוח בריאות קבוצתי (מגדל)",
    kind: "private_group",
    benefits: groupPlan,
  },
];

/** Inserts payers, plans, and the first catalog version if the catalog is empty. Idempotent. */
export async function seedCatalog(db: Db): Promise<void> {
  const [existing] = await db`SELECT count(*)::int AS n FROM catalog_versions`;
  if ((existing?.n as number) > 0) return;

  for (const p of SEED_PAYERS) {
    await db`
      INSERT INTO payers (id, name_he, kind, web_url, avg_processing_days)
      VALUES (${p.id}, ${p.name}, ${p.kind}, ${p.webUrl}, ${p.avgProcessingDays})
      ON CONFLICT (id) DO NOTHING`;
  }
  for (const plan of SEED_PLANS) {
    await db`
      INSERT INTO plans (id, payer_id, name_he, plan_kind)
      VALUES (${plan.id}, ${plan.payerId}, ${plan.name}, ${plan.kind})
      ON CONFLICT (id) DO NOTHING`;
  }
  await publishCatalogVersion(
    db,
    SEED_PLANS.flatMap((plan) =>
      Object.entries(plan.benefits).map(([category, rule]) => ({
        planId: plan.id,
        category: category as BenefitCategory,
        rule: rule as RuleInput,
        sourceNote: SOURCE_NOTE,
      })),
    ),
    "initial seed",
  );
}

export async function publishCatalogVersion(
  db: Db,
  benefits: Array<{ planId: string; category: BenefitCategory; rule: unknown; sourceNote?: string }>,
  notes: string,
): Promise<number> {
  const [version] = await db`INSERT INTO catalog_versions (notes) VALUES (${notes}) RETURNING id`;
  const versionId = version!.id as number;
  for (const b of benefits) {
    const rule = benefitRuleSchema.parse(b.rule);
    await db`
      INSERT INTO benefits (catalog_version, plan_id, category, rule, source_note)
      VALUES (${versionId}, ${b.planId}, ${b.category}, ${db.json(rule as never)}, ${b.sourceNote ?? null})`;
  }
  return versionId;
}

export async function currentCatalogVersion(db: Db): Promise<number> {
  const [row] = await db`SELECT max(id)::int AS id FROM catalog_versions`;
  if (!row?.id) throw new Error("coverage catalog is empty");
  return row.id as number;
}
