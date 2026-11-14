import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";

export const c = { bg: "#020617", card: "#0f172a", line: "#334155", text: "#e2e8f0", mute: "#94a3b8", blue: "#0369a1", red: "#b91c1c", green: "#15803d", amber: "#b45309" };

export const Btn = ({ label, onPress, tone = "blue", disabled }: { label: string; onPress: () => void; tone?: "blue" | "red" | "green" | "grey"; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={[s.btn, { backgroundColor: tone === "red" ? c.red : tone === "green" ? c.green : tone === "grey" ? c.line : c.blue }, disabled && { opacity: 0.5 }]}>
    <Text style={s.btnT}>{label}</Text>
  </Pressable>
);
export const Field = (p: TextInputProps) => <TextInput placeholderTextColor={c.mute} autoCapitalize="none" {...p} style={[s.input, p.style]} />;
export const H = ({ children }: { children: string }) => <Text style={s.h}>{children}</Text>;
export const P = ({ children, mute }: { children: React.ReactNode; mute?: boolean }) => <Text style={[s.p, mute && { color: c.mute }]}>{children}</Text>;
export const Err = ({ msg }: { msg: string }) => (msg ? <View style={s.err}><Text style={{ color: "#fecaca" }}>{msg}</Text></View> : null);
export const Card = ({ children }: { children: React.ReactNode }) => <View style={s.card}>{children}</View>;

const s = StyleSheet.create({
  btn: { padding: 16, borderRadius: 12, alignItems: "center" }, btnT: { color: "#fff", fontSize: 17, fontWeight: "600" },
  input: { backgroundColor: c.card, color: c.text, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 14, fontSize: 16 },
  h: { color: "#fff", fontSize: 22, fontWeight: "700" }, p: { color: c.text, fontSize: 15, lineHeight: 21 },
  err: { backgroundColor: "#450a0a", padding: 12, borderRadius: 10 }, card: { backgroundColor: c.card, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: c.line },
});
