import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Share, Switch, Text, View } from "react-native";
import { api, ApiError } from "../api";
import { pendingCount, wipeLocalData } from "../db/syncEngine";
import { clearToken, getToken } from "../session";
import { Btn, Card, Err, H, P, c } from "../ui";

type Me = {
  user: { firstName: string; dataOrigin: "SYNTHETIC" | "PILOT_CONSENTED"; retentionExpiresAt: string | null; mfaEnabled: boolean };
  consent: { scopes: string[]; policyVersion: string; grantedAt: string } | null;
};
const LABEL: Record<string, string> = { IDENTITY: "Name and work email", CONTACT: "Mobile number", SIA_DETAILS: "SIA badge number and expiry" };

/** The guard's privacy control panel: see what is held, withdraw consent, export, erase. Needs a connection (server is the source of truth). */
export default function MyDataScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try { setMe(await api<Me>("/me", { token: await getToken() })); setErr(""); }
    catch (e) { const x = e as ApiError; if (x.status === 401) onSignedOut(); else setErr(x.message); }
  }, [onSignedOut]);
  useEffect(() => { load(); }, [load]);

  const leave = async () => { await clearToken(); onSignedOut(); };
  const guard = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); } };

  const withdraw = () => guard(async () => {
    const scopes = Object.keys(pick).filter((k) => pick[k]);
    if (!scopes.length) return setErr("Switch on what you want to withdraw");
    const r = await api<{ anonymised: boolean }>("/consent/withdraw", { body: { scopes }, token: await getToken() });
    if (r.anonymised) { await wipeLocalData(); return leave(); }
    setPick({}); await load();
  });
  const exportData = () => guard(async () => {
    const data = await api<unknown>("/export", { token: await getToken() });
    await Share.share({ title: "My Gatehouse data", message: JSON.stringify(data, null, 2) });
  });
  const erase = () => Alert.alert("Delete everything?", "This removes your personal details, selfies, audio and incident text from our servers and this phone. It cannot be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => guard(async () => { await api("/erase", { method: "POST", body: {}, token: await getToken() }); await wipeLocalData(); await leave(); }) },
  ]);
  const signOut = async () => {
    const n = await pendingCount();
    const go = async () => leave();
    if (n > 0) Alert.alert("Unsynced records", `${n} record(s) have not reached the server yet. Signing out keeps them on this phone until you sign in again.`, [{ text: "Cancel", style: "cancel" }, { text: "Sign out", onPress: go }]);
    else await go();
  };

  if (!me) return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56 }}><Err msg={err} /><P mute>Loading...</P></ScrollView>;
  const pilot = me.user.dataOrigin === "PILOT_CONSENTED";
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingTop: 56 }}>
      <H>My data</H>
      <Err msg={err} />
      <Card>
        {pilot ? (
          <>
            <P>You joined with notice {me.consent?.policyVersion}. Your data is deleted automatically on <Text style={{ fontWeight: "700" }}>{me.user.retentionExpiresAt ? new Date(me.user.retentionExpiresAt).toLocaleDateString("en-GB") : "-"}</Text>.</P>
            <P mute>Two-step verification: {me.user.mfaEnabled ? "on" : "off (set it up in the web app under Security)"}.</P>
          </>
        ) : <P mute>This is a synthetic demo account. No real person's data is held.</P>}
      </Card>
      {pilot && me.consent && (
        <>
          <Card>
            <P>Withdraw part of my consent</P>
            {me.consent.scopes.map((s) => (
              <View key={s} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: c.text, flex: 1 }}>{LABEL[s] ?? s}{s === "IDENTITY" ? " (deletes my account)" : ""}</Text>
                <Switch value={!!pick[s]} onValueChange={(v) => setPick((x) => ({ ...x, [s]: v }))} />
              </View>
            ))}
            <Btn tone="grey" label="Withdraw selected" onPress={withdraw} disabled={busy} />
          </Card>
          <Btn label="Export a copy of my data" onPress={exportData} disabled={busy} />
          <Btn tone="red" label="Delete my account and data" onPress={erase} disabled={busy} />
        </>
      )}
      <Btn tone="grey" label="Sign out" onPress={signOut} />
    </ScrollView>
  );
}
