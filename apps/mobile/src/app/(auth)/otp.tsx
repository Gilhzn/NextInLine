import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthResponseDto } from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { keys } from "../../api/hooks";
import { useAuth } from "../../state/auth";
import { Button, Field, Screen, Title } from "../../ui";

export default function Otp() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const setTokens = useAuth((s) => s.setTokens);
  const qc = useQueryClient();

  async function verify(value = code) {
    setError(undefined);
    setLoading(true);
    try {
      const res = await api<AuthResponseDto>("POST", "/v1/auth/otp/verify", { phone, code: value });
      await setTokens(res.accessToken, res.refreshToken);
      qc.setQueryData(keys.me, res.me);
      router.replace("/");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    try {
      await api("POST", "/v1/auth/otp/request", { phone });
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button title="כניסה" onPress={() => verify()} loading={loading} disabled={code.length !== 6} />
          <Button title="לא קיבלתי, שלחו שוב" variant="ghost" onPress={resend} />
        </>
      }
    >
      <Title sub={`שלחנו קוד בן 6 ספרות ל-${phone ?? ""}`}>מה הקוד?</Title>
      <Field
        label="קוד מה-SMS"
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        error={error}
      />
    </Screen>
  );
}
