import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../api/client";
import { keys, useEnrollments, useMembers, usePlans } from "../../api/hooks";
import { colors, space } from "../../theme";
import { Body, Button, Card, Field, Loading, Screen, Title } from "../../ui";
import { CoveragePicker, emptySelection, enrollmentsToSelection, selectionToEnrollments, type CoverageSelection } from "../../ui/CoveragePicker";

export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const members = useMembers();
  const plans = usePlans();
  const enrollments = useEnrollments(id);
  const qc = useQueryClient();
  const [selection, setSelection] = useState<CoverageSelection>(emptySelection);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();

  // Re-sync whenever the saved enrollments change (e.g. after an import), so saving never drops them.
  useEffect(() => {
    if (enrollments.data) setSelection(enrollmentsToSelection(enrollments.data));
  }, [enrollments.data]);

  const member = members.data?.find((m) => m.id === id);
  if (!member || !plans.data || !enrollments.data) return <Loading />;

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(undefined);
    try {
      await fn();
      setMessage({ text: ok, ok: true });
      await qc.invalidateQueries({ queryKey: keys.members });
      await qc.invalidateQueries({ queryKey: keys.coverage });
      await qc.invalidateQueries({ queryKey: keys.home });
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen
      footer={
        <Button
          title="שמירת ביטוחים"
          onPress={() => act("save", () => api("PUT", `/v1/members/${id}/enrollments`, { enrollments: selectionToEnrollments(selection) }), "נשמר ✓")}
          loading={busy === "save"}
        />
      }
    >
      <Title>{member.fullName}</Title>

      {member.consentStatus === "pending" ? (
        <Card tone="warning">
          <Body style={{ fontWeight: "700" }}>מחכים לאישור של {member.fullName}</Body>
          <Body muted>שלחנו לו/לה קוד ב-SMS. בקש/י את הקוד והקלד/י אותו כאן.</Body>
          <Field label="קוד אישור" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
          <Button
            title="אישור"
            onPress={() => act("consent", () => api("POST", "/v1/members/consent/confirm", { memberId: id, code }), "אושר ✓")}
            loading={busy === "consent"}
            disabled={code.length !== 6}
          />
          <Button title="שלח קוד שוב" variant="ghost" onPress={() => act("resend", () => api("POST", `/v1/members/${id}/consent/resend`), "נשלח קוד חדש")} />
        </Card>
      ) : null}

      <Card>
        <Button title="ייבוא מהר הביטוח" icon="📥" variant="secondary" onPress={() => router.push("/import")} />
        <CoveragePicker plans={plans.data} value={selection} onChange={setSelection} />
      </Card>

      {enrollments.data.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>📄 התנאים בביטוחים שלך</Body>
          <Body muted>כדי שהחישוב יהיה מדויק, בדוק את התנאים מול הפוליסה (בעיקר בביטוח פרטי ומהעבודה).</Body>
          {enrollments.data.map((e) => (
            <Button key={e.planId} title={e.planName} variant="secondary" onPress={() => router.push(`/policy/${id}/${e.planId}`)} />
          ))}
        </Card>
      ) : null}

      {message ? <Body style={{ color: message.ok ? colors.money : colors.danger, marginBottom: space.md }}>{message.text}</Body> : null}

      {!member.isSelf ? (
        <Button
          title="הסרת בן המשפחה"
          variant="ghost"
          onPress={() =>
            act(
              "delete",
              async () => {
                await api("DELETE", `/v1/members/${id}`);
                router.back();
              },
              "הוסר",
            )
          }
        />
      ) : null}
    </Screen>
  );
}
