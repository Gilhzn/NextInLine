import { useMemo, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ImportedPolicyDto, PolicyImportPreviewDto } from "@magiali/shared";
import { api, ApiError, errorMessage, upload } from "../api/client";
import { keys, useMembers } from "../api/hooks";
import { pickFromLibrary, pickPolicyReport, type LocalFile, type PickResult } from "../lib/media";
import { colors, space, type } from "../theme";
import { Badge, Body, Button, Card, Chip, Loading, Row, Screen, Title } from "../ui";
import { Check, ConsentChecklist } from "../ui/Consents";

const HAR_HABITUACH_URL = "https://harb.cma.gov.il/";

const CONFIDENCE_NOTE = {
  exact: "זיהינו את המוצר",
  likely: "זיהינו את סוג הביטוח – כדאי לבדוק את התנאים",
  generic: "זיהינו את החברה – צריך להזין את התנאים מהפוליסה",
} as const;

/**
 * Import from Har HaBituach: the user downloads their own report from the Finance Ministry's site and uploads it.
 * We never sign in on their behalf. Nothing is saved until they confirm.
 */
export default function ImportPolicies() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const members = useMembers();
  const qc = useQueryClient();
  const [file, setFile] = useState<LocalFile | null>(null);
  const [preview, setPreview] = useState<PolicyImportPreviewDto | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [needsAiConsent, setNeedsAiConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ added: number; updated: number; checkTerms: ImportedPolicyDto[] } | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  const self = members.data?.find((m) => m.isSelf);
  const usable = useMemo(() => preview?.policies.filter((p) => p.relevance !== "not_relevant") ?? [], [preview]);
  const others = useMemo(() => preview?.policies.filter((p) => p.relevance === "not_relevant") ?? [], [preview]);

  async function read(f: LocalFile) {
    setBusy(true);
    setError(undefined);
    setNeedsAiConsent(false);
    try {
      const res = await upload<PolicyImportPreviewDto>("/v1/coverage/import", f);
      setPreview(res);
      setChosen(new Set(res.policies.filter((p) => p.relevance === "relevant" && p.match && !p.alreadyEnrolled).map((p) => p.key)));
      if (self) setMemberIds((prev) => (prev.size ? prev : new Set([self.id])));
    } catch (e) {
      if (e instanceof ApiError && e.code === "consent_required") setNeedsAiConsent(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(picker: () => Promise<PickResult>) {
    const res = await picker();
    if (!res.ok || !res.files[0]) return;
    setFile(res.files[0]);
    await read(res.files[0]);
  }

  async function apply() {
    if (!preview) return;
    const items = preview.policies.filter((p) => chosen.has(p.key) && p.match);
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<{ added: number; updated: number }>("POST", "/v1/coverage/import/apply", {
        memberIds: [...memberIds],
        items: items.map((p) => ({
          planId: p.match!.planId,
          policyNumber: p.policyNumber,
          startDate: p.startDate,
          endDate: p.endDate,
        })),
      });
      await qc.invalidateQueries({ queryKey: keys.members });
      await qc.invalidateQueries({ queryKey: keys.coverage });
      await qc.invalidateQueries({ queryKey: keys.home });
      setDone({ ...res, checkTerms: items.filter((p) => p.match!.confidence !== "exact") });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(set: Set<T>, value: T) => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    return n;
  };

  if (!members.data) return <Loading />;

  if (done) {
    const firstMember = [...memberIds][0]!;
    return (
      <Screen
        footer={
          // Back to the screen that opened us (it keeps what the user already picked there).
          <Button title="המשך" onPress={() => (router.canGoBack() ? router.back() : router.replace((next ?? "/") as never))} />
        }
      >
        <Card tone="money">
          <Title>✓ הביטוחים נוספו</Title>
          <Body>
            {done.added > 0 ? `נוספו ${done.added} ` : ""}
            {done.updated > 0 ? `עודכנו ${done.updated} ` : ""}
            (לכל בני המשפחה שבחרת).
          </Body>
        </Card>
        {done.checkTerms.length > 0 ? (
          <Card tone="warning">
            <Body style={{ fontWeight: "700" }}>כדי שהחישוב יהיה מדויק, בדוק את התנאים:</Body>
            {done.checkTerms.map((p) => (
              <Button
                key={p.key}
                title={p.match!.planName}
                variant="secondary"
                onPress={() => router.push(`/policy/${firstMember}/${p.match!.planId}`)}
              />
            ))}
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        preview && usable.length > 0 ? (
          <Button
            title={`הוספת ${[...chosen].filter((k) => usable.some((p) => p.key === k && p.match)).length} ביטוחים`}
            onPress={apply}
            loading={busy}
            disabled={chosen.size === 0 || memberIds.size === 0}
          />
        ) : undefined
      }
    >
      <Title sub="הרשימה הרשמית של משרד האוצר: כל הביטוחים שלך במקום אחד">ייבוא מהר הביטוח</Title>

      {!preview ? (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>איך זה עובד (2 דקות)</Body>
            <Body>1. נכנסים להר הביטוח עם תעודת הזהות (הזדהות ממשלתית).</Body>
            <Body>2. מורידים את הדוח (קובץ אקסל), או מצלמים מסך של רשימת הביטוחים.</Body>
            <Body>3. מעלים אותו כאן. נמצא את הביטוחים שמחזירים כסף על קבלות.</Body>
            <Button title="פתיחת הר הביטוח" icon="🔗" variant="secondary" onPress={() => void Linking.openURL(HAR_HABITUACH_URL)} />
          </Card>
          <Card tone="primary">
            <Body>🔒 אנחנו לא נכנסים לחשבון שלך ולא מבקשים סיסמאות. הקובץ נקרא ונמחק מיד, ושום דבר לא נשמר עד שתאשר/י.</Body>
            <Body muted>השב״ן של קופת החולים לא מופיע בהר הביטוח, ובוחרים אותו במסך הכיסויים.</Body>
          </Card>
          {busy ? (
            <Loading label="קוראים את הדוח..." />
          ) : (
            <View style={{ gap: space.sm }}>
              <Button title="העלאת הקובץ מהר הביטוח" icon="📄" onPress={() => pick(pickPolicyReport)} />
              {Platform.OS !== "web" ? (
                <Button title="צילום מסך מהגלריה" icon="🖼" variant="secondary" onPress={() => pick(() => pickFromLibrary(false))} />
              ) : null}
            </View>
          )}
          {needsAiConsent ? (
            <Card tone="warning">
              <Body>כדי לקרוא צילום מסך או PDF נשתמש בקריאה אוטומטית. אפשר גם להעלות את קובץ האקסל, ואז לא צריך את זה.</Body>
              <ConsentChecklist kinds={["ai_processing"]} required={["ai_processing"]} submitTitle="מאשר/ת, קרא את הקובץ" onDone={() => file && void read(file)} />
            </Card>
          ) : null}
        </>
      ) : (
        <>
          {preview.notes.map((n, i) => (
            <Card key={i} tone="warning">
              <Body>{n}</Body>
            </Card>
          ))}

          {usable.length > 0 ? (
            <Card>
              <Text style={label}>על מי חלים הביטוחים שסימנת?</Text>
              <Row>
                {members.data.map((m) => (
                  <Chip key={m.id} label={m.fullName} selected={memberIds.has(m.id)} onPress={() => setMemberIds((s) => toggle(s, m.id))} />
                ))}
              </Row>
              <Body muted>בדרך כלל ביטוח פרטי מכסה גם את בני המשפחה שנרשמו בפוליסה. אפשר לבדוק בדוח.</Body>
            </Card>
          ) : (
            <Card>
              <Body>לא מצאנו ביטוחים שמחזירים כסף על קבלות. אפשר להוסיף ידנית במסך הכיסויים.</Body>
            </Card>
          )}

          {usable.map((p) => (
            <Card key={p.key} tone={chosen.has(p.key) ? "primary" : undefined}>
              {p.match ? (
                <Check label={p.match.planName} checked={chosen.has(p.key)} onToggle={() => setChosen((s) => toggle(s, p.key))}>
                  <PolicyLine p={p} />
                </Check>
              ) : (
                <PolicyLine p={p} />
              )}
            </Card>
          ))}

          {others.length > 0 ? (
            <Card>
              <Button
                title={`${showOthers ? "▾" : "▸"} עוד ${others.length} ביטוחים שלא מחזירים על קבלות`}
                variant="ghost"
                onPress={() => setShowOthers((v) => !v)}
              />
              {showOthers
                ? others.map((p) => (
                    <Body key={p.key} muted>
                      • {p.insurer ?? "?"} · {p.branch ?? p.product ?? ""} – {p.reason}
                    </Body>
                  ))
                : null}
            </Card>
          ) : null}

          <Button title="העלאת קובץ אחר" variant="ghost" onPress={() => setPreview(null)} />
        </>
      )}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}

function PolicyLine({ p }: { p: ImportedPolicyDto }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>{p.match?.planName ?? p.insurer ?? "ביטוח"}</Text>
      <Body muted>
        {[p.insurer, p.branch, p.product].filter(Boolean).join(" · ")}
        {p.policyNumber ? ` · פוליסה ${p.policyNumber}` : ""}
      </Body>
      <Row>
        {p.alreadyEnrolled ? <Badge label="כבר אצלך" tone="muted" /> : null}
        {p.relevance === "maybe" ? <Badge label="לא בטוח שמחזיר על קבלות" tone="warning" /> : null}
        {p.isGroup ? <Badge label="קבוצתי" tone="primary" /> : null}
      </Row>
      <Text style={{ fontSize: type.caption, color: p.match ? colors.muted : colors.warning }}>
        {p.match ? CONFIDENCE_NOTE[p.match.confidence] : "את החברה הזו עוד אין אצלנו – אפשר להוסיף ידנית כביטוח קבוצתי או לכתוב לנו"}
      </Text>
    </View>
  );
}

const label = { fontSize: type.small, color: colors.muted, fontWeight: "600" as const, marginBottom: space.sm };
