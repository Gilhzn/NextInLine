import { describe, expect, it } from "vitest";
import { scrubEvent } from "../src/monitoring";

describe("error monitoring", () => {
  it("never sends request bodies, headers, query strings or personal user fields", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://api.example.com/v1/receipts/1?phone=0501234567",
        data: { providerName: "ד״ר כהן – פסיכיאטר" },
        headers: { authorization: "Bearer secret" },
        cookies: { a: "b" },
        query_string: "phone=0501234567",
      },
      user: { id: "u1", email: "x@example.com", ip_address: "1.2.3.4" },
      extra: { body: "sensitive" },
    });
    expect(event.request).toEqual({ url: "https://api.example.com/v1/receipts/1" });
    expect(event.user).toEqual({ id: "u1" });
    expect(event.extra).toBeUndefined();
  });
});
