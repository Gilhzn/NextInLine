import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { RetryableExtractionError } from "./extraction";

/** One transaction from a credit card statement, as printed. */
export interface RawTransaction {
  merchant: string;
  date: string | null;
  amountIls: number | null;
  /** The card company's own category column, when the statement has one (e.g. "רפואה ובריאות"). */
  issuerCategory: string | null;
}

export type StatementInput =
  | { kind: "file"; data: Buffer; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "text"; text: string };

/** Reads transactions out of a statement the user downloaded or photographed. */
export interface StatementReader {
  readonly name: string;
  read(input: StatementInput): Promise<RawTransaction[]>;
}

export class ManualStatementReader implements StatementReader {
  readonly name = "manual";
  async read(): Promise<RawTransaction[]> {
    return [];
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_statement", "transactions"],
  properties: {
    is_statement: { type: "boolean" },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["merchant", "date", "amount_ils", "issuer_category"],
        properties: {
          merchant: { type: "string" },
          date: { anyOf: [{ type: "string", description: "YYYY-MM-DD" }, { type: "null" }] },
          amount_ils: { anyOf: [{ type: "number" }, { type: "null" }] },
          issuer_category: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
} as const;

const outputSchema = z.object({
  is_statement: z.boolean(),
  transactions: z.array(
    z.object({
      merchant: z.string(),
      date: z.string().nullable(),
      amount_ils: z.number().nullable(),
      issuer_category: z.string().nullable(),
    }),
  ),
});

const SYSTEM_PROMPT = `You read Israeli credit card statements (פירוט חיובים from Isracard, Cal, Max, Diners, American Express or a bank), as a PDF, screenshot or table, that a person downloaded about their own card.

List every purchase row exactly as printed:
- merchant: the business name (שם בית העסק).
- date: the purchase date (תאריך עסקה / תאריך רכישה), normalised to YYYY-MM-DD; Israeli dates are written day first.
- amount_ils: the full transaction amount in shekels (סכום עסקה). For installment purchases (תשלומים) use the full original amount, not the monthly charge. Refunds/credits are negative.
- issuer_category: the card company's category column if the statement has one (e.g. "רפואה ובריאות"), else null.
Do not skip, merge or invent rows. If this is not a card or bank statement, set is_statement to false and return no transactions.`;

export class ClaudeStatementReader implements StatementReader {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async read(input: StatementInput): Promise<RawTransaction[]> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.kind === "text") {
      content.push({ type: "text", text: `The statement as a table:\n\n${input.text}` });
    } else {
      const data = input.data.toString("base64");
      content.push(
        input.mimeType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
          : { type: "image", source: { type: "base64", media_type: input.mimeType, data } },
      );
    }
    content.push({ type: "text", text: "List the transactions." });

    let response: Anthropic.Beta.BetaMessage;
    try {
      // Statements can run to hundreds of rows: stream so a long answer doesn't hit the HTTP timeout.
      response = await this.client.beta.messages
        .stream({
          model: "claude-opus-5-5",
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: SYSTEM_PROMPT,
          output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
          messages: [{ role: "user", content }],
        })
        .finalMessage();
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
    if (!parsed.success || !parsed.data.is_statement) return [];
    return parsed.data.transactions.slice(0, 1000).map((t) => ({
      merchant: t.merchant.slice(0, 120),
      date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
      amountIls: t.amount_ils,
      issuerCategory: t.issuer_category,
    }));
  }
}
