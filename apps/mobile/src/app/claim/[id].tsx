import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CATEGORY_INFO,
  CLAIM_STATUS_LABEL,
  formatILS,
  ilsToAgorot,
  LEG_STATUS_LABEL,
  type ClaimDto,
  type DocKind,
  type LegDto,
} from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { keys, useClaim } from "../../api/hooks";
import { pickFromLibrary, pickPdf, captureWithCamera, uploadDocument, type PickResult } from "../../lib/media";
import { colors, space, type } from "../../theme";
import { Badge, Body, Button, Card, Divider, ErrorView, Field, Loading, Row, Screen, Spread } from "../../ui";

const DOC_LABEL: Record<DocKind, string> = {
  receipt: "קבלה",
  visit_summary: "סיכום טיפול / ביקור",
  referral: "הפניה מרופא",
  payer_payment_proof: "אישור תשלום מהגוף הקודם",
};

const TIMELINE: LegDto["status"][] = ["submitted", "in_review", "approved", "paid"];

function stepReached(leg: LegDto, step: LegDto["status"]): boolean {
  const order = ["blocked", "ready", "submitted", "received", "in_review", "approved", "partially_approved", "paid"];
  if (leg.status === "rejected" || leg.status === "skipped") return false;
  return order.indexOf(leg.status) >= order.indexOf(step === "approved" && leg.status === "partially_approved" ? "partially_approved" : step);
}

export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = useClaim(id);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  async function run(key: string, fn: () => Promise<ClaimDto | unknown>) {
    setBusy(key);
    setError(undefined);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "legs" in result) qc.setQueryData(keys.claim(id), result);
      else await claim.refetch();
      await qc.invalidateQueries({ queryKey: keys.home });
      await qc.invalidateQueries({ queryKey: keys.claims, exact: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function addDocument(kind: DocKind, pick: () => Promise<PickResult>) {
    const result = await pick();
    if (!result.ok || !result.files[0]) return;
    await run(`doc-${kind}`, async () => {
      const doc = await uploadDocument(result.files[0]!, kind);
      return api<ClaimDto>("POST", `/v1/claims/${id}/documents`, { kind, documentId: doc.id });
    });
  }

  if (claim.isLoading) return <Loading />;
  if (claim.error || !claim.data) return <Screen><ErrorView message={errorMessage(claim.error)} onRetry={() => void claim.refetch()} /></Screen>;
  const c = claim.data;
  const info = CATEGORY_INFO[c.category];
  const missing = c.requiredDocs.filter((d) => d.status === "missing");
  const closed = c.status === "completed" || c.status === "partially_paid" || c.status === "rejected" || c.status === "cancelled";

  const footer =
    c.status === "ready" ? (
      <Button title="הגש עכשיו" onPress={() => run("submit", () => api<ClaimDto>("POST", `/v1/claims/${id}/submit`))} loading={busy === "submit"} />
    ) : c.status === "awaiting_documents" ? (
      <Button title={`חסר: ${missing.map((d) => DOC_LABEL[d.kind]).join(", ")}`} disabled onPress={() => {}} />
    ) : undefined;

  return (
    <Screen footer={footer}>
      <Spread style={{ marginBottom: space.md }}>
        <Text style={{ fontSize: type.title, fontWeight: "800", color: colors.text, flex: 1 }}>
          {info.icon} {info.label}
        </Text>
        <Badge label={CLAIM_STATUS_LABEL[c.status]} tone={c.status === "completed" || c.status === "partially_paid" ? "money" : c.status === "rejected" ? "danger" : "primary"} />
      </Spread>
      <Body muted>
        {c.memberName} · {c.providerName ?? ""} · {c.serviceDate}
      </Body>

      {c.totalPaidAgorot > 0 && closed ? (
        <Card tone="money" style={{ alignItems: "center", marginTop: space.lg }}>
          <Text style={{ fontSize: 40 }}>💸</Text>
          <Text style={{ fontSize: type.money, fontWeight: "800", color: colors.money }}>{formatILS(c.totalPaidAgorot)}</Text>
          <Body>הגיעו אליך</Body>
        </Card>
      ) : null}

      {/* Money route */}
      <Card style={{ marginTop: space.lg }}>
        <Text style={{ fontSize: type.body, fontWeight: "800", color: colors.text }}>כך תקבל את הכסף 💸</Text>
        <Spread>
          <Body muted>שילמת</Body>
          <Body>{formatILS(c.amountAgorot)}</Body>
        </Spread>
        {c.legs.map((leg) => (
          <Spread key={leg.id}>
            <Body style={{ flex: 1 }}>
              {leg.seq}️⃣ {leg.planName}
              {leg.status === "skipped" ? " (דולג)" : ""}
            </Body>
            <Text style={{ fontSize: type.body, fontWeight: "700", color: leg.status === "paid" ? colors.money : leg.status === "rejected" ? colors.danger : colors.text }}>
              {formatILS(leg.paidAgorot ?? leg.expectedAgorot)}
            </Text>
          </Spread>
        ))}
        {c.routing?.legs.map((l) => (
          <Body key={`basis-${l.seq}`} muted style={{ fontSize: type.caption }}>
            {l.seq}. {l.basis}
          </Body>
        ))}
        <Divider />
        <Spread>
          <Body>סה״כ החזר {closed ? "" : "צפוי"}</Body>
          <Text style={{ fontWeight: "800", fontSize: type.body + 1 }}>{formatILS(closed ? c.totalPaidAgorot : c.totalExpectedAgorot)}</Text>
        </Spread>
        <Spread>
          <Body muted>העמלה שלנו ({(c.fee?.rateBps ?? c.feePreview.rateBps) / 100}%)</Body>
          <Body muted>-{formatILS(c.fee?.amountAgorot ?? c.feePreview.amountAgorot)}</Body>
        </Spread>
        {!c.fee ? (
          <Spread>
            <Body style={{ fontWeight: "700" }}>נשאר לך</Body>
            <Text style={{ fontWeight: "800", color: colors.money, fontSize: type.body + 1 }}>{formatILS(c.feePreview.netToUserAgorot)} ✓</Text>
          </Spread>
        ) : null}
        <Body muted style={{ fontSize: type.caption }}>העמלה נגבית רק אחרי שהכסף הגיע, ולא יותר מ-150 ₪ לתביעה.</Body>
      </Card>

      {/* Missing documents */}
      {missing.map((d) => (
        <Card key={d.kind} tone="warning">
          <Body style={{ fontWeight: "700" }}>📎 צריך גם: {DOC_LABEL[d.kind]}</Body>
          <Button title="צלם / העלה" variant="secondary" onPress={() => addDocument(d.kind, captureWithCamera)} loading={busy === `doc-${d.kind}`} />
          <Row>
            <Button title="מהגלריה" variant="ghost" onPress={() => addDocument(d.kind, () => pickFromLibrary(false))} />
            <Button title="PDF" variant="ghost" onPress={() => addDocument(d.kind, pickPdf)} />
            <Button
              title="💬 בקש בוואטסאפ"
              variant="ghost"
              onPress={() =>
                void Linking.openURL(
                  `whatsapp://send?text=${encodeURIComponent(`היי, אני צריך/ה ${DOC_LABEL[d.kind]} עבור ${c.memberName} לצורך החזר מהביטוח. תודה!`)}`,
                ).catch(() => {})
              }
            />
          </Row>
        </Card>
      ))}

      {/* Timeline per leg */}
      {c.status !== "ready" && c.status !== "awaiting_documents" && c.status !== "cancelled"
        ? c.legs.map((leg) => <LegCard key={leg.id} claimId={c.id} leg={leg} busy={busy} run={run} />)
        : null}

      {c.fee && c.fee.status === "scheduled" ? (
        <Card>
          <Body>
            העמלה ({formatILS(c.fee.amountAgorot)}) תחויב ב-{c.fee.scheduledFor?.slice(0, 10)}.
          </Body>
          <Button
            title="הכסף לא הגיע?"
            variant="ghost"
            onPress={() => run("dispute", () => api("POST", `/v1/fees/${c.fee!.id}/dispute`, { reason: "המשתמש דיווח שהכסף לא הגיע" }))}
            loading={busy === "dispute"}
          />
        </Card>
      ) : null}
      {c.fee?.status === "disputed" ? (
        <Card tone="warning">
          <Body>עצרנו את חיוב העמלה. נבדוק ונחזור אליך.</Body>
        </Card>
      ) : null}

      {c.status === "ready" || c.status === "awaiting_documents" ? (
        <Button title="ביטול התביעה" variant="ghost" onPress={() => run("cancel", () => api<ClaimDto>("POST", `/v1/claims/${id}/cancel`))} />
      ) : null}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}

function LegCard({
  claimId,
  leg,
  busy,
  run,
}: {
  claimId: string;
  leg: LegDto;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String((leg.approvedAgorot ?? leg.expectedAgorot) / 100));
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const awaitingOutcome = ["submitted", "received", "in_review", "approved", "partially_approved"].includes(leg.status);

  const update = (status: string, extra: Record<string, unknown> = {}) =>
    run(`leg-${leg.id}-${status}`, () => api<ClaimDto>("POST", `/v1/claims/${claimId}/legs/${leg.id}/status`, { status, ...extra }));

  return (
    <Card>
      <Spread>
        <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>
          {leg.seq}. {leg.payerName}
        </Text>
        <Badge label={LEG_STATUS_LABEL[leg.status]} tone={leg.status === "paid" ? "money" : leg.status === "rejected" ? "danger" : leg.status === "blocked" ? "muted" : "primary"} />
      </Spread>

      {leg.status !== "blocked" && leg.status !== "ready" && leg.status !== "skipped" && leg.status !== "rejected" ? (
        <View style={{ gap: 4 }}>
          {TIMELINE.map((step) => (
            <Body key={step} muted={!stepReached(leg, step)}>
              {stepReached(leg, step) ? "●" : "○"} {LEG_STATUS_LABEL[step]}
            </Body>
          ))}
          {leg.expectedDecisionBy ? <Body muted style={{ fontSize: type.caption }}>תשובה צפויה עד {leg.expectedDecisionBy.slice(0, 10)}</Body> : null}
        </View>
      ) : null}

      {leg.status === "blocked" ? <Body muted>יוגש אוטומטית אחרי שהשלב הקודם ישולם</Body> : null}

      {leg.status === "ready" && leg.submissionChannel === "user_handoff" ? (
        <Button title="פתח תיק מוכן להגשה" icon="📤" onPress={() => router.push(`/pack/${claimId}/${leg.id}`)} />
      ) : null}
      {leg.status === "ready" && leg.submissionChannel === "email_poa" ? <Body muted>אנחנו מגישים בשמך...</Body> : null}

      {awaitingOutcome ? (
        <View style={{ gap: space.sm }}>
          <Divider />
          <Body>קיבלת תשובה מ{leg.payerName}?</Body>
          <Field label="כמה הגיע (₪)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Button
            title="הכסף הגיע ✓"
            onPress={() => update("paid", { amountAgorot: ilsToAgorot(Number(amount.replace(",", ".")) || 0) })}
            loading={busy === `leg-${leg.id}-paid`}
          />
          {rejecting ? (
            <>
              <Field label="מה הסיבה שכתבו?" value={reason} onChangeText={setReason} />
              <Button title="אישור: התביעה נדחתה" variant="danger" onPress={() => update("rejected", { reason })} loading={busy === `leg-${leg.id}-rejected`} />
            </>
          ) : (
            <Button title="נדחתה ✕" variant="ghost" onPress={() => setRejecting(true)} />
          )}
        </View>
      ) : null}

      {leg.status === "rejected" ? (
        <View style={{ gap: space.sm }}>
          <Body>למה? {leg.rejectionReason ?? "לא צוינה סיבה"}</Body>
          <Body muted>אפשר להשלים מסמך ולהגיש שוב, או לבדוק את הדחייה עם עורך דין שותף. אנחנו לא מנסחים ערעורים.</Body>
        </View>
      ) : null}
    </Card>
  );
}
