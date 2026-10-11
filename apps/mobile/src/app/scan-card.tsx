import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatILS, type StatementCandidateDto, type StatementScanDto } from "@magiali/shared";
import { api, ApiError, errorMessage, upload } from "../api/client";
import { pickFromLibrary, pickStatement, type LocalFile, type PickResult } from "../lib/media";
import { colors, space, type } from "../theme";
import { Badge, Body, Button, Card, Loading, Row, Screen, Title } from "../ui";
import { Check, ConsentChecklist } from "../ui/Consents";

const ISSUERS = [
  { name: "ישראכרט / אמריקן אקספרס", how: "באזור האישי: פירוט עסקאות ← ייצוא לאקסל" },
  { name: "מקס", how: "באזור האישי: פירוט חיובים ← הורדה לאקסל" },
  { name: "כאל", how: "באזור האישי: פירוט עסקאות ← ייצוא לאקסל" },
  { name: "כרטיס של הבנק", how: "באתר הבנק: כרטיסי אשראי ← פירוט ← ייצוא" },
];

const dateHe = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Credit card statement scan: the user downloads their own statement and uploads it. We look only for payments to
 * doctors, clinics and therapists that have no receipt in the app. The file itself is never stored – only the
 * payments the user chooses to keep as reminders.
 */
export default function ScanCard() {
  const qc = useQueryClient();
  const [file, setFile] = useState<LocalFile | null>(null);
  const [scan, setScan] = useState<StatementScanDto | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [needsAiConsent, setNeedsAiConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<number | null>(null);

  async function read(f: LocalFile) {
    setBusy(true);
    setError(undefined);
    setNeedsAiConsent(false);
    try {
      const res = await upload<StatementScanDto>("/v1/statement-scan", f);
      setScan(res);
      setChosen(new Set(res.candidates.filter((c) => !c.hasReceipt && !c.alreadySaved).map((c) => c.key)));
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

  async function save() {
    if (!scan) return;
    const items = scan.candidates.filter((c) => chosen.has(c.key));
    setBusy(true);
    setError(undefined);
    try {
      await api("POST", "/v1/payment-leads", {
        items: items.map((c) => ({ merchant: c.merchant, date: c.date, amountAgorot: c.amountAgorot, category: c.category })),
      });
      await qc.invalidateQueries({ queryKey: ["money"] });
      setSaved(items.length);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  if (saved !== null) {
    return (
      <Screen footer={<Button title="לכסף הבריאותי שלנו" onPress={() => (router.canGoBack() ? router.back() : router.replace("/money"))} />}>
        <Card tone="money">
          <Title>✓ שמרנו {saved} תשלומים</Title>
          <Body>הם מופיעים תחת "פספסנו" עד שתצלמו קבלה. את הקבלה מבקשים מהרופא או מהמכון (אפשר גם במייל).</Body>
        </Card>
        <Button title="צלמו קבלה עכשיו" icon="📷" variant="secondary" onPress={() => router.push("/capture")} />
      </Screen>
    );
  }

  const fresh = scan?.candidates.filter((c) => !c.hasReceipt) ?? [];
  const covered = scan?.candidates.filter((c) => c.hasReceipt) ?? [];
  const chosenTotal = fresh.filter((c) => chosen.has(c.key)).reduce((n, c) => n + (c.estimatedRefundAgorot ?? 0), 0);

  return (
    <Screen
      footer={
        scan && fresh.length > 0 ? (
          <Button title={`שמור ${chosen.size} ותזכיר לי להשיג קבלה`} onPress={save} loading={busy} disabled={chosen.size === 0} />
        ) : undefined
      }
    >
      <Title sub="נמצא תשלומים לרופאים ולטיפולים שאין עליהם קבלה – ועליהם אולי מגיע לכם החזר">סריקת פירוט האשראי</Title>

      {!scan ? (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>איך מורידים את הפירוט (דקה)</Body>
            {ISSUERS.map((i) => (
              <Body key={i.name}>
                • <Text style={{ fontWeight: "700" }}>{i.name}</Text>: {i.how}
              </Body>
            ))}
            <Body muted>כדאי לבחור תקופה ארוכה – עד 3 שנים אחורה, כי עד אז אפשר לתבוע.</Body>
          </Card>
          <Card tone="primary">
            <Body>🔒 אנחנו לא נכנסים לחשבון שלכם ולא מבקשים סיסמאות. הקובץ נקרא ונמחק מיד. נשמרים רק התשלומים שתבחרו.</Body>
          </Card>
          {busy ? (
            <Loading label="סורקים את הפירוט..." />
          ) : (
            <View style={{ gap: space.sm }}>
              <Button title="העלאת קובץ הפירוט" icon="📄" onPress={() => pick(pickStatement)} />
              {Platform.OS !== "web" ? (
                <Button title="צילום מסך מהגלריה" icon="🖼" variant="secondary" onPress={() => pick(() => pickFromLibrary(false))} />
              ) : null}
            </View>
          )}
          {needsAiConsent ? (
            <Card tone="warning">
              <Body>כדי לקרוא PDF או צילום מסך נשתמש בקריאה אוטומטית. בקובץ אקסל לא צריך את זה.</Body>
              <ConsentChecklist kinds={["ai_processing"]} required={["ai_processing"]} submitTitle="מאשר/ת, סרוק את הקובץ" onDone={() => file && void read(file)} />
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card tone={fresh.length ? "money" : undefined}>
            <Body style={{ fontWeight: "700" }}>
              עברנו על {scan.rowsScanned} עסקאות.{" "}
              {fresh.length ? `מצאנו ${fresh.length} תשלומים רפואיים בלי קבלה.` : "לא מצאנו תשלומים רפואיים בלי קבלה 👏"}
            </Body>
            {chosenTotal > 0 ? <Body>החזר משוער על מה שסימנתם: {formatILS(chosenTotal)}</Body> : null}
          </Card>
          {scan.notes.map((n, i) => (
            <Card key={i} tone="warning">
              <Body>{n}</Body>
            </Card>
          ))}
          {fresh.map((c) => (
            <Card key={c.key} tone={chosen.has(c.key) ? "primary" : undefined}>
              <Check label={c.merchant} checked={chosen.has(c.key)} onToggle={() => toggle(c.key)}>
                <Line c={c} />
              </Check>
            </Card>
          ))}
          {covered.length > 0 ? (
            <Body muted>
              ✓ {covered.length} תשלומים רפואיים נוספים כבר יש להם קבלה באפליקציה: {covered.map((c) => c.merchant).join(", ")}
            </Body>
          ) : null}
          <Body muted>לא כל תשלום מזכה בהחזר. ההערכה לפי הביטוחים שלכם, והקבלה היא שקובעת.</Body>
          <Button title="סריקת קובץ אחר" variant="ghost" onPress={() => setScan(null)} />
        </>
      )}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}

function Line({ c }: { c: StatementCandidateDto }) {
  return (
    <View style={{ gap: 2, flex: 1 }}>
      <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>{c.merchant}</Text>
      <Body muted>
        {dateHe(c.date)} · {formatILS(c.amountAgorot)}
        {c.categoryLabel ? ` · ${c.categoryLabel}` : ""}
      </Body>
      <Row>
        {c.estimatedRefundAgorot ? <Badge label={`החזר משוער ${formatILS(c.estimatedRefundAgorot)}`} tone="money" /> : null}
        {c.alreadySaved ? <Badge label="כבר ברשימה" tone="muted" /> : null}
        {!c.category ? <Badge label="סוג השירות לא ברור" tone="warning" /> : null}
      </Row>
    </View>
  );
}
