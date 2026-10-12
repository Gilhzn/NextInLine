import type { Config } from "./config";
import type { Crypto } from "./crypto";
import type { Sql } from "./db";
import type { ReceiptExtractor } from "./extraction";
import type { OpenBankingProvider } from "./open-banking";
import type { PolicyReportReader } from "./policy-reader";
import type { StatementReader } from "./statement-reader";
import type { EmailProvider, PaymentProvider, PushProvider, SmsProvider, StorageProvider } from "./providers";

/** Everything a request handler or job needs. Swapped for in-memory fakes in tests. */
export interface Deps {
  config: Config;
  sql: Sql;
  crypto: Crypto;
  sms: SmsProvider;
  storage: StorageProvider;
  push: PushProvider;
  payments: PaymentProvider;
  email: EmailProvider;
  extractor: ReceiptExtractor;
  policyReader: PolicyReportReader;
  statementReader: StatementReader;
  /** null when no open banking provider is configured (the feature is hidden). */
  openBanking: OpenBankingProvider | null;
  now: () => Date;
}

export interface AuthContext {
  userId: string;
  householdId: string;
}
