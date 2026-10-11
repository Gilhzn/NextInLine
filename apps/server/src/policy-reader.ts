import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { RetryableExtractionError } from "./extraction";

/** A policy as it appears in a Har HaBituach report, before we interpret it. */
export interface RawPolicy {
  insurer: string | null;
  mainBranch: string | null;
  subBranch: string | null;
  product: string | null;
  productType: string | null;
  policyNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  insuredName: string | null;
  /** Monthly premium in agorot, when the report lists one. */
  monthlyPremiumAgorot?: number | null;
}

export type PolicyReportInput =
  | { kind: "file"; data: Buffer; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "text"; text: string };

/** Reads policies out of a report the user downloaded or photographed (PDF, screenshot, or an unrecognised table). */
export interface PolicyReportReader {
  readonly name: string;
  read(input: PolicyReportInput): Promise<RawPolicy[]>;
}

export class ManualPolicyReader implements PolicyReportReader {
  readonly name = "manual";
  async read(): Promise<RawPolicy[]> {
    return [];
  }
}

const str = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_policy_report", "policies"],
  properties: {
    is_policy_report: { type: "boolean" },
    policies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "insurer",
          "main_branch",
          "sub_branch",
          "product",
          "product_type",
          "policy_number",
          "start_date",
          "end_date",
          "insured_name",
          "monthly_premium_ils",
        ],
        properties: {
          insurer: str,
          main_branch: str,
          sub_branch: str,
          product: str,
          product_type: str,
          policy_number: str,
          start_date: { ...str, description: "YYYY-MM-DD" },
          end_date: { ...str, description: "YYYY-MM-DD" },
          insured_name: str,
          monthly_premium_ils: {
            anyOf: [{ type: "number" }, { type: "null" }],
            description: "Premium per month in ILS (divide an annual premium by 12); null if not shown",
          },
        },
      },
    },
  },
} as const;

const nullableString = z.string().nullable();
const outputSchema = z.object({
  is_policy_report: z.boolean(),
  policies: z.array(
    z.object({
      insurer: nullableString,
      main_branch: nullableString,
      sub_branch: nullableString,
      product: nullableString,
      product_type: nullableString,
      policy_number: nullableString,
      start_date: nullableString,
      end_date: nullableString,
      insured_name: nullableString,
      monthly_premium_ils: z.number().nonnegative().nullable(),
    }),
  ),
});

const SYSTEM_PROMPT = `You read the policy list from "הר הביטוח" (Har HaBituach, the Israeli Finance Ministry's insurance lookup) – a table, PDF or screenshot a person downloaded about their own insurance.

Return every policy row exactly as written; do not judge relevance and do not invent rows.
- insurer: the insurance company (חברה), e.g. "הראל חברה לביטוח".
- main_branch: the main line (ענף ראשי), e.g. "ביטוח בריאות", "ביטוח חיים".
- sub_branch: the secondary line (ענף משני), e.g. "אמבולטורי", "ניתוחים בארץ", "תרופות".
- product: the plan or product name if shown (סוג מוצר / שם תכנית / פרטים נוספים).
- product_type: "פרט" or "קבוצתי" (individual / group / collective) if shown.
- policy_number: as printed (מספר פוליסה).
- start_date / end_date: the insurance period, normalised to YYYY-MM-DD. Israeli dates are written day first. Use null for an open-ended period.
- insured_name: the insured person's name if shown.
- monthly_premium_ils: the premium (פרמיה) per month in shekels if shown; divide an annual premium by 12.
If this is not a Har HaBituach or similar insurance-policy list, set is_policy_report to false and return no policies. Use null for anything you cannot read with reasonable certainty.`;

const isoOrNull = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export class ClaudePolicyReader implements PolicyReportReader {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async read(input: PolicyReportInput): Promise<RawPolicy[]> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.kind === "text") {
      content.push({ type: "text", text: `The report as a table:\n\n${input.text}` });
    } else {
      const data = input.data.toString("base64");
      content.push(
        input.mimeType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
          : { type: "image", source: { type: "base64", media_type: input.mimeType, data } },
      );
    }
    content.push({ type: "text", text: "List the policies." });

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content }],
      });
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError ||
        (error instanceof Anthropic.APIError && error.status === 529)
      ) {
        throw new RetryableExtractionError(error.message);
      }
      throw error;
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return [];
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return [];
    const parsed = outputSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success || !parsed.data.is_policy_report) return [];
    return parsed.data.policies.slice(0, 60).map((p) => ({
      insurer: p.insurer,
      mainBranch: p.main_branch,
      subBranch: p.sub_branch,
      product: p.product,
      productType: p.product_type,
      policyNumber: p.policy_number,
      startDate: isoOrNull(p.start_date),
      endDate: isoOrNull(p.end_date),
      insuredName: p.insured_name,
      monthlyPremiumAgorot: p.monthly_premium_ils !== null ? Math.round(p.monthly_premium_ils * 100) : null,
    }));
  }
}
