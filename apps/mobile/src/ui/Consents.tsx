import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { LEGAL_VERSIONS, type ConsentKind, type MeDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { keys, useMe } from "../api/hooks";
import { openLegal, type LegalDoc } from "../lib/legal";
import { colors, space, type } from "../theme";
import { Body, Button, Card } from ".";

export function Check({ checked, onToggle, children, label }: { checked: boolean; onToggle: () => void; children: React.ReactNode; label: string }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", paddingVertical: space.sm }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? colors.primary : colors.disabled,
          backgroundColor: checked ? colors.primary : colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

const Link = ({ doc, children }: { doc: LegalDoc; children: string }) => (
  <Text style={{ color: colors.primary, textDecorationLine: "underline" }} onPress={() => openLegal(doc)} accessibilityRole="link">
    {children}
  </Text>
);

/** The wording of each consent. Every box starts empty; the required ones gate the action. */
export const CONSENT_COPY: Record<ConsentKind, { title: React.ReactNode; detail: string; label: string }> = {
  terms: {
    label: "תנאי השימוש",
    title: (
      <Text>
        קראתי ואני מסכים/ה ל<Link doc="terms">תנאי השימוש</Link>, כולל העמלה ותנאי הביטול
      </Text>
    ),
    detail: "משלמים רק על כסף שהגיע. אפשר לבטל תוך 14 יום, ולמחוק את החשבון בכל רגע.",
  },
  privacy: {
    label: "מדיניות הפרטיות",
    title: (
      <Text>
        קראתי את <Link doc="privacy">מדיניות הפרטיות</Link>
      </Text>
    ),
    detail: "מה נאסף, למה, למי זה מועבר, כמה זמן נשמר, והזכויות שלך.",
  },
  medical_data: {
    label: "עיבוד מידע רפואי",
    title: <Text>אני מסכים/ה לעיבוד מידע רפואי שלי ושל בני המשפחה שאוסיף</Text>,
    detail: "רק כדי לחשב, להכין ולהגיש בקשות החזר. אין חובה חוקית למסור את המידע, אבל בלעדיו לא נוכל לעזור.",
  },
  ai_processing: {
    label: "קריאה אוטומטית של קבלות",
    title: <Text>קריאה אוטומטית של הקבלות בבינה מלאכותית (לא חובה)</Text>,
    detail: "הצילום נשלח לעיבוד אצל Anthropic בארה״ב, רק לחילוץ הפרטים, ולא לאימון מודלים. בלי זה מקלידים את הפרטים לבד.",
  },
  poa: {
    label: "ייפוי כוח",
    title: (
      <Text>
        <Link doc="poa">ייפוי כוח מצומצם</Link> להגשה ומעקב בשמי (לא חובה)
      </Text>
    ),
    detail: "מאפשר לנו להגיש ולעקוב. לא לקבל כסף בשמך ולא לערער. בלי זה נכין לך תיק מוכן להגשה עצמית.",
  },
  marketing: {
    label: "עדכונים וטיפים",
    title: <Text>אשמח לקבל טיפים ועדכונים על החזרים (לא חובה)</Text>,
    detail: "אפשר להפסיק בכל רגע.",
  },
};

export function useConsents() {
  const me = useMe();
  const qc = useQueryClient();
  const granted = new Set((me.data?.consents ?? []).map((c) => c.kind as ConsentKind));
  async function grant(kinds: ConsentKind[]) {
    let latest: MeDto | undefined;
    for (const kind of kinds) {
      const version = kind === "terms" ? LEGAL_VERSIONS.terms : kind === "poa" ? LEGAL_VERSIONS.poa : LEGAL_VERSIONS.privacy;
      latest = await api<MeDto>("POST", "/v1/consents", { kind, version });
    }
    if (latest) qc.setQueryData(keys.me, latest);
  }
  async function revoke(kind: ConsentKind) {
    qc.setQueryData(keys.me, await api<MeDto>("DELETE", `/v1/consents/${kind}`));
  }
  return { me, granted, grant, revoke };
}

/**
 * Boxes for the consents not given yet. `required` must all be ticked before `onDone`.
 * Nothing is pre-ticked (Privacy Protection Authority: active opt-in for sensitive data).
 */
export function ConsentChecklist({
  kinds,
  required,
  submitTitle,
  onDone,
}: {
  kinds: ConsentKind[];
  required: ConsentKind[];
  submitTitle: string;
  onDone: () => void;
}) {
  const { granted, grant } = useConsents();
  const pending = kinds.filter((k) => !granted.has(k));
  const [checked, setChecked] = useState<Set<ConsentKind>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = required.every((k) => granted.has(k) || checked.has(k));

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await grant(pending.filter((k) => checked.has(k)));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {kinds.map((k) => {
        const copy = CONSENT_COPY[k];
        if (granted.has(k)) {
          return (
            <Body key={k} muted>
              ✓ {copy.label}
            </Body>
          );
        }
        return (
          <Check
            key={k}
            label={copy.label}
            checked={checked.has(k)}
            onToggle={() =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                return next;
              })
            }
          >
            <Text style={{ fontSize: type.body, color: colors.text }}>
              {copy.title}
              {required.includes(k) ? <Text style={{ color: colors.danger }}> *</Text> : null}
            </Text>
            <Body muted>{copy.detail}</Body>
          </Check>
        );
      })}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      <Button title={submitTitle} onPress={submit} loading={busy} disabled={!ready} />
    </View>
  );
}

/**
 * Before the first medical document: the notice (privacy law §11) and the consents it needs.
 * Renders its children once those consents exist.
 */
export function MedicalConsentGate({ children }: { children: React.ReactNode }) {
  const { granted, me } = useConsents();
  const [done, setDone] = useState(false);
  if (!me.data) return null;
  if (done || (granted.has("terms") && granted.has("privacy") && granted.has("medical_data"))) return <>{children}</>;
  return (
    <Card tone="primary">
      <Text style={{ fontSize: type.body, fontWeight: "800", color: colors.text }}>🔒 לפני שמעלים קבלות</Text>
      <Body>
        קבלות רפואיות הן מידע רגיש. הן נשמרות אצלנו מוצפנות, משמשות רק לחישוב ולהגשת ההחזר, ונמחקות אוטומטית אחרי שהתביעה נסגרת. אפשר לבטל כל
        הסכמה בהגדרות.
      </Body>
      <ConsentChecklist
        kinds={["terms", "privacy", "medical_data", "ai_processing"]}
        required={["terms", "privacy", "medical_data"]}
        submitTitle="מסכים/ה, אפשר להמשיך"
        onDone={() => setDone(true)}
      />
    </Card>
  );
}
