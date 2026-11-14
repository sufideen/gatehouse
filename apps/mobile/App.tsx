import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, SafeAreaView, Text, View } from "react-native";
import { API_URL } from "./src/api";
import { initLocalDb, startSyncLoop } from "./src/db/syncEngine";
import { clearToken, getToken } from "./src/session";
import { c } from "./src/ui";
import ActiveShiftScreen, { type ShiftContext } from "./src/screens/ActiveShiftScreen";
import JoinScreen from "./src/screens/JoinScreen";
import LoginScreen from "./src/screens/LoginScreen";
import MyDataScreen from "./src/screens/MyDataScreen";

// TODO: replace with the guard's real assigned shift/site data, cached from the API after sign-in.
const demoShift: ShiftContext = {
  shiftId: "00000000-0000-7000-8000-000000000000", siteId: "00000000-0000-7000-8000-000000000001", siteName: "Canary Wharf Tower Lobby",
  centre: { lat: 51.5049, lng: -0.0196 }, radiusM: 75, checkpoints: { "GH-1-100": "Main Entrance" },
  welfareIntervalMin: 60, controlRoomMobile: "+447700900000", apiUrl: API_URL,
};

type Screen = "loading" | "login" | "join" | "app";
const inviteFrom = (url: string | null) => /^gatehouse:\/\/join\/([\w-]+)/.exec(url ?? "")?.[1];

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [tab, setTab] = useState<"shift" | "data">("shift");
  const [invite, setInvite] = useState<string | undefined>();

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
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>{tab === "shift" ? <ActiveShiftScreen ctx={demoShift} /> : <MyDataScreen onSignedOut={signedOut} />}</View>
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
