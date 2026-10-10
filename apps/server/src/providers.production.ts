import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EmailMessage, EmailProvider, SmsProvider, StorageProvider } from "./providers";

type Fetch = typeof fetch;

/**
 * Twilio Programmable SMS (REST, no SDK). The free trial includes credit and can send to verified numbers.
 * `from` is a Twilio number or an alphanumeric sender ID where the destination country allows it.
 */
export class TwilioSms implements SmsProvider {
  constructor(
    private readonly cfg: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string },
    private readonly http: Fetch = fetch,
  ) {
    if (!cfg.from && !cfg.messagingServiceSid) throw new Error("Twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID");
  }

  async send(phoneE164: string, text: string): Promise<void> {
    const body = new URLSearchParams({ To: phoneE164, Body: text });
    if (this.cfg.messagingServiceSid) body.set("MessagingServiceSid", this.cfg.messagingServiceSid);
    else body.set("From", this.cfg.from!);
    const res = await this.http(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio SMS failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
}

/** Resend transactional email (free tier: 3,000/month, 100/day). Attachments are sent base64-encoded. */
export class ResendEmail implements EmailProvider {
  constructor(
    private readonly cfg: { apiKey: string; from: string },
    private readonly http: Fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.http("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.cfg.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend email failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
}

/**
 * Any S3-compatible bucket: Cloudflare R2 (free 10 GB), Backblaze B2, AWS S3, MinIO.
 * Blobs are already encrypted by the app before they get here.
 */
export class S3Storage implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly cfg: { bucket: string; endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string }) {
    this.client = new S3Client({
      region: cfg.region ?? "auto",
      endpoint: cfg.endpoint,
      forcePathStyle: !!cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: "application/octet-stream" }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`missing blob ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
