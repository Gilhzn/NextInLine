import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

// ---------- SMS ----------

export interface SmsProvider {
  send(phoneE164: string, text: string): Promise<void>;
}

export function maskPhone(phone: string): string {
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : "****";
}

/** Development: prints messages (phone masked). Swap for an Israeli SMS gateway in production. */
export class ConsoleSms implements SmsProvider {
  async send(phoneE164: string, text: string): Promise<void> {
    console.info(`[sms → ${maskPhone(phoneE164)}] ${text}`);
  }
}

export class MemorySms implements SmsProvider {
  readonly sent: Array<{ to: string; text: string }> = [];
  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }
  lastCodeFor(to: string): string | undefined {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    return msg?.text.match(/\b(\d{6})\b/)?.[1];
  }
}

// ---------- Object storage ----------

export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Stores already-encrypted blobs on local disk. Production: S3-compatible bucket with the same interface. */
export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export class MemoryStorage implements StorageProvider {
  readonly blobs = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> {
    this.blobs.set(key, data);
  }
  async get(key: string): Promise<Buffer> {
    const b = this.blobs.get(key);
    if (!b) throw new Error(`missing blob ${key}`);
    return b;
  }
  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

// ---------- Push ----------

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushProvider {
  send(messages: PushMessage[]): Promise<void>;
}

export class ExpoPushProvider implements PushProvider {
  private readonly expo = new Expo();

  async send(messages: PushMessage[]): Promise<void> {
    const valid: ExpoPushMessage[] = messages
      .filter((m) => Expo.isExpoPushToken(m.to))
      .map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: "default" }));
    for (const chunk of this.expo.chunkPushNotifications(valid)) {
      await this.expo.sendPushNotificationsAsync(chunk);
    }
  }
}

export class MemoryPush implements PushProvider {
  readonly sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<void> {
    this.sent.push(...messages);
  }
}

// ---------- Payments ----------

export type ChargeResult =
  | { ok: true; chargeId: string; documentNumber?: string; documentUrl?: string }
  | { ok: false; reason: string; retryable: boolean };

export type RefundResult = { ok: true; refundId: string } | { ok: false; reason: string };

export interface PaymentCustomer {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** The card is entered on the provider's hosted page; we only ever see the resulting token. */
export type CardSetupResult =
  | { status: "pending" }
  | { status: "failed"; reason: string }
  | { status: "completed"; token: string; brand?: string; last4?: string; expMonth?: number; expYear?: number };

export interface PaymentProvider {
  readonly name: string;
  /** Opens a hosted "save card" page (no charge). `reference` is our setup id, echoed back by the provider. */
  startCardSetup(input: {
    reference: string;
    successUrl: string;
    failureUrl: string;
    webhookUrl: string;
    customer: PaymentCustomer;
  }): Promise<{ url: string; providerRef: string }>;
  getCardSetupResult(providerRef: string): Promise<CardSetupResult>;
  /** Merchant-initiated charge of a saved token. `idempotencyKey` must make retries safe. */
  charge(input: {
    token: string;
    amountAgorot: number;
    idempotencyKey: string;
    description: string;
    customer?: PaymentCustomer;
  }): Promise<ChargeResult>;
  refund(input: { chargeId: string; amountAgorot: number }): Promise<RefundResult>;
}

/**
 * Development stand-in for the payment provider. It serves its own "hosted page" (/payments/mock/:ref) so the app
 * goes through exactly the same redirect flow as with the real provider. Card numbers starting with 4000 0000 0000 0002
 * are declined at setup; tokens starting with "fail_" are declined when charged.
 */
export class MockPayments implements PaymentProvider {
  readonly name = "mock";
  readonly charges: Array<{ token: string; amountAgorot: number; idempotencyKey: string; description: string }> = [];
  readonly refunds: Array<{ chargeId: string; amountAgorot: number }> = [];
  private readonly setups = new Map<string, CardSetupResult & { successUrl: string; failureUrl: string }>();

  constructor(private readonly baseUrl = "") {}

  async startCardSetup(input: { reference: string; successUrl: string; failureUrl: string }) {
    const providerRef = `mock_${input.reference}`;
    this.setups.set(providerRef, { status: "pending", successUrl: input.successUrl, failureUrl: input.failureUrl });
    return { url: `${this.baseUrl}/payments/mock/${providerRef}`, providerRef };
  }

  /** Called by the mock hosted page. Returns where to send the browser next. */
  completeMockSetup(providerRef: string, cardNumber: string): string | null {
    const setup = this.setups.get(providerRef);
    if (!setup || setup.status !== "pending") return null;
    const digits = cardNumber.replace(/\D/g, "");
    if (digits.length < 12 || digits.startsWith("4000000000000002")) {
      this.setups.set(providerRef, { ...setup, status: "failed", reason: "card_declined" } as never);
      return setup.failureUrl;
    }
    const token = digits.startsWith("0000") ? `fail_${providerRef}` : `tok_${providerRef}`;
    this.setups.set(providerRef, { ...setup, status: "completed", token, brand: "visa", last4: digits.slice(-4), expMonth: 12, expYear: 2030 } as never);
    return setup.successUrl;
  }

  /** Test helper: completes a setup without the page. */
  completeForTest(providerRef: string, token: string, last4 = "4242"): void {
    const setup = this.setups.get(providerRef);
    if (setup) this.setups.set(providerRef, { ...setup, status: "completed", token, brand: "visa", last4, expMonth: 12, expYear: 2030 } as never);
  }

  async getCardSetupResult(providerRef: string): Promise<CardSetupResult> {
    const setup = this.setups.get(providerRef);
    if (!setup) return { status: "failed", reason: "unknown_setup" };
    const { successUrl: _s, failureUrl: _f, ...result } = setup;
    return result as CardSetupResult;
  }

  async charge(input: { token: string; amountAgorot: number; idempotencyKey: string; description: string }): Promise<ChargeResult> {
    const previous = this.charges.find((c) => c.idempotencyKey === input.idempotencyKey);
    if (previous) return { ok: true, chargeId: `mock_${input.idempotencyKey}` };
    if (input.token.startsWith("fail_")) return { ok: false, reason: "card_declined", retryable: true };
    this.charges.push({ token: input.token, amountAgorot: input.amountAgorot, idempotencyKey: input.idempotencyKey, description: input.description });
    return { ok: true, chargeId: `mock_${input.idempotencyKey}`, documentNumber: `DEMO-${this.charges.length}` };
  }

  async refund(input: { chargeId: string; amountAgorot: number }): Promise<RefundResult> {
    this.refunds.push(input);
    return { ok: true, refundId: `refund_${input.chargeId}` };
  }
}

// ---------- Email ----------

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmail implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.info(`[email → ${message.to}] ${message.subject} (${message.attachments.length} attachments)`);
  }
}

export class MemoryEmail implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
