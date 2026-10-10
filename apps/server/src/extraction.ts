import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { BENEFIT_CATEGORIES, ilsToAgorot, type ExtractedFields } from "@magiali/shared";

export const EXTRACTABLE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ExtractableMime = (typeof EXTRACTABLE_MIME_TYPES)[number];

export interface ReceiptExtractor {
  readonly name: string;
  extract(input: { data: Buffer; mimeType: ExtractableMime }): Promise<ExtractedFields>;
}

/** Thrown for failures worth retrying (rate limits, overloads, network). */
export class RetryableExtractionError extends Error {}

const EMPTY: ExtractedFields = {
  isMedicalReceipt: true,
  providerName: null,
  patientName: null,
  serviceDate: null,
  amountAgorot: null,
  sessions: null,
  category: null,
  description: null,
  confidence: {},
};

/** No AI available: the user fills the fields in the app. */
export class ManualExtractor implements ReceiptExtractor {
  readonly name = "manual";
  async extract(): Promise<ExtractedFields> {
    return { ...EMPTY };
  }
}

const confidenceLevel = { type: "string", enum: ["high", "medium", "low"] } as const;
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** JSON Schema for structured outputs: every property required, no extra properties. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_medical_receipt",
    "provider_name",
    "patient_name",
    "service_date",
    "amount_ils",
    "sessions",
    "category",
    "description",
    "confidence",
  ],
  properties: {
    is_medical_receipt: { type: "boolean" },
    provider_name: nullable({ type: "string" }),
    patient_name: nullable({ type: "string" }),
    service_date: nullable({ type: "string", description: "YYYY-MM-DD" }),
    amount_ils: nullable({ type: "number" }),
    sessions: nullable({ type: "integer" }),
    category: nullable({ type: "string", enum: [...BENEFIT_CATEGORIES] }),
    description: nullable({ type: "string" }),
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["provider_name", "service_date", "amount_ils", "sessions", "category"],
      properties: {
        provider_name: confidenceLevel,
        service_date: confidenceLevel,
        amount_ils: confidenceLevel,
        sessions: confidenceLevel,
        category: confidenceLevel,
      },
    },
  },
} as const;

const level = z.enum(["high", "medium", "low"]);
const modelOutputSchema = z.object({
  is_medical_receipt: z.boolean(),
  provider_name: z.string().nullable(),
  patient_name: z.string().nullable(),
  service_date: z.string().nullable(),
  amount_ils: z.number().nullable(),
  sessions: z.number().int().nullable(),
  category: z.enum(BENEFIT_CATEGORIES).nullable(),
  description: z.string().nullable(),
  confidence: z.object({
    provider_name: level,
    service_date: level,
    amount_ils: level,
    sessions: level,
    category: level,
  }),
});

const SYSTEM_PROMPT = `You read Israeli medical receipts and invoices (Hebrew, sometimes English or Arabic; printed or handwritten) and extract the fields needed to file a reimbursement claim with a health fund supplementary plan (שב"ן) or a private health insurer.

Rules:
- amount_ils: the total actually paid by the patient, in shekels, including VAT. If several amounts appear, use the final total paid ("סה"כ לתשלום" / "שולם"). Never invent a number.
- service_date: the date the service was given, normalised to YYYY-MM-DD. Israeli receipts write dates as DD/MM/YYYY or DD.MM.YY – day comes first.
- sessions: the number of treatments/visits the receipt covers (default 1 when it is a single visit).
- provider_name: the clinic, practitioner, or institute that issued the receipt.
- patient_name: the patient's name if printed; otherwise null.
- category: choose the closest of the allowed values. child_development covers occupational therapy (ריפוי בעיסוק), speech therapy (קלינאות תקשורת) and similar for children. psychology covers psychologists and emotional therapy. diagnostic_imaging covers MRI/CT/ultrasound/X-ray. Use other when nothing fits.
- description: at most a short phrase naming the service (e.g. "טיפול פיזיותרפיה"), never a diagnosis.
- If the image is not a medical receipt or invoice, set is_medical_receipt to false and the other fields to null.
- Use null for anything you cannot read with reasonable certainty, and rate each field's confidence honestly.`;

export class ClaudeExtractor implements ReceiptExtractor {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async extract(input: { data: Buffer; mimeType: ExtractableMime }): Promise<ExtractedFields> {
    const data = input.data.toString("base64");
    const media: Anthropic.Beta.BetaContentBlockParam =
      input.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: input.mimeType, data } };

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [media, { type: "text", text: "Extract the receipt fields." }],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
        throw new RetryableExtractionError(error.message);
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new RetryableExtractionError(error.message);
      }
      if (error instanceof Anthropic.APIError && error.status === 529) {
        throw new RetryableExtractionError(error.message);
      }
      throw error;
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      // Fall back to manual entry rather than guessing.
      return { ...EMPTY };
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { ...EMPTY };

    const parsed = modelOutputSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success) return { ...EMPTY };
    return toExtractedFields(parsed.data);
  }
}

export function toExtractedFields(o: z.infer<typeof modelOutputSchema>): ExtractedFields {
  const validDate = o.service_date && /^\d{4}-\d{2}-\d{2}$/.test(o.service_date) ? o.service_date : null;
  const amount = o.amount_ils !== null && o.amount_ils > 0 ? ilsToAgorot(o.amount_ils) : null;
  const sessions = o.sessions !== null && o.sessions > 0 && o.sessions <= 100 ? o.sessions : null;
  return {
    isMedicalReceipt: o.is_medical_receipt,
    providerName: o.provider_name?.slice(0, 120) ?? null,
    patientName: o.patient_name?.slice(0, 80) ?? null,
    serviceDate: validDate,
    amountAgorot: amount,
    sessions,
    category: o.category,
    description: o.description?.slice(0, 120) ?? null,
    confidence: {
      providerName: o.confidence.provider_name,
      serviceDate: validDate ? o.confidence.service_date : "low",
      amountAgorot: amount ? o.confidence.amount_ils : "low",
      sessions: o.confidence.sessions,
      category: o.confidence.category,
    },
  };
}
