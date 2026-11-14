import { useEffect, useState } from "react";
import { initLocalDb, startSyncLoop } from "./src/db/syncEngine";
import ActiveShiftScreen, { type ShiftContext } from "./src/screens/ActiveShiftScreen";

// TODO: replace with login + shift/site data cached from the API when auth is built.
const demo: ShiftContext = {
  shiftId: "00000000-0000-7000-8000-000000000000", siteId: "00000000-0000-7000-8000-000000000001", siteName: "Canary Wharf Tower Lobby",
  centre: { lat: 51.5049, lng: -0.0196 }, radiusM: 75, checkpoints: { "GH-1-100": "Main Entrance" },
  welfareIntervalMin: 60, controlRoomMobile: "+447700900000", apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000",
};

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = () => {};
    initLocalDb().then(() => {
      stop = startSyncLoop({ apiUrl: demo.apiUrl, guardId: "00000000-0000-7000-8000-0000000000aa", deviceId: "dev-device" });
      setReady(true);
    });
    return () => stop();
  }, []);
  return ready ? <ActiveShiftScreen ctx={demo} /> : null;
}
