import { publishCatalogVersion } from "../src/catalog";
import type { Db } from "../src/db";

/**
 * Fixed coverage rules for engine/flow tests, independent of the researched production catalog
 * (which changes whenever an HMO or insurer updates its terms).
 */
const shabanBasic = {
  specialist_visit: { percent: 50, perSessionCapAgorot: 25000, annualSessions: 6 },
  physiotherapy: { perSessionFixedAgorot: 6000, annualSessions: 12 },
  psychology: { perSessionFixedAgorot: 7000, annualSessions: 12, requiredDocs: ["receipt", "referral"] },
  child_development: { percent: 50, perSessionCapAgorot: 15000, annualSessions: 24, maxAge: 18, requiredDocs: ["receipt", "visit_summary"] },
  second_opinion: { percent: 75, perSessionCapAgorot: 50000, annualSessions: 2 },
};
const shabanPremium = {
  ...shabanBasic,
  psychology: { perSessionFixedAgorot: 8500, annualSessions: 12, requiredDocs: ["receipt", "referral"] },
  child_development: { percent: 60, perSessionCapAgorot: 20000, annualSessions: 30, maxAge: 18, requiredDocs: ["receipt", "visit_summary"] },
  second_opinion: { percent: 80, perSessionCapAgorot: 70000, annualSessions: 3 },
};
const privateAmbulatory = {
  specialist_visit: { percent: 80, perSessionCapAgorot: 50000, annualSessions: 3, requiredDocs: ["receipt", "referral"] },
  psychology: { percent: 50, perSessionCapAgorot: 40000, annualSessions: 20, requiredDocs: ["receipt", "referral"] },
  child_development: { percent: 60, maxAge: 18, requiredDocs: ["receipt", "visit_summary"] },
  second_opinion: { percent: 100, perSessionCapAgorot: 61000, annualSessions: 2 },
};

const FIXTURE: Record<string, Record<string, unknown>> = {
  clalit_mushlam: shabanBasic,
  maccabi_zahav: shabanBasic,
  maccabi_sheli: shabanPremium,
  harel_ambulatory: privateAmbulatory,
};

export async function useTestCatalog(db: Db): Promise<void> {
  await db`
    INSERT INTO plans (id, payer_id, name_he, plan_kind) VALUES ('harel_ambulatory', 'harel', 'הראל – שירותים אמבולטוריים', 'private_individual')
    ON CONFLICT (id) DO UPDATE SET active = true`;
  await publishCatalogVersion(
    db,
    Object.entries(FIXTURE).flatMap(([planId, benefits]) =>
      Object.entries(benefits).map(([category, rule]) => ({ planId, category: category as never, rule, sourceNote: "test fixture" })),
    ),
    "test fixture",
  );
}
