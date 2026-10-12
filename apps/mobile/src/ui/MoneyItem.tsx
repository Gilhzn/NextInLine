import { useState } from "react";
import { Text } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { formatILS, type MoneyItemDto } from "@magiali/shared";
import { api } from "../api/client";
import { ACTION_VERB, goToMoneyAction } from "../lib/money-actions";
import { colors, type } from "../theme";
import { Badge, Body, Button, Card, Row, Spread } from "./index";

/** One money item: what it is, how much, and the single action that moves it forward. */
export function MoneyItemCard({ item, color }: { item: MoneyItemDto; color: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const action = item.action;

  async function dismiss(id: string) {
    setBusy(true);
    try {
      await api("POST", `/v1/payment-leads/${id}/dismiss`);
      await qc.invalidateQueries({ queryKey: ["money"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone={item.urgent ? "warning" : undefined} onPress={action ? () => goToMoneyAction(action) : undefined}>
      <Spread>
        <Body style={{ flex: 1, fontWeight: "700" }}>{item.title}</Body>
        {item.amountAgorot ? <Text style={{ fontSize: type.body, fontWeight: "800", color }}>{formatILS(item.amountAgorot)}</Text> : null}
      </Spread>
      {item.detail ? <Body muted>{item.detail}</Body> : null}
      {item.urgent ? <Badge label={item.kind === "unused_quota" ? "עד סוף השנה" : "דחוף"} tone="warning" /> : null}
      {action?.type === "lead" ? (
        <Row>
          <Button title={ACTION_VERB[item.kind]} icon="📷" variant="secondary" onPress={() => goToMoneyAction(action)} />
          <Button title="לא רלוונטי" variant="ghost" loading={busy} onPress={() => void dismiss(action.id)} />
        </Row>
      ) : action ? (
        <Text style={{ fontSize: type.small, color: colors.primary, fontWeight: "800" }}>{ACTION_VERB[item.kind]} ←</Text>
      ) : null}
    </Card>
  );
}
