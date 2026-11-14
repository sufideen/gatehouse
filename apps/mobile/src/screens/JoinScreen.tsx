import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { api, ApiError } from "../api";
import { setToken } from "../session";
import { Btn, Card, Err, Field, H, P, c } from "../ui";

type Notice = { policyVersion: string; retentionDays: number; notice: { title: string; body: string }[]; scopes: { scope: string; label: string; required: boolean }[] };

/** Consent-first pilot sign-up. Nothing is sent until the guard has read the notice and ticked what they agree to share. */
export default function JoinScreen({ initialToken, onJoined, onBack }: { initialToken?: string; onJoined: () => void; onBack: () => void }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [token, setTok] = useState(initialToken ?? ""), [valid, setValid] = useState<boolean | null>(null);
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", password: "", mobile: "", siaBadgeNumber: "", siaLicenceExpiry: "" });
  const [scopes, setScopes] = useState<Record<string, boolean>>({ IDENTITY: false, CONTACT: false, SIA_DETAILS: false });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => { api<Notice>("/notice").then(setNotice).catch((e) => setErr((e as ApiError).message)); }, []);
  useEffect(() => {
    setValid(null);
    if (token.length >= 10) api<{ valid: boolean }>(`/invite/${encodeURIComponent(token)}`).then((r) => setValid(r.valid)).catch(() => setValid(false));
  }, [token]);

  const submit = async () => {
    if (!notice) return;
    setBusy(true); setErr("");
    try {
      const granted = Object.keys(scopes).filter((k) => scopes[k]);
      const { token: t } = await api<{ token: string }>("/join", {
        body: {
          token, ...f, scopes: granted, policyVersion: notice.policyVersion,
          mobile: scopes.CONTACT ? f.mobile : undefined, siaBadgeNumber: scopes.SIA_DETAILS ? f.siaBadgeNumber : undefined,
          siaLicenceExpiry: scopes.SIA_DETAILS && f.siaLicenceExpiry ? f.siaLicenceExpiry : undefined,
        },
      });
      await setToken(t); onJoined();
    } catch (e) { setErr((e as ApiError).message || "Could not join"); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingTop: 56 }} keyboardShouldPersistTaps="handled">
      <H>Join the pilot</H>
      {notice && (
        <Card>{notice.notice.map((n) => <P key={n.title}><Text style={{ fontWeight: "700" }}>{n.title}: </Text>{n.body}</P>)}</Card>
      )}
      <Card>
        <Field placeholder="Invite code (from your controller)" value={token} onChangeText={setTok} />
        {valid === false && <Err msg="This invite is invalid, used or expired." />}
      </Card>
      {valid && notice && (
        <>
          <Card>
            <Field placeholder="First name" autoCapitalize="words" value={f.firstName} onChangeText={set("firstName")} />
            <Field placeholder="Last name" autoCapitalize="words" value={f.lastName} onChangeText={set("lastName")} />
            <Field placeholder="Work email" keyboardType="email-address" autoComplete="username" value={f.email} onChangeText={set("email")} />
            <Field placeholder="Choose a password (12+ characters)" secureTextEntry autoComplete="new-password" value={f.password} onChangeText={set("password")} />
          </Card>
          <Card>
            <P>What I agree to share</P>
            {notice.scopes.map((s) => (
              <View key={s.scope} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: c.text, flex: 1 }}>{s.label}{s.required ? " (required)" : ""}</Text>
                  <Switch value={scopes[s.scope]} onValueChange={(v) => setScopes((x) => ({ ...x, [s.scope]: v }))} />
                </View>
                {s.scope === "CONTACT" && scopes.CONTACT && <Field placeholder="Mobile number" keyboardType="phone-pad" value={f.mobile} onChangeText={set("mobile")} />}
                {s.scope === "SIA_DETAILS" && scopes.SIA_DETAILS && <><Field placeholder="SIA badge number" value={f.siaBadgeNumber} onChangeText={set("siaBadgeNumber")} /><Field placeholder="Expiry (YYYY-MM-DD)" value={f.siaLicenceExpiry} onChangeText={set("siaLicenceExpiry")} /></>}
              </View>
            ))}
          </Card>
          <Err msg={err} />
          <Btn tone="green" label="I consent: create my account" onPress={submit} disabled={busy || !scopes.IDENTITY || !f.firstName || !f.lastName || !f.email || f.password.length < 12} />
        </>
      )}
      {!valid && <Err msg={err} />}
      <Btn tone="grey" label="Back" onPress={onBack} />
    </ScrollView>
  );
}
