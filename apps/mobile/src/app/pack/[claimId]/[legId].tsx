import { useState } from "react";
import { Pressable, Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import type { ClaimDto } from "@magiali/shared";
import { api, errorMessage } from "../../../api/client";
import { keys, usePack } from "../../../api/hooks";
import { colors, space, type } from "../../../theme";
import { Body, Button, Card, ErrorView, Loading, Screen, Spread } from "../../../ui";

const DOC_LABEL: Record<string, string> = {
  receipt: "🧾 קבלה",
  visit_summary: "📄 סיכום טיפול",
  referral: "📄 הפניה",
  payer_payment_proof: "📄 אישור תשלום",
};

export default function Pack() {
  const { claimId, legId } = useLocalSearchParams<{ claimId: string; legId: string }>();
  const pack = usePack(claimId, legId);
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function copy(label: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function markSubmitted() {
    setSaving(true);
    setError(undefined);
    try {
      const claim = await api<ClaimDto>("POST", `/v1/claims/${claimId}/legs/${legId}/status`, { status: "submitted" });
      qc.setQueryData(keys.claim(claimId), claim);
      await qc.invalidateQueries({ queryKey: keys.home });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (pack.isLoading) return <Loading />;
  if (pack.error || !pack.data) return <Screen><ErrorView message={errorMessage(pack.error)} onRetry={() => void pack.refetch()} /></Screen>;
  const p = pack.data;

  return (
    <Screen footer={<Button title="הגשתי ✓ תעקבו בשבילי" onPress={markSubmitted} loading={saving} />}>
      <Text style={{ fontSize: type.title, fontWeight: "800", color: colors.text, marginBottom: space.md }}>הגשה ל{p.payerName}</Text>

      <Card tone="primary">
        {p.instructions.map((line, i) => (
          <Body key={i}>
            {i + 1}. {line}
          </Body>
        ))}
        {p.deepLink || p.webUrl ? (
          <Button
            title={`פתח את ${p.payerName}`}
            icon="↗"
            variant="secondary"
            onPress={() => void WebBrowser.openBrowserAsync((p.deepLink ?? p.webUrl)!)}
          />
        ) : null}
      </Card>

      <Text style={sectionTitle}>הפרטים (לחיצה מעתיקה)</Text>
      {p.fields.map((f) => (
        <Pressable key={f.label} onPress={() => copy(f.label, f.value)} accessibilityRole="button" accessibilityHint="מעתיק את הערך">
          <Card>
            <Spread>
              <Body muted>{f.label}</Body>
              <Body style={{ fontWeight: "700" }}>{copied === f.label ? "הועתק ✓" : f.value}</Body>
            </Spread>
          </Card>
        </Pressable>
      ))}

      <Text style={sectionTitle}>מסמכים לצרף</Text>
      {p.documents.map((d) => (
        <Card key={d.url} onPress={() => void WebBrowser.openBrowserAsync(d.url)}>
          <Spread>
            <Body>{DOC_LABEL[d.kind] ?? d.kind}</Body>
            <Body muted>פתח ›</Body>
          </Spread>
        </Card>
      ))}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}

const sectionTitle = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginTop: space.lg, marginBottom: space.sm };
