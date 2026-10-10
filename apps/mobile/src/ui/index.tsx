import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatILS } from "@magiali/shared";
import { colors, radius, space, type } from "../theme";

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

export function Card({ children, style, onPress, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: "money" | "warning" | "danger" | "primary" }) {
  const toneStyle =
    tone === "money"
      ? { backgroundColor: colors.moneySoft, borderColor: colors.moneySoft }
      : tone === "warning"
        ? { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }
        : tone === "danger"
          ? { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }
          : tone === "primary"
            ? { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }
            : null;
  const body = <View style={[styles.card, toneStyle, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
      {body}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
}) {
  const isDisabled = disabled || loading;
  const bg =
    variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : variant === "secondary" ? colors.surface : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#fff" : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "secondary" && { borderWidth: 1.5, borderColor: colors.primary },
        variant === "ghost" && { minHeight: 44 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>
          {icon ? `${icon}  ` : ""}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Money({ agorot, size = "md", color }: { agorot: number; size?: "sm" | "md" | "lg" | "xl"; color?: string }) {
  const fontSize = size === "xl" ? type.money + 4 : size === "lg" ? type.money - 6 : size === "md" ? type.body + 1 : type.small;
  return (
    <Text style={{ fontSize, fontWeight: "700", color: color ?? colors.text, fontVariant: ["tabular-nums"] }}>{formatILS(agorot)}</Text>
  );
}

export function Field({ label, hint, error, highlight, ...props }: TextInputProps & { label: string; hint?: string; error?: string; highlight?: boolean }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.disabled}
        accessibilityLabel={label}
        style={[styles.input, highlight && { borderColor: colors.warning, backgroundColor: colors.warningSoft }, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {highlight ? <Text style={[styles.hint, { color: colors.warning }]}>לא בטוחים בשדה הזה. בדוק אותו</Text> : null}
      {hint && !highlight ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      <Text style={[styles.chipText, selected && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }, style]}>{children}</View>;
}

export function Spread({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }, style]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: space.xxl, alignItems: "center", gap: space.md }}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Body muted>{label}</Body> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="danger">
      <Body>{message}</Body>
      {onRetry ? <Button title="נסה שוב" variant="ghost" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.md }} />;
}

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "money" | "warning" | "danger" | "muted" }) {
  const map = {
    primary: [colors.primarySoft, colors.primaryDark],
    money: [colors.moneySoft, colors.money],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    muted: [colors.border, colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: type.caption, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl * 2 },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: space.sm },
  title: { fontSize: type.h1, fontWeight: "800", color: colors.text },
  sub: { fontSize: type.body, color: colors.muted, marginTop: space.xs, lineHeight: 24 },
  body: { fontSize: type.body, color: colors.text, lineHeight: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.sm,
  },
  button: { minHeight: 56, borderRadius: radius, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  buttonText: { fontSize: type.body + 1, fontWeight: "700" },
  label: { fontSize: type.small, color: colors.muted, marginBottom: space.xs, fontWeight: "600" },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space.md,
    fontSize: type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  hint: { fontSize: type.caption, color: colors.muted, marginTop: space.xs },
  chip: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontSize: type.small, color: colors.text, fontWeight: "600" },
});
