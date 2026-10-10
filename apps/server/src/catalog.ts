import { benefitRuleSchema, type BenefitCategory, type BenefitRule, type PlanKind } from "@magiali/shared";
import type { Db } from "./db";

type RuleInput = Partial<BenefitRule> & ({ percent: number } | { perSessionFixedAgorot: number });

/** official = the payer's own page/rulebook; secondary = official text seen only via search extracts or a broker. */
type Confidence = "official" | "secondary";

interface SeedBenefit {
  rule: RuleInput;
  confidence: Confidence;
  source: string;
  note?: string;
}

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
  description?: string;
  benefits: Partial<Record<BenefitCategory, SeedBenefit>>;
}

/**
 * Coverage catalog, researched October 2026 (docs/research/). Every value carries its source and a confidence level,
 * which the app shows next to it. Only REFUNDS for privately paid care are listed: benefits that exist only inside a
 * payer's own network (discounted prices / co-pays) are left out on purpose, because there is nothing to claim.
 * Before charging real fees, operations should open each source and confirm the numbers (docs/catalog-review.md).
 * Bump CATALOG_EDITION whenever values change: the server publishes a new catalog version on start.
 */
export const CATALOG_EDITION = "2026-10 researched";

const SRC = {
  clalitSpecialist: "https://www.clalit.co.il/he/myrights/medical-tests/Pages/medical-specialist.aspx",
  clalitSecondOpinion: "https://mushlam.clalit.co.il/he/consultation/Pages/second_opinion_refund.aspx",
  clalitPhysio: "https://www.clalit.co.il/he/myrights/physiotherapy/Pages/physiotherapy-general.aspx",
  clalitChild: "https://mushlam.clalit.co.il/he/development/Pages/child_development10-17.aspx",
  clalitCompare: "https://mushlam.clalit.co.il/he/Pages/compare.aspx",
  maccabiSpecialist: "https://www.maccabi4u.co.il/eligibilites/4335/",
  maccabiZahavRules: "https://www.maccabi4u.co.il/media/lxtetxif/maccabi_zahav_regulations.pdf",
  maccabiSheliRules: "https://www.maccabi4u.co.il/media/no1nug5m/maccabi_sheli_regulations.pdf",
  meuhedetAdif: "https://www.meuhedet.co.il/media/8363/%D7%A2%D7%93%D7%99%D7%A3-%D7%99%D7%95%D7%9C%D7%99-2026.pdf",
  meuhedetSi:
    "https://www.meuhedet.co.il/%D7%91%D7%99%D7%98%D7%95%D7%97%D7%99%D7%9D/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%A9%D7%99%D7%90/%D7%97%D7%95%D7%95%D7%AA-%D7%93%D7%A2%D7%AA-%D7%A0%D7%95%D7%A1%D7%A4%D7%AA/",
  leumitAgreement:
    "https://www.leumit.co.il/media/lbahr5ri/%D7%97%D7%95%D7%91%D7%A8%D7%AA-%D7%9C%D7%90%D7%95%D7%9E%D7%99%D7%AA-%D7%96%D7%94%D7%91-%D7%95%D7%9B%D7%A1%D7%A3-91125.pdf",
  govChildDev: "https://call.gov.il/infocenter/index?page=content&id=EL7317",
  harel527: "https://www.harel-group.co.il/P/14924.pdf",
  harelChild: "https://www.harel-group.co.il/insurance/health/policies/child-development",
  clal4065: "https://www.clalbit.co.il/healthins/consultationsandexamination/",
  clalChild: "https://www.onyourside.co.il/policy/%D7%9B%D7%9C%D7%9C/%D7%9E%D7%93%D7%99%D7%9B%D7%9C%D7%9C-%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99%D7%9D-%D7%9C%D7%99%D7%9C%D7%93",
  phoenix6782: "https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/gilui-6782-1124.pdf",
  migdal2395: "https://storageblobwebprod.blob.core.windows.net/mediaprod/23991/consultations-and-extended-diagnostic-tests-032024.pdf",
  migdal2378: "https://storageblobwebprod.blob.core.windows.net/mediaprod/23993/bituah_yauz_vebdikot_ivhuniot.pdf",
  migdalComplementary: "https://www.migdal.co.il/product/health-complementary-medicine",
} as const;

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
  { id: "menora", name: "מנורה מבטחים", kind: "insurer", webUrl: "https://www.menoramivt.co.il", avgProcessingDays: 14 },
  { id: "ayalon", name: "איילון", kind: "insurer", webUrl: "https://www.ayalon-ins.co.il", avgProcessingDays: 14 },
  { id: "hachshara", name: "הכשרה", kind: "insurer", webUrl: "https://www.hcsra.co.il", avgProcessingDays: 14 },
];

/** Every private insurer gets a generic individual plan and a group plan whose terms the user enters from the policy. */
const PRIVATE_INSURERS = ["harel", "clal", "phoenix", "migdal", "menora", "ayalon", "hachshara"] as const;

const official = (rule: RuleInput, source: string, note?: string): SeedBenefit => ({ rule, confidence: "official", source, note });
const secondary = (rule: RuleInput, source: string, note?: string): SeedBenefit => ({ rule, confidence: "secondary", source, note });

// ---- HMO supplementary plans (שב"ן). Specialist visit and second opinion are one benefit (one shared quota). ----

const clalitConsult = official({ percent: 80, perSessionCapAgorot: 71500, annualSessions: 3 }, SRC.clalitSpecialist, "רופא מרשימת היועצים של מושלם; תקופת המתנה 6 חודשים; 3 התייעצויות בשנה בהחזר ובהסדר יחד");
const clalitZahav: SeedPlan["benefits"] = {
  specialist_visit: clalitConsult,
  second_opinion: { ...clalitConsult, source: SRC.clalitSecondOpinion },
  physiotherapy: official(
    { percent: 75, perSessionCapAgorot: 11100, annualSessions: 24, minAge: 18, requiredDocs: ["receipt", "referral"] },
    SRC.clalitPhysio,
    "הפניה מרופא כללית; תקופת המתנה 6 חודשים",
  ),
  child_development: official(
    { percent: 75, perSessionCapAgorot: 12500, annualSessions: 30, minAge: 3, maxAge: 17, requiredDocs: ["receipt", "referral"] },
    SRC.clalitChild,
    "גילאי 3–9: עד 45 טיפולים בשנה (נרשם 30, השמרני); קודם מנצלים את זכאות הסל; אבחון מומחה",
  ),
  psychology: official(
    { percent: 75, perSessionCapAgorot: 12500, minAge: 3, maxAge: 17, requiredDocs: ["receipt", "referral"] },
    SRC.clalitChild,
    "ילדים בלבד, נספר במכסת התפתחות הילד. למבוגרים אין החזר (רק בהסדר)",
  ),
};
const clalitPlatinum: SeedPlan["benefits"] = {
  ...clalitZahav,
  child_development: official(
    { percent: 75, perSessionCapAgorot: 12500, annualSessions: 55, minAge: 3, maxAge: 17, requiredDocs: ["receipt", "referral"] },
    SRC.clalitCompare,
    "פלטינום מוסיף 25 טיפולים בשנה על מושלם זהב (גילאי 3–9: עד 70)",
  ),
};

const maccabiConsult = official(
  { percent: 80, perSessionCapAgorot: 73082, annualSessions: 3, requiredDocs: ["receipt", "visit_summary"] },
  SRC.maccabiSpecialist,
  "רופאים מרשימת המדריך בלבד; תקופת המתנה 6 חודשים. מכבי לא מחזירה על טיפולים פרטיים אחרים (רק בהסדר)",
);
const maccabi: SeedPlan["benefits"] = {
  specialist_visit: maccabiConsult,
  second_opinion: { ...maccabiConsult, source: SRC.maccabiZahavRules },
};

const meuhedetAdifConsult = secondary(
  { percent: 85, perSessionCapAgorot: 79200, annualSessions: 3 },
  SRC.meuhedetAdif,
  "תקנון עדיף יולי 2026; התקרה (792 ₪) לא נקראה בבירור – לאמת; תקופת המתנה 6 חודשים",
);
const meuhedetSiConsult = secondary(
  { percent: 85, perSessionCapAgorot: 79200, annualSessions: 4 },
  SRC.meuhedetSi,
  "שיא מוסיף התייעצות אחת על 3 של עדיף (סה״כ 4); התקרה לפי עדיף – לאמת",
);

const leumit = (consultsPerYear: number, childCapAgorot: number, childSessions: number): SeedPlan["benefits"] => {
  const consult = secondary(
    { percent: 80, perSessionCapAgorot: 69000, annualSessions: consultsPerYear },
    SRC.leumitAgreement,
    "יועצים מרשימת לאומית בלבד; לילדים יש התייעצות נוספת; התקרה (690 ₪) – לאמת",
  );
  return {
    specialist_visit: consult,
    second_opinion: consult,
    child_development: secondary(
      { percent: 100, perSessionCapAgorot: childCapAgorot, annualSessions: childSessions, maxAge: 17 },
      SRC.govChildDev,
      "החזר עד תקרה לטיפול (שיעור ההחזר לא צוין – לאמת)",
    ),
  };
};

// ---- Private policies. Terms differ by product and edition, so these are starting templates the user confirms
// or edits from their own policy ("התאמה לפוליסה שלי"). None is a "משלים שב"ן" product: each pays from the first
// shekel and, after the shaban, only up to what is still uncovered. ----

const harelBasic: SeedPlan["benefits"] = {
  diagnostic_imaging: official(
    { percent: 80, annualCapAgorot: 2000000, requiredDocs: ["receipt", "referral"] },
    SRC.harel527,
    "תקרה שנתית 20,000 ₪ משותפת לכל פרקי הכיסוי; ייעוץ אצל רופא בהסדר: השתתפות עצמית 150 ₪ (אין מה לתבוע)",
  ),
  lab_tests: secondary({ percent: 80, annualCapAgorot: 2000000, requiredDocs: ["receipt", "referral"] }, SRC.harel527, "באותה תקרה שנתית"),
  second_opinion: secondary(
    { percent: 100, perSessionCapAgorot: 150000 },
    SRC.harel527,
    "חוות דעת ממומחה באונקולוגיה, נוירולוגיה או קרדיולוגיה בלבד",
  ),
};
const harelChild: SeedPlan["benefits"] = {
  child_development: official(
    { percent: 50, perSessionCapAgorot: 30000, annualCapAgorot: 300000, maxAge: 21, requiredDocs: ["receipt", "referral"] },
    SRC.harelChild,
    "עד 300 ₪ לטיפול ועד 3,000 ₪ לשנת ביטוח",
  ),
};
const clalConsult: SeedPlan["benefits"] = {
  specialist_visit: official({ percent: 80, perSessionCapAgorot: 80000, annualSessions: 6 }, SRC.clal4065, "עד 6 התייעצויות לשנת ביטוח"),
  diagnostic_imaging: official(
    { percent: 80, perSessionCapAgorot: 450000, annualCapAgorot: 1350000, requiredDocs: ["receipt", "referral"] },
    SRC.clal4065,
    "תקרה שנתית מצטברת 13,500 ₪; התקרה לבדיקה (4,500 ₪) – לאמת",
  ),
};
const clalChild: SeedPlan["benefits"] = {
  child_development: secondary(
    { percent: 80, perSessionCapAgorot: 12000, annualSessions: 10, requiredDocs: ["receipt", "referral"] },
    SRC.clalChild,
    "פיזיותרפיה וריפוי בעיסוק; קלינאות תקשורת: עד 90 ₪, 15 טיפולים (מקור: אתר משווה – לאמת)",
  ),
};
const phoenixConsult: SeedPlan["benefits"] = {
  specialist_visit: official({ percent: 80, perSessionCapAgorot: 80000 }, SRC.phoenix6782, "מהדורה 11/2024 (במהדורות קודמות 700 ₪); אונקולוגיה עד 1,600 ₪"),
  diagnostic_imaging: secondary(
    { percent: 80, perSessionCapAgorot: 450000, requiredDocs: ["receipt", "referral"] },
    SRC.phoenix6782,
    "MRI עד 4,500 ₪; CT/רנטגן עד 1,500 ₪; אולטרסאונד עד 500 ₪",
  ),
  lab_tests: secondary({ percent: 80, requiredDocs: ["receipt", "referral"] }, SRC.phoenix6782),
};
const migdalConsult: SeedPlan["benefits"] = {
  specialist_visit: secondary(
    { percent: 80, perSessionCapAgorot: 80000, annualSessions: 6 },
    SRC.migdal2395,
    "רופא שלא בהסדר; אונקולוגיה/נוירולוגיה/קרדיולוגיה עד 1,500 ₪. רופא בהסדר: השתתפות עצמית 250 ₪",
  ),
  diagnostic_imaging: secondary(
    { percent: 80, annualCapAgorot: 2000000, requiredDocs: ["receipt", "referral"] },
    SRC.migdal2378,
    "ההשתתפות העצמית (20%) מחושבת לפי תעריף משרד הבריאות – ההחזר בפועל עשוי להיות נמוך מהחישוב",
  ),
  child_development: secondary({ percent: 80, perSessionCapAgorot: 100000 }, SRC.migdal2395, "אבחון פסיכודידקטי בלבד, עד 1,000 ₪"),
};
const migdalComplementary: SeedPlan["benefits"] = {
  alternative_medicine: official(
    { percent: 50, perSessionCapAgorot: 12000, annualSessions: 16 },
    SRC.migdalComplementary,
    "מטפל שלא בהסדר: 50% עד 120 ₪ לטיפול. בהסדר: 55 ₪ השתתפות (אין מה לתבוע)",
  ),
};

export const SEED_PLANS: SeedPlan[] = [
  { id: "clalit_mushlam", payerId: "clalit", name: "כללית מושלם זהב", kind: "shaban", benefits: clalitZahav },
  { id: "clalit_platinum", payerId: "clalit", name: "כללית מושלם פלטינום", kind: "shaban", description: "כולל את מושלם זהב", benefits: clalitPlatinum },
  { id: "maccabi_zahav", payerId: "maccabi", name: "מכבי זהב", kind: "shaban", benefits: maccabi },
  { id: "maccabi_sheli", payerId: "maccabi", name: "מכבי שלי", kind: "shaban", description: "כולל את מכבי זהב", benefits: maccabi },
  { id: "meuhedet_adif", payerId: "meuhedet", name: "מאוחדת עדיף", kind: "shaban", benefits: { specialist_visit: meuhedetAdifConsult, second_opinion: meuhedetAdifConsult } },
  { id: "meuhedet_shia", payerId: "meuhedet", name: "מאוחדת שיא", kind: "shaban", description: "כולל את מאוחדת עדיף", benefits: { specialist_visit: meuhedetSiConsult, second_opinion: meuhedetSiConsult } },
  { id: "leumit_kesef", payerId: "leumit", name: "לאומית כסף", kind: "shaban", benefits: leumit(1, 11400, 30) },
  { id: "leumit_zahav", payerId: "leumit", name: "לאומית זהב", kind: "shaban", benefits: leumit(3, 15200, 55) },
  { id: "harel_consult_527", payerId: "harel", name: "הראל – ייעוץ ובדיקות", kind: "private_individual", description: "תכנית 527, מהדורה 09/2024", benefits: harelBasic },
  { id: "harel_child_521", payerId: "harel", name: "הראל – טיפולים ואבחונים לילד", kind: "private_individual", description: "תכנית 521", benefits: harelChild },
  { id: "clal_consult_4065", payerId: "clal", name: "כלל – מדיכלל ייעוץ ובדיקות", kind: "private_individual", description: "תכנית 4065, 2025", benefits: clalConsult },
  { id: "clal_child_3061", payerId: "clal", name: "כלל – מדיכלל שירותים לילד", kind: "private_individual", description: "תכנית 3061", benefits: clalChild },
  { id: "phoenix_consult_6782", payerId: "phoenix", name: "הפניקס – ייעוץ ובדיקות", kind: "private_individual", description: "תכנית 6782, מהדורה 11/2024", benefits: phoenixConsult },
  { id: "migdal_consult_2395", payerId: "migdal", name: "מגדל – ייעוץ ובדיקות אבחנתיות", kind: "private_individual", description: "מורחב 2395, 03/2024", benefits: migdalConsult },
  { id: "migdal_complementary", payerId: "migdal", name: "מגדל – רפואה משלימה", kind: "private_individual", description: "כתב שירות 2386", benefits: migdalComplementary },
  ...PRIVATE_INSURERS.flatMap((payerId): SeedPlan[] => {
    const name = SEED_PAYERS.find((p) => p.id === payerId)!.name;
    return [
      {
        id: `${payerId}_health`,
        payerId,
        name: `${name} – ביטוח בריאות (תנאים לפי הפוליסה)`,
        kind: "private_individual",
        description: "לא זיהינו את המוצר המדויק – מזינים את התנאים מהפוליסה",
        benefits: {},
      },
      {
        id: `group_${payerId}`,
        payerId,
        name: `ביטוח קבוצתי (מהעבודה) – ${name}`,
        kind: "private_group",
        description: "התנאים שונים בכל מקום עבודה – מזינים אותם מהפוליסה",
        benefits: {},
      },
    ];
  }),
];

/**
 * Brings payers, plans and the published catalog in line with this file. Idempotent: a new catalog version is
 * published only when CATALOG_EDITION changes. Plans no longer listed are deactivated (old enrollments keep working
 * with any values the user entered for them).
 */
export async function seedCatalog(db: Db): Promise<void> {
  for (const p of SEED_PAYERS) {
    await db`
      INSERT INTO payers (id, name_he, kind, web_url, avg_processing_days)
      VALUES (${p.id}, ${p.name}, ${p.kind}, ${p.webUrl}, ${p.avgProcessingDays})
      ON CONFLICT (id) DO UPDATE SET name_he = EXCLUDED.name_he, web_url = EXCLUDED.web_url,
        avg_processing_days = EXCLUDED.avg_processing_days`;
  }
  for (const plan of SEED_PLANS) {
    await db`
      INSERT INTO plans (id, payer_id, name_he, plan_kind, description, active)
      VALUES (${plan.id}, ${plan.payerId}, ${plan.name}, ${plan.kind}, ${plan.description ?? null}, true)
      ON CONFLICT (id) DO UPDATE SET name_he = EXCLUDED.name_he, plan_kind = EXCLUDED.plan_kind,
        description = EXCLUDED.description, active = true`;
  }
  await db`UPDATE plans SET active = false WHERE id NOT IN ${db(SEED_PLANS.map((p) => p.id))}`;

  const [latest] = await db`SELECT notes FROM catalog_versions ORDER BY id DESC LIMIT 1`;
  if (latest?.notes === CATALOG_EDITION) return;
  await publishCatalogVersion(
    db,
    SEED_PLANS.flatMap((plan) =>
      Object.entries(plan.benefits).map(([category, b]) => ({
        planId: plan.id,
        category: category as BenefitCategory,
        rule: b!.rule,
        confidence: b!.confidence,
        sourceNote: [b!.note, b!.source].filter(Boolean).join(" | "),
      })),
    ),
    CATALOG_EDITION,
  );
}

export async function publishCatalogVersion(
  db: Db,
  benefits: Array<{ planId: string; category: BenefitCategory; rule: unknown; sourceNote?: string; confidence?: Confidence | "unverified" }>,
  notes: string,
): Promise<number> {
  const [version] = await db`INSERT INTO catalog_versions (notes) VALUES (${notes}) RETURNING id`;
  const versionId = version!.id as number;
  for (const b of benefits) {
    const rule = benefitRuleSchema.parse(b.rule);
    await db`
      INSERT INTO benefits (catalog_version, plan_id, category, rule, source_note, confidence)
      VALUES (${versionId}, ${b.planId}, ${b.category}, ${db.json(rule as never)}, ${b.sourceNote ?? null}, ${b.confidence ?? "unverified"})`;
  }
  return versionId;
}

export async function currentCatalogVersion(db: Db): Promise<number> {
  const [row] = await db`SELECT max(id)::int AS id FROM catalog_versions`;
  if (!row?.id) throw new Error("coverage catalog is empty");
  return row.id as number;
}
