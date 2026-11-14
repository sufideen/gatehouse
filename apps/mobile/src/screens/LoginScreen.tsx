import { useState } from "react";
import { ScrollView } from "react-native";
import { api, ApiError } from "../api";
import { setToken } from "../session";
import { Btn, Card, Err, Field, H, P } from "../ui";

export default function LoginScreen({ onSignedIn, onHaveInvite }: { onSignedIn: () => void; onHaveInvite: () => void }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const { token } = await api<{ token: string }>("/login", { body: { email, password, code: needCode ? code : undefined } });
      await setToken(token); onSignedIn();
    } catch (e) {
      const x = e as ApiError;
      if (x.code === "MFA_REQUIRED") setNeedCode(true);
      else setErr(x.code === "BAD_CODE" ? "That code is not correct" : x.code === "RATE_LIMITED" ? "Too many attempts. Try again in 15 minutes." : x.code === "OFFLINE" ? x.message : "Incorrect email or password");
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingTop: 64 }} keyboardShouldPersistTaps="handled">
      <H>Gatehouse</H>
      <Card>
        <Field placeholder="Email" keyboardType="email-address" autoComplete="username" value={email} onChangeText={setEmail} editable={!needCode} />
        <Field placeholder="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} editable={!needCode} />
        {needCode && <><P>Enter the 6-digit code from your authenticator app, or a recovery code.</P><Field placeholder="123456" autoFocus value={code} onChangeText={setCode} keyboardType="default" autoComplete="one-time-code" /></>}
        <Err msg={err} />
        <Btn label={needCode ? "Verify" : "Sign in"} onPress={submit} disabled={busy || !email || !password} />
      </Card>
      <Btn tone="grey" label="I have a pilot invite" onPress={onHaveInvite} />
      <P mute>Forgot your password? Use the web app or ask your controller for a one-time link.</P>
    </ScrollView>
  );
}
