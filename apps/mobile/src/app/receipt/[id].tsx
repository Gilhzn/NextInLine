import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BENEFIT_CATEGORIES,
  CATEGORY_INFO,
  ilsToAgorot,
  type BenefitCategory,
  type ClaimDto,
  type ReceiptDto,
  type RoutingResult,
} from "@magiali/shared";
import { api, ApiError, errorMessage } from "../../api/client";
import { keys, useMembers, useReceipt } from "../../api/hooks";
import { colors, radius, space, type } from "../../theme";
import { Body, Button, Card, Chip, ErrorView, Field, Loading, Row, Screen, Spread } from "../../ui";

const SIX_MONTHS_MS = 182 * 86_400_000;

export default function ReceiptReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receipt = useReceipt(id);
  const members = useMembers();
  const qc = useQueryClient();

  const [memberId, setMemberId] = useState<string | null>(null);
  const [category, setCategory] = useState<BenefitCategory | null>(null);
  const [providerName, setProviderName] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [sessions, setSessions] = useState(1);
  const [prefilled, setPrefilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [noCoverage, setNoCoverage] = useState<RoutingResult | null>(null);

  const r = receipt.data;
  const reading = r?.extractionStatus === "pending" || r?.extractionStatus === "processing";

  // Prefill once the AI has read the receipt (never overwrite what the user typed).
  useEffect(() => {
    if (!r || reading || prefilled) return;
    setMemberId(r.memberId ?? members.data?.find((m) => m.isSelf)?.id ?? null);
    setCategory(r.category);
    setProviderName(r.providerName ?? "");
    setServiceDate(r.serviceDate ?? "");
    setAmount(r.amountAgorot ? String(r.amountAgorot / 100) : "");
    setSessions(r.sessions ?? 1);
    setPrefilled(true);
  }, [r, reading, prefilled, members.data]);

  const low = useMemo(() => {
    const c = r?.extracted?.confidence ?? {};
    const isLow = (k: keyof typeof c) => c[k] === "low" || c[k] === "medium";
    return { provider: isLow("providerName"), date: isLow("serviceDate"), amount: isLow("amountAgorot"), category: isLow("category") };
  }, [r]);

  const amountNum = Number(amount.replace(",", "."));
  const valid =
    !!memberId && !!category && providerName.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) && amountNum > 0;

  async function confirmAndRoute() {
    if (!valid) return;
    setSaving(true);
    setError(undefined);
    setNoCoverage(null);
    try {
      await api<ReceiptDto>("PATCH", `/v1/receipts/${id}`, {
        memberId,
        category,
        providerName: providerName.trim(),
        serviceDate,
        amountAgorot: ilsToAgorot(amountNum),
        sessions,
      });
      const isRetro = Date.now() - new Date(`${serviceDate}T00:00:00Z`).getTime() > SIX_MONTHS_MS;
      const claim = await api<ClaimDto>("POST", "/v1/claims", { receiptIds: [id], isRetro });
      await qc.invalidateQueries({ queryKey: keys.home });
      await qc.invalidateQueries({ queryKey: keys.claims });
      router.replace(`/claim/${claim.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_coverage") {
        setNoCoverage((e.details as { routing: RoutingResult }).routing);
      } else if (e instanceof ApiError && e.code === "conflict" && e.message.includes("תביעה")) {
        router.replace("/claims");
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  if (receipt.isLoading) return <Loading />;
  if (receipt.error || !r) return <Screen><ErrorView message={errorMessage(receipt.error)} onRetry={() => void receipt.refetch()} /></Screen>;

  return (
    <Screen footer={<Button title="הכל נכון, כמה מגיע לי? ←" onPress={confirmAndRoute} loading={saving} disabled={!valid || reading} />}>
      {r.imageUrl ? (
        <Image
          source={{ uri: r.imageUrl }}
          style={{ width: "100%", height: 180, borderRadius: radius, backgroundColor: colors.border, marginBottom: space.lg }}
          contentFit="contain"
          accessibilityLabel="תמונת הקבלה"
        />
      ) : null}

      {reading ? (
        <Card tone="primary">
          <Loading label="קוראים את הקבלה... זה לוקח כמה שניות" />
        </Card>
      ) : null}
      {r.extracted && !r.extracted.isMedicalReceipt ? (
        <Card tone="warning">
          <Body>לא בטוחים שזו קבלה רפואית. בדוק את הפרטים או צלם שוב.</Body>
        </Card>
      ) : null}

      <Text style={label}>על מי?</Text>
      <Row style={{ marginBottom: space.lg }}>
        {members.data?.map((m) => (
          <Chip key={m.id} label={m.fullName} selected={memberId === m.id} onPress={() => setMemberId(m.id)} />
        ))}
      </Row>

      <Text style={[label, low.category && { color: colors.warning }]}>סוג השירות{low.category ? " (בדוק)" : ""}</Text>
      <Row style={{ marginBottom: space.lg }}>
        {BENEFIT_CATEGORIES.map((c) => (
          <Chip key={c} label={`${CATEGORY_INFO[c].icon} ${CATEGORY_INFO[c].label}`} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </Row>

      <Field label="נותן השירות" value={providerName} onChangeText={setProviderName} highlight={prefilled && low.provider} />
      <Field
        label="תאריך"
        value={serviceDate}
        onChangeText={setServiceDate}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        highlight={prefilled && low.date}
      />
      <Field
        label="סכום ששולם (₪)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        highlight={prefilled && low.amount}
      />

      <Spread style={{ marginBottom: space.lg }}>
        <Text style={label}>מספר מפגשים בקבלה</Text>
        <Row>
          <Pressable accessibilityLabel="פחות" onPress={() => setSessions((s) => Math.max(1, s - 1))} style={stepper}>
            <Text style={stepperText}>−</Text>
          </Pressable>
          <Text style={{ fontSize: type.title, fontWeight: "700", minWidth: 32, textAlign: "center" }}>{sessions}</Text>
          <Pressable accessibilityLabel="יותר" onPress={() => setSessions((s) => Math.min(100, s + 1))} style={stepper}>
            <Text style={stepperText}>+</Text>
          </Pressable>
        </Row>
      </Spread>

      {noCoverage ? (
        <Card tone="warning">
          <Body style={{ fontWeight: "700" }}>לא מצאנו כיסוי שמחזיר כסף על הקבלה הזו</Body>
          {noCoverage.notes.map((n, i) => (
            <Body key={i} muted>
              • {n}
            </Body>
          ))}
          <Body muted>שמרנו את הקבלה. אם תוסיף ביטוח, נבדוק אותה שוב.</Body>
        </Card>
      ) : null}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      <View style={{ height: space.xl }} />
    </Screen>
  );
}

const label = { fontSize: type.small, color: colors.muted, fontWeight: "600" as const, marginBottom: space.sm };
const stepper = {
  width: 44,
  height: 44,
  borderRadius: 22,
  borderWidth: 1.5,
  borderColor: colors.primary,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
const stepperText = { fontSize: 22, color: colors.primary, fontWeight: "700" as const };
