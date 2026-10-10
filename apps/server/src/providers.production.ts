import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  CardSetupResult,
  ChargeResult,
  EmailMessage,
  EmailProvider,
  PaymentCustomer,
  PaymentProvider,
  RefundResult,
  SmsProvider,
  StorageProvider,
} from "./providers";

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

// ---------- Payments: Cardcom (API v11) ----------

export interface CardcomConfig {
  terminalNumber: number;
  apiName: string;
  /** Needed only for refunds. */
  apiPassword?: string;
  /** "Receipt" for an עוסק פטור, "TaxInvoiceAndReceipt" for an עוסק מורשה / company, "Auto" = terminal setting. */
  documentType: "Auto" | "Receipt" | "TaxInvoiceAndReceipt";
  baseUrl?: string;
}

interface CardcomTransactionInfo {
  ResponseCode: number;
  Description?: string;
  TranzactionId?: number;
  DocumentNumber?: number;
  DocumentUrl?: string;
  Last4CardDigitsString?: string;
  Last4CardDigits?: number;
  Brand?: string;
}

/** Cardcom error code for a repeated ExternalUniqTranId: the charge already happened (or was attempted). */
const CARDCOM_DUPLICATE = 608;

/**
 * Israeli acquirer with a hosted card page. Flow: LowProfile/Create (CreateTokenOnly, J2 check, nothing charged) →
 * the user types the card on Cardcom's page → GetLpResult gives the token → Transactions/Transaction charges it
 * later and issues the tax receipt in the same call. Field names follow Cardcom's v11 OpenAPI.
 */
export class CardcomPayments implements PaymentProvider {
  readonly name = "cardcom";
  private readonly base: string;

  constructor(
    private readonly cfg: CardcomConfig,
    private readonly http: typeof fetch = fetch,
  ) {
    this.base = (cfg.baseUrl ?? "https://secure.cardcom.solutions").replace(/\/$/, "") + "/api/v11";
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.http(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`cardcom ${path} http ${res.status}`);
    return (await res.json()) as T;
  }

  private auth() {
    return { TerminalNumber: this.cfg.terminalNumber, ApiName: this.cfg.apiName };
  }

  async startCardSetup(input: {
    reference: string;
    successUrl: string;
    failureUrl: string;
    webhookUrl: string;
    customer: PaymentCustomer;
  }): Promise<{ url: string; providerRef: string }> {
    const res = await this.post<{ ResponseCode: number; Description?: string; LowProfileId?: string; Url?: string }>(
      "/LowProfile/Create",
      {
        ...this.auth(),
        Operation: "CreateTokenOnly",
        Amount: 1,
        ReturnValue: input.reference,
        SuccessRedirectUrl: input.successUrl,
        FailedRedirectUrl: input.failureUrl,
        CancelRedirectUrl: input.failureUrl,
        WebHookUrl: input.webhookUrl,
        ProductName: "שמירת אמצעי תשלום – מגיע לי",
        Language: "he",
        ISOCoinId: 1,
        // J2 = card check only: nothing is held or charged when the card is saved.
        AdvancedDefinition: { JValidateType: 2 },
        UIDefinition: {
          CardOwnerNameValue: input.customer.name ?? undefined,
          CardOwnerPhoneValue: input.customer.phone ? toLocalPhone(input.customer.phone) : undefined,
          IsCardOwnerEmailRequired: false,
        },
      },
    );
    if (res.ResponseCode !== 0 || !res.Url || !res.LowProfileId) {
      throw new Error(`cardcom LowProfile/Create failed: ${res.ResponseCode} ${res.Description ?? ""}`);
    }
    return { url: res.Url, providerRef: res.LowProfileId };
  }

  async getCardSetupResult(providerRef: string): Promise<CardSetupResult> {
    const res = await this.post<{
      ResponseCode: number;
      Description?: string;
      TokenInfo?: { Token?: string; CardYear?: number; CardMonth?: number } | null;
      TranzactionInfo?: CardcomTransactionInfo | null;
      UIValues?: { CardYear?: number; CardMonth?: number } | null;
    }>("/LowProfile/GetLpResult", { ...this.auth(), LowProfileId: providerRef });

    const token = res.TokenInfo?.Token;
    if (res.ResponseCode === 0 && token) {
      const tx = res.TranzactionInfo ?? undefined;
      const last4 = tx?.Last4CardDigitsString ?? (tx?.Last4CardDigits != null ? String(tx.Last4CardDigits).padStart(4, "0") : undefined);
      const month = res.TokenInfo?.CardMonth ?? res.UIValues?.CardMonth;
      const year = res.TokenInfo?.CardYear ?? res.UIValues?.CardYear;
      if (!month || !year) return { status: "failed", reason: "missing_card_expiry" };
      // The charge call needs the expiry next to the token, so both travel together (encrypted at rest).
      return {
        status: "completed",
        token: JSON.stringify({ token, mmyy: `${String(month).padStart(2, "0")}${String(year % 100).padStart(2, "0")}` }),
        brand: tx?.Brand ? tx.Brand.toLowerCase() : undefined,
        last4,
        expMonth: month,
        expYear: year < 100 ? 2000 + year : year,
      };
    }
    // Until the user finishes the page there is no token. A card that failed also has none; the redirect to
    // FailedRedirectUrl (or the setup timing out) is what tells us it is over.
    return { status: "pending" };
  }

  async charge(input: {
    token: string;
    amountAgorot: number;
    idempotencyKey: string;
    description: string;
    customer?: PaymentCustomer;
  }): Promise<ChargeResult> {
    const saved = JSON.parse(input.token) as { token: string; mmyy: string };
    const amount = input.amountAgorot / 100;
    const res = await this.post<CardcomTransactionInfo>("/Transactions/Transaction", {
      ...this.auth(),
      Amount: amount,
      Token: saved.token,
      CardExpirationMMYY: saved.mmyy,
      ExternalUniqTranId: input.idempotencyKey,
      NumOfPayments: 1,
      ISOCoinId: 1,
      Document: {
        DocumentTypeToCreate: this.cfg.documentType,
        Name: (input.customer?.name || "לקוח מגיע לי").slice(0, 50),
        Mobile: input.customer?.phone ? toLocalPhone(input.customer.phone) : undefined,
        Email: input.customer?.email ?? undefined,
        IsSendByEmail: !!input.customer?.email,
        Products: [{ Description: input.description, Quantity: 1, UnitCost: amount }],
      },
    });
    if (res.ResponseCode === 0) return chargeOk(res);
    if (res.ResponseCode === CARDCOM_DUPLICATE) {
      // Same key seen before: a previous attempt reached Cardcom (e.g. our request timed out). Use its outcome.
      const prev = await this.post<CardcomTransactionInfo>("/Transactions/GetTransactionByExternalUniqTran", {
        ...this.auth(),
        ExternalUniqTranId: input.idempotencyKey,
      });
      if (prev.ResponseCode === 0 && prev.TranzactionId) return chargeOk(prev);
      return { ok: false, reason: `cardcom_${prev.ResponseCode}: ${prev.Description ?? "declined"}`, retryable: false };
    }
    return { ok: false, reason: `cardcom_${res.ResponseCode}: ${res.Description ?? "declined"}`, retryable: false };
  }

  async refund(input: { chargeId: string; amountAgorot: number }): Promise<RefundResult> {
    if (!this.cfg.apiPassword) return { ok: false, reason: "CARDCOM_API_PASSWORD is not set" };
    const res = await this.post<{ ResponseCode: number; Description?: string; NewTranzactionId?: number }>(
      "/Transactions/RefundByTransactionId",
      {
        ApiName: this.cfg.apiName,
        ApiPassword: this.cfg.apiPassword,
        TransactionId: Number(input.chargeId),
        PartialSum: input.amountAgorot / 100,
      },
    );
    if (res.ResponseCode !== 0) return { ok: false, reason: `cardcom_${res.ResponseCode}: ${res.Description ?? ""}` };
    return { ok: true, refundId: String(res.NewTranzactionId ?? "") };
  }
}

function chargeOk(info: CardcomTransactionInfo): ChargeResult {
  return {
    ok: true,
    chargeId: String(info.TranzactionId),
    documentNumber: info.DocumentNumber != null ? String(info.DocumentNumber) : undefined,
    documentUrl: info.DocumentUrl ?? undefined,
  };
}

/** +972501234567 → 0501234567 (Cardcom's forms expect the local format). */
function toLocalPhone(e164: string): string {
  return e164.startsWith("+972") ? `0${e164.slice(4)}` : e164;
}
