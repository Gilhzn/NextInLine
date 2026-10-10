import { describe, expect, it } from "vitest";
import { CardcomPayments } from "../src/providers.production";

type Call = { path: string; body: any };

/** A tiny Cardcom stand-in answering with the v11 response shapes. */
function fakeCardcom(handlers: Record<string, (body: any) => unknown>) {
  const calls: Call[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://secure.cardcom.solutions/api/v11", "");
    const body = JSON.parse(String(init?.body));
    calls.push({ path, body });
    const handler = handlers[path];
    if (!handler) return new Response("not found", { status: 404 });
    return Response.json(handler(body));
  }) as typeof fetch;
  return { http, calls };
}

const cfg = { terminalNumber: 1000, apiName: "CardTest1994", apiPassword: "pw", documentType: "Receipt" as const };

describe("Cardcom payments", () => {
  it("opens a token-only page (J2 check, nothing charged)", async () => {
    const cc = fakeCardcom({
      "/LowProfile/Create": () => ({ ResponseCode: 0, LowProfileId: "lp-1", Url: "https://secure.cardcom.solutions/External/lowProfileClearing/1000.aspx?LowProfileCode=lp-1" }),
    });
    const res = await new CardcomPayments(cfg, cc.http).startCardSetup({
      reference: "setup-1",
      successUrl: "https://app/ok",
      failureUrl: "https://app/fail",
      webhookUrl: "https://app/hook",
      customer: { name: "מיכל כהן", phone: "+972501234567" },
    });
    expect(res).toEqual({ url: expect.stringContaining("lp-1"), providerRef: "lp-1" });
    expect(cc.calls[0]!.body).toMatchObject({
      TerminalNumber: 1000,
      ApiName: "CardTest1994",
      Operation: "CreateTokenOnly",
      ReturnValue: "setup-1",
      SuccessRedirectUrl: "https://app/ok",
      FailedRedirectUrl: "https://app/fail",
      WebHookUrl: "https://app/hook",
      AdvancedDefinition: { JValidateType: 2 },
      UIDefinition: { CardOwnerNameValue: "מיכל כהן", CardOwnerPhoneValue: "0501234567" },
    });
  });

  it("reads the token and expiry once the user finished the page", async () => {
    let done = false;
    const cc = fakeCardcom({
      "/LowProfile/GetLpResult": () =>
        done
          ? {
              ResponseCode: 0,
              TokenInfo: { Token: "84cc1f4f-aaaa", CardYear: 2030, CardMonth: 7 },
              TranzactionInfo: { ResponseCode: 700, Last4CardDigitsString: "0008", Brand: "Visa" },
            }
          : { ResponseCode: 0, TokenInfo: null },
    });
    const cardcom = new CardcomPayments(cfg, cc.http);
    expect(await cardcom.getCardSetupResult("lp-1")).toEqual({ status: "pending" });
    done = true;
    const result = await cardcom.getCardSetupResult("lp-1");
    expect(result).toMatchObject({ status: "completed", last4: "0008", brand: "visa", expMonth: 7, expYear: 2030 });
    expect(JSON.parse((result as { token: string }).token)).toEqual({ token: "84cc1f4f-aaaa", mmyy: "0730" });
  });

  it("charges the token with an idempotency key and gets the tax receipt back", async () => {
    const cc = fakeCardcom({
      "/Transactions/Transaction": () => ({ ResponseCode: 0, TranzactionId: 123456, DocumentNumber: 5001, DocumentUrl: "https://secure.cardcom.solutions/doc/5001" }),
    });
    const res = await new CardcomPayments(cfg, cc.http).charge({
      token: JSON.stringify({ token: "84cc1f4f-aaaa", mmyy: "0730" }),
      amountAgorot: 4350,
      idempotencyKey: "fee-1-0",
      description: "מגיע לי – עמלת הצלחה",
      customer: { name: "מיכל כהן", phone: "+972501234567" },
    });
    expect(res).toEqual({ ok: true, chargeId: "123456", documentNumber: "5001", documentUrl: "https://secure.cardcom.solutions/doc/5001" });
    expect(cc.calls[0]!.body).toMatchObject({
      Amount: 43.5,
      Token: "84cc1f4f-aaaa",
      CardExpirationMMYY: "0730",
      ExternalUniqTranId: "fee-1-0",
      Document: {
        DocumentTypeToCreate: "Receipt",
        Name: "מיכל כהן",
        Mobile: "0501234567",
        Products: [{ Description: "מגיע לי – עמלת הצלחה", Quantity: 1, UnitCost: 43.5 }],
      },
    });
  });

  it("after a timeout, a repeated key returns the earlier successful charge instead of charging twice", async () => {
    const cc = fakeCardcom({
      "/Transactions/Transaction": () => ({ ResponseCode: 608, Description: "duplicate ExternalUniqTranId" }),
      "/Transactions/GetTransactionByExternalUniqTran": () => ({ ResponseCode: 0, TranzactionId: 999, DocumentNumber: 7 }),
    });
    const res = await new CardcomPayments(cfg, cc.http).charge({
      token: JSON.stringify({ token: "t", mmyy: "0130" }),
      amountAgorot: 1000,
      idempotencyKey: "fee-2-0",
      description: "x",
    });
    expect(res).toMatchObject({ ok: true, chargeId: "999", documentNumber: "7" });
    expect(cc.calls.map((c) => c.path)).toEqual(["/Transactions/Transaction", "/Transactions/GetTransactionByExternalUniqTran"]);
  });

  it("reports a decline with Cardcom's reason", async () => {
    const cc = fakeCardcom({ "/Transactions/Transaction": () => ({ ResponseCode: 33, Description: "כרטיס חסום" }) });
    const res = await new CardcomPayments(cfg, cc.http).charge({
      token: JSON.stringify({ token: "t", mmyy: "0130" }),
      amountAgorot: 1000,
      idempotencyKey: "fee-3-0",
      description: "x",
    });
    expect(res).toEqual({ ok: false, reason: "cardcom_33: כרטיס חסום", retryable: false });
  });

  it("refunds by transaction id with the API password", async () => {
    const cc = fakeCardcom({ "/Transactions/RefundByTransactionId": () => ({ ResponseCode: 0, NewTranzactionId: 555 }) });
    const res = await new CardcomPayments(cfg, cc.http).refund({ chargeId: "123456", amountAgorot: 4350 });
    expect(res).toEqual({ ok: true, refundId: "555" });
    expect(cc.calls[0]!.body).toEqual({ ApiName: "CardTest1994", ApiPassword: "pw", TransactionId: 123456, PartialSum: 43.5 });
  });
});
