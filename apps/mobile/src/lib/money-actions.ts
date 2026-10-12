import { router } from "expo-router";
import type { MoneyAction, MoneyItemDto } from "@magiali/shared";

/** One clear verb per kind of money item – what the button does. */
export const ACTION_VERB: Record<MoneyItemDto["kind"], string> = {
  unclaimed_receipt: "להגיש תביעה",
  receipt_needs_details: "להשלים פרטים",
  payment_without_receipt: "לצלם קבלה",
  rejected: "לבדוק מה חסר",
  missing_documents: "להעלות מסמך",
  ready_to_submit: "להגיש",
  in_flight: "לפרטים",
  unused_quota: "לתכנן ביקור",
  uncovered_spend: "מה מגיע לנו",
  low_refund: "לבדוק",
  missing_terms: "להזין תנאים",
};

export function goToMoneyAction(a: MoneyAction) {
  switch (a.type) {
    case "claim":
      return router.push(`/claim/${a.id}`);
    case "receipt":
      return router.push(`/receipt/${a.id}`);
    case "policy":
      return router.push(`/policy/${a.memberId}/${a.planId}`);
    case "capture":
    case "lead":
      return router.push("/capture");
    case "benefits":
      return router.push("/entitlements");
    case "plan_visit":
      return router.push({ pathname: "/before-booking", params: { memberId: a.memberId, category: a.category } });
  }
}
