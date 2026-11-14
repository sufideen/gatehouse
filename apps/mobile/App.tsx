import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, SafeAreaView, Text, View } from "react-native";
import { api, API_URL } from "./src/api";
import { loadShifts, saveShifts } from "./src/db/shiftCache";
import { toShiftContext, type ApiShift } from "./src/shifts";
import { initLocalDb, startSyncLoop } from "./src/db/syncEngine";
import { clearToken, getToken } from "./src/session";
import { c, H, P } from "./src/ui";
import ActiveShiftScreen from "./src/screens/ActiveShiftScreen";
import JoinScreen from "./src/screens/JoinScreen";
import LoginScreen from "./src/screens/LoginScreen";
import MyDataScreen from "./src/screens/MyDataScreen";

const CONTROL_ROOM_MOBILE = process.env.EXPO_PUBLIC_CONTROL_ROOM_MOBILE ?? ""; // SOS text goes here; blank = API alert only

type Screen = "loading" | "login" | "join" | "app";
const inviteFrom = (url: string | null) => /^gatehouse:\/\/join\/([\w-]+)/.exec(url ?? "")?.[1];

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [tab, setTab] = useState<"shift" | "data">("shift");
  const [invite, setInvite] = useState<string | undefined>();
  const [shiftList, setShiftList] = useState<ApiShift[]>([]), [shiftId, setShiftId] = useState<string | null>(null), [online, setOnline] = useState(true);

  // Fetch my shifts; fall back to the on-device cache so a guard with no signal can still work.
  const refreshShifts = useCallback(async () => {
    try {
      const { shifts } = await api<{ shifts: ApiShift[] }>("/shifts", { token: await getToken() });
      await saveShifts(shifts); setShiftList(shifts); setOnline(true);
    } catch { setShiftList(await loadShifts()); setOnline(false); }
  }, []);
  useEffect(() => { if (screen === "app") refreshShifts(); }, [screen, refreshShifts]);

  const signedOut = useCallback(async () => { await clearToken(); setScreen("login"); }, []);

  useEffect(() => {
    (async () => {
      await initLocalDb();
      const link = inviteFrom(await Linking.getInitialURL());
      if (link) { setInvite(link); setScreen("join"); } else setScreen((await getToken()) ? "app" : "login");
    })();
    const sub = Linking.addEventListener("url", ({ url }) => { const t = inviteFrom(url); if (t) { setInvite(t); setScreen("join"); } });
    return () => sub.remove();
  }, []);

  // Sync only while signed in; stops (and keeps queued records) if the server revokes the token.
  useEffect(() => {
    if (screen !== "app") return;
    return startSyncLoop({ apiUrl: API_URL, deviceId: "guard-device", onAuthLost: signedOut });
  }, [screen, signedOut]);

  if (screen === "loading") return null;
  if (screen === "login") return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><LoginScreen onSignedIn={() => setScreen("app")} onHaveInvite={() => setScreen("join")} /></SafeAreaView>;
  if (screen === "join") return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><JoinScreen initialToken={invite} onJoined={() => setScreen("app")} onBack={() => setScreen("login")} /></SafeAreaView>;
  const current = shiftList.find((x) => x.id === shiftId) ?? shiftList.find((x) => x.status === "IN_PROGRESS") ?? shiftList[0];
  const shiftView = current ? (
    <View style={{ flex: 1 }}>
      {shiftList.length > 1 && (
        <View style={{ flexDirection: "row", gap: 8, padding: 8, paddingTop: 48, flexWrap: "wrap" }}>
          {shiftList.map((x) => <Pressable key={x.id} onPress={() => setShiftId(x.id)} style={{ padding: 8, borderRadius: 14, backgroundColor: x.id === current.id ? "#0369a1" : "#1e293b" }}><Text style={{ color: "#fff" }}>{x.siteName} {new Date(x.startUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</Text></Pressable>)}
        </View>
      )}
      {!online && <Text style={{ color: "#fbbf24", textAlign: "center", paddingTop: shiftList.length > 1 ? 0 : 48 }}>Offline: showing saved shifts</Text>}
      <ActiveShiftScreen key={current.id} ctx={toShiftContext(current, { apiUrl: API_URL, controlRoomMobile: CONTROL_ROOM_MOBILE })} />
    </View>
  ) : (
    <View style={{ flex: 1, padding: 20, paddingTop: 64, gap: 12 }}>
      <H>No shifts assigned</H>
      <P mute>Ask your controller to assign you a shift, then pull to refresh below.</P>
      <Pressable onPress={refreshShifts} style={{ backgroundColor: "#334155", padding: 16, borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#fff" }}>Refresh</Text></Pressable>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>{tab === "shift" ? shiftView : <MyDataScreen onSignedOut={signedOut} />}</View>
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: c.line, backgroundColor: c.card }}>
        {([["shift", "My shift"], ["data", "My data"]] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, padding: 16, alignItems: "center" }}>
            <Text style={{ color: tab === k ? "#fff" : c.mute, fontWeight: tab === k ? "700" : "400" }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
