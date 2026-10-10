import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { MemberDto, MemberRelation } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { keys } from "../api/hooks";
import { space } from "../theme";
import { Body, Button, Chip, Field, Row } from ".";

const RELATIONS: Array<{ value: Exclude<MemberRelation, "self">; label: string }> = [
  { value: "child", label: "ילד/ה" },
  { value: "spouse", label: "בן/בת זוג" },
  { value: "parent", label: "הורה" },
  { value: "other", label: "אחר" },
];

function isAdult(relation: MemberRelation, birthDate: string): boolean {
  if (relation !== "child") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const b = new Date(`${birthDate}T00:00:00Z`);
  const eighteen = new Date(Date.UTC(b.getUTCFullYear() + 18, b.getUTCMonth(), b.getUTCDate()));
  return eighteen <= new Date();
}

export function MemberForm({ onDone }: { onDone: (member: MemberDto) => void }) {
  const [fullName, setFullName] = useState("");
  const [relation, setRelation] = useState<Exclude<MemberRelation, "self">>("child");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const adult = isAdult(relation, birthDate);

  async function save() {
    setError(undefined);
    setLoading(true);
    try {
      const member = await api<MemberDto>("POST", "/v1/members", {
        fullName,
        relation,
        birthDate: birthDate || null,
        ...(adult && phone ? { phone } : {}),
      });
      await qc.invalidateQueries({ queryKey: keys.members });
      await qc.invalidateQueries({ queryKey: keys.me });
      onDone(member);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ marginBottom: space.md }}>
        {RELATIONS.map((r) => (
          <Chip key={r.value} label={r.label} selected={relation === r.value} onPress={() => setRelation(r.value)} />
        ))}
      </Row>
      <Field label="שם" value={fullName} onChangeText={setFullName} placeholder="למשל: נועה" />
      <Field
        label="תאריך לידה"
        value={birthDate}
        onChangeText={setBirthDate}
        placeholder="YYYY-MM-DD"
        hint="חשוב לכיסויים לפי גיל (למשל התפתחות הילד)"
        keyboardType="numbers-and-punctuation"
      />
      {adult ? (
        <>
          <Field label="הטלפון שלו/ה" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="050-0000000" />
          <Body muted>כדי להגיש בשם בגיר נשלח לו/לה קוד אישור ב-SMS. זה נדרש לפי חוק הגנת הפרטיות.</Body>
        </>
      ) : null}
      {error ? <Body style={{ color: "#B91C1C" }}>{error}</Body> : null}
      <Button title="הוספה" onPress={save} loading={loading} disabled={fullName.trim().length < 2 || (adult && !phone)} />
    </View>
  );
}
