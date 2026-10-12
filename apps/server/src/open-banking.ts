import { randomUUID } from "node:crypto";

/**
 * Open banking (Israel's Financial Information Service Law): a licensed provider holds the customer's read-only
 * consent and serves bank and credit card transactions. We never see bank credentials. Any provider – a licensed
 * aggregator, or the Bank of Israel standard API directly once we hold a licence – plugs in behind this interface.
 */
export interface OpenBankingProvider {
  readonly name: string;
  /** Creates a consent request; the customer approves it on the provider's own page. */
  startConsent(input: { reference: string; redirectUrl: string }): Promise<{ providerRef: string; url: string }>;
  getConsent(providerRef: string): Promise<{
    status: "pending" | "active" | "failed" | "expired" | "revoked";
    institutions: string[];
    expiresAt: Date | null;
  }>;
  /** Card and account transactions in the window, newest first. Amounts in shekels; refunds are negative. */
  fetchTransactions(
    providerRef: string,
    window: { from: string; to: string },
  ): Promise<Array<{ id: string; merchant: string; date: string; amountIls: number; issuerCategory: string | null }>>;
  revoke(providerRef: string): Promise<void>;
}

export class OpenBankingExpiredError extends Error {}

export const MOCK_INSTITUTIONS = ["ישראכרט", "מקס", "כאל", "בנק לאומי", "בנק הפועלים", "בנק דיסקונט", "מזרחי טפחות"];

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Development stand-in: a demo consent page served by this server, and a fixed set of transactions relative to
 * "now" – a few medical payments among everyday ones. Never used in production.
 */
export class MockOpenBanking implements OpenBankingProvider {
  readonly name = "mock";
  private consents = new Map<string, { status: "pending" | "active" | "failed" | "revoked"; institutions: string[]; redirectUrl: string; expiresAt: Date | null }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async startConsent(input: { reference: string; redirectUrl: string }) {
    const providerRef = `mockob_${randomUUID()}`;
    this.consents.set(providerRef, { status: "pending", institutions: [], redirectUrl: input.redirectUrl, expiresAt: null });
    return { providerRef, url: `/open-banking/mock/${providerRef}` };
  }

  /** The demo page's "approve" / "decline": returns where to send the browser next. */
  complete(providerRef: string, institutions: string[] | null): string | null {
    const c = this.consents.get(providerRef);
    if (!c || c.status !== "pending") return null;
    if (institutions && institutions.length) {
      c.status = "active";
      c.institutions = institutions.filter((i) => MOCK_INSTITUTIONS.includes(i));
      c.expiresAt = new Date(this.now().getTime() + 365 * DAY);
    } else {
      c.status = "failed";
    }
    return c.redirectUrl;
  }

  async getConsent(providerRef: string) {
    const c = this.consents.get(providerRef);
    if (!c) return { status: "failed" as const, institutions: [], expiresAt: null };
    return { status: c.status, institutions: c.institutions, expiresAt: c.expiresAt };
  }

  async fetchTransactions(providerRef: string, window: { from: string; to: string }) {
    const c = this.consents.get(providerRef);
    if (!c || c.status !== "active") throw new OpenBankingExpiredError("consent is not active");
    const at = (days: number) => isoDay(new Date(this.now().getTime() - days * DAY));
    const all = [
      { id: "t1", merchant: "מכון פיזיותרפיה גוף ונפש", date: at(12), amountIls: 280, issuerCategory: "רפואה ובריאות" },
      { id: "t2", merchant: "רמי לוי שיווק השקמה", date: at(13), amountIls: 412.3, issuerCategory: "מזון" },
      { id: "t3", merchant: 'ד"ר אורית לוי פסיכולוגית', date: at(33), amountIls: 450, issuerCategory: null },
      { id: "t4", merchant: "סופר-פארם", date: at(35), amountIls: 64.9, issuerCategory: "רפואה ובריאות" },
      { id: "t5", merchant: "פז חברת נפט", date: at(40), amountIls: 250, issuerCategory: "דלק" },
      { id: "t6", merchant: "אופטיקה הלפרין", date: at(95), amountIls: 1200, issuerCategory: "רפואה ובריאות" },
      { id: "t7", merchant: "מכון פיזיותרפיה גוף ונפש", date: at(300), amountIls: -280, issuerCategory: "רפואה ובריאות" },
    ];
    return all.filter((t) => t.date >= window.from && t.date <= window.to);
  }

  async revoke(providerRef: string) {
    const c = this.consents.get(providerRef);
    if (c) c.status = "revoked";
  }
}
