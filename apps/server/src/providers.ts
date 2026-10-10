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

export type ChargeResult = { ok: true; chargeId: string } | { ok: false; reason: string; retryable: boolean };

export interface PaymentProvider {
  readonly name: string;
  charge(input: { token: string; amountAgorot: number; idempotencyKey: string; description: string }): Promise<ChargeResult>;
}

/**
 * Stand-in for an Israeli PSP with tokenization (card / Bit / Apple Pay / Google Pay).
 * Tokens starting with "fail_" are declined, which lets tests exercise the retry path.
 */
export class MockPayments implements PaymentProvider {
  readonly name = "mock";
  readonly charges: Array<{ token: string; amountAgorot: number; idempotencyKey: string }> = [];

  async charge(input: { token: string; amountAgorot: number; idempotencyKey: string }): Promise<ChargeResult> {
    const previous = this.charges.find((c) => c.idempotencyKey === input.idempotencyKey);
    if (previous) return { ok: true, chargeId: `mock_${input.idempotencyKey}` };
    if (input.token.startsWith("fail_")) return { ok: false, reason: "card_declined", retryable: true };
    this.charges.push(input);
    return { ok: true, chargeId: `mock_${input.idempotencyKey}` };
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
