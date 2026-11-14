import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import * as SMS from "expo-sms";
import NfcManager, { NfcTech } from "react-native-nfc-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { enqueue, enqueueMedia } from "../db/syncEngine";
import { distanceMeters, type LatLng } from "../geo";

export type ShiftContext = {
  shiftId: string; siteId: string; siteName: string; centre: LatLng; radiusM: number;
  /** Cached offline: external_tag_uid -> checkpoint name (arbitrary legacy Guardhouse strings supported). */
  checkpoints: Record<string, string>;
  welfareIntervalMin: number; controlRoomMobile: string; apiUrl: string;
  /** An already-open clock-in for this shift (resume after app restart). */
  clockIn?: { syncUuid: string } | null;
};

const WELFARE_WARN_MS = 5 * 60_000;
const CATEGORIES = ["Trespass", "Theft", "Damage", "Aggression", "Fire/Alarm", "Other"] as const;

export default function ActiveShiftScreen({ ctx }: { ctx: ShiftContext }) {
  const [camPerm, requestCam] = useCameraPermissions();
  const [clockedIn, setClockedIn] = useState(!!ctx.clockIn);
  const clockInKey = useRef<string | null>(ctx.clockIn?.syncUuid ?? null);
  const [mode, setMode] = useState<"home" | "selfie" | "scan" | "incident">("home");
  const [msg, setMsg] = useState("");
  const camRef = useRef<CameraView>(null);

  // ---- Geofenced clock-in/out with mandatory live selfie (anti-buddy-punching) ----
  const currentPoint = async (): Promise<LatLng> => {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  };
  const startClockIn = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted || (!camPerm?.granted && !(await requestCam()).granted)) return setMsg("Location and camera permission are required");
    const d = distanceMeters(await currentPoint(), ctx.centre);
    if (d > ctx.radiusM) return setMsg(`You are ${Math.round(d)} m from site (limit ${ctx.radiusM} m). Move on site to clock in.`);
    setMode("selfie");
  };
  const captureSelfie = async () => {
    const photo = await camRef.current?.takePictureAsync({ quality: 0.5 });
    if (!photo) return setMsg("Selfie failed, try again");
    const gps = await currentPoint();
    const selfieKey = await enqueueMedia(photo.uri, "image/jpeg", "selfies");
    clockInKey.current = await enqueue("CLOCK_IN", { shiftId: ctx.shiftId, gps, selfieKey });
    setClockedIn(true); setMode("home"); setMsg("Clocked in (saved on device, will sync)");
  };

  // ---- Hardware-agnostic scanner: QR via camera, NFC via NFC manager ----
  const recordScan = useCallback(async (tagUid: string) => {
    const name = ctx.checkpoints[tagUid];
    const gps = await currentPoint().catch(() => undefined);
    await enqueue("PATROL_SCAN", { shiftId: ctx.shiftId, tagUid, gps });
    setMsg(name ? `Checkpoint logged: ${name}` : `Unrecognised tag ${tagUid} logged for review`);
    Vibration.vibrate(100);
  }, [ctx]);
  const scanNfc = async () => {
    try {
      await NfcManager.start();
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      if (tag?.id) await recordScan(tag.id.toUpperCase().match(/.{1,2}/g)?.join(":") ?? tag.id);
    } catch { setMsg("NFC scan cancelled"); } finally { NfcManager.cancelTechnologyRequest().catch(() => {}); }
  };

  // ---- BS 8484 lone-worker welfare timer ----
  const [dueAt, setDueAt] = useState(() => Date.now() + ctx.welfareIntervalMin * 60_000);
  const [now, setNow] = useState(Date.now());
  const warned = useRef(false), escalated = useRef(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const triggerSos = useCallback(async (reason: "SLIDE" | "WELFARE_MISSED") => {
    const gps = await currentPoint().catch(() => undefined);
    const rec = await Audio.requestPermissionsAsync().then(async (p) => {
      if (!p.granted) return undefined;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true });
      return (await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)).recording;
    }).catch(() => undefined);
    const audioKey = rec ? `sos/${Date.now()}` : undefined;
    await enqueue("WELFARE_CHECK", { shiftId: ctx.shiftId, dueUtc: new Date(dueAt).toISOString(), status: "SOS_TRIGGERED", audioKey, gps, reason });
    if (ctx.controlRoomMobile && (await SMS.isAvailableAsync())) SMS.sendSMSAsync([ctx.controlRoomMobile], `SOS ${reason} at ${ctx.siteName}${gps ? ` https://maps.google.com/?q=${gps.lat},${gps.lng}` : ""}`).catch(() => {});
    if (rec) setTimeout(async () => { await rec.stopAndUnloadAsync().catch(() => {}); const uri = rec.getURI(); if (uri) await enqueueMedia(uri, "audio/mp4", "sos"); }, 60_000);
    setMsg("SOS sent to control room");
  }, [ctx, dueAt]);
  useEffect(() => {
    const remaining = dueAt - now;
    if (remaining <= WELFARE_WARN_MS && remaining > 0 && !warned.current) { warned.current = true; Vibration.vibrate([0, 500, 300, 500], true); }
    if (remaining <= 0 && !escalated.current) {
      escalated.current = true; Vibration.cancel();
      enqueue("WELFARE_CHECK", { shiftId: ctx.shiftId, dueUtc: new Date(dueAt).toISOString(), status: "OVERDUE" });
      triggerSos("WELFARE_MISSED");
    }
  }, [now, dueAt, ctx.shiftId, triggerSos]);
  const iAmSafe = async () => {
    Vibration.cancel();
    await enqueue("WELFARE_CHECK", { shiftId: ctx.shiftId, dueUtc: new Date(dueAt).toISOString(), status: "OK" });
    warned.current = escalated.current = false;
    setDueAt(Date.now() + ctx.welfareIntervalMin * 60_000);
  };
  const remaining = Math.max(0, dueAt - now);
  const urgent = remaining <= WELFARE_WARN_MS;

  // ---- Incident reporter (voice dictation = OS keyboard dictation on the text field) ----
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Other");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const addPhoto = async () => {
    const p = await camRef.current?.takePictureAsync({ quality: 0.6 });
    if (p) setPhotos((x) => [...x, p.uri]);
  };
  const submitIncident = async () => {
    const mediaKeys = await Promise.all(photos.map((u) => enqueueMedia(u, "image/jpeg", "incidents")));
    await enqueue("INCIDENT", { siteId: ctx.siteId, severity: "MEDIUM", category, transcript: notes, mediaKeys });
    setNotes(""); setPhotos([]); setMode("home"); setMsg("Incident saved");
  };

  // ---- Slide-to-trigger SOS ----
  const [slide, setSlide] = useState(0);
  const sosTrack = 260;

  if (mode === "selfie" || mode === "scan" || (mode === "incident" && camPerm?.granted)) {
    return (
      <View style={s.fill}>
        {mode !== "incident" && <CameraView ref={camRef} style={s.fill} facing={mode === "selfie" ? "front" : "back"}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={mode === "scan" ? ({ data }) => { setMode("home"); recordScan(data); } : undefined} />}
        {mode === "incident" && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={s.h}>Incident report</Text>
            <View style={s.row}>{CATEGORIES.map((c) => <Pressable key={c} onPress={() => setCategory(c)} style={[s.chip, category === c && s.chipOn]}><Text style={s.t}>{c}</Text></Pressable>)}</View>
            <TextInput style={s.input} multiline placeholder="Describe (tap the keyboard mic to dictate)" placeholderTextColor="#94a3b8" value={notes} onChangeText={setNotes} />
            <CameraView ref={camRef} style={{ height: 160 }} facing="back" />
            <Pressable style={s.btn} onPress={addPhoto}><Text style={s.bt}>Add timestamped photo ({photos.length})</Text></Pressable>
            <Pressable style={[s.btn, s.go]} onPress={submitIncident}><Text style={s.bt}>Save incident</Text></Pressable>
          </ScrollView>
        )}
        <Pressable style={[s.btn, s.back]} onPress={() => setMode("home")}><Text style={s.bt}>Back</Text></Pressable>
        {mode === "selfie" && <Pressable style={[s.btn, s.go, s.snap]} onPress={captureSelfie}><Text style={s.bt}>Take selfie & clock in</Text></Pressable>}
      </View>
    );
  }

  return (
    <View style={[s.fill, s.pad, urgent && { backgroundColor: "#7f1d1d" }]}>
      <Text style={s.h}>{ctx.siteName}</Text>
      <Text style={s.t}>{msg}</Text>
      <View style={s.bar}><View style={[s.barFill, { width: `${(remaining / (ctx.welfareIntervalMin * 60_000)) * 100}%`, backgroundColor: urgent ? "#ef4444" : "#22c55e" }]} /></View>
      <Text style={s.big}>{Math.floor(remaining / 60_000)}:{String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}</Text>
      <Pressable style={[s.btn, s.safe]} onPress={iAmSafe}><Text style={s.bigBt}>I AM SAFE</Text></Pressable>
      {!clockedIn
        ? <Pressable style={[s.btn, s.go]} onPress={startClockIn}><Text style={s.bt}>Clock in</Text></Pressable>
        : <>
            <View style={s.row}>
              <Pressable style={[s.btn, s.half]} onPress={() => setMode("scan")}><Text style={s.bt}>Scan QR</Text></Pressable>
              <Pressable style={[s.btn, s.half]} onPress={scanNfc}><Text style={s.bt}>Scan NFC</Text></Pressable>
            </View>
            <Pressable style={s.btn} onPress={() => setMode("incident")}><Text style={s.bt}>Report incident</Text></Pressable>
            <Pressable style={s.btn} onPress={async () => { if (!clockInKey.current) return; await enqueue("CLOCK_OUT", { attendanceSyncUuid: clockInKey.current, gps: await currentPoint() }); clockInKey.current = null; setClockedIn(false); }}><Text style={s.bt}>Clock out</Text></Pressable>
          </>}
      <View style={s.sosTrack} onTouchMove={(e) => setSlide(Math.min(sosTrack, Math.max(0, e.nativeEvent.locationX)))}
        onTouchEnd={() => { if (slide >= sosTrack - 20) triggerSos("SLIDE"); setSlide(0); }}>
        <View style={[s.sosKnob, { left: slide }]} /><Text style={s.sosTxt}>SLIDE FOR SOS</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#020617" }, pad: { padding: 16, gap: 12, paddingTop: 56 },
  h: { color: "#fff", fontSize: 22, fontWeight: "700" }, t: { color: "#cbd5e1" }, big: { color: "#fff", fontSize: 48, fontWeight: "800", textAlign: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, half: { flex: 1 },
  btn: { backgroundColor: "#334155", padding: 18, borderRadius: 12, alignItems: "center" }, bt: { color: "#fff", fontSize: 18, fontWeight: "600" },
  go: { backgroundColor: "#0369a1" }, safe: { backgroundColor: "#16a34a", padding: 28 }, bigBt: { color: "#fff", fontSize: 28, fontWeight: "800" },
  back: { position: "absolute", top: 48, left: 16 }, snap: { position: "absolute", bottom: 32, alignSelf: "center" },
  chip: { backgroundColor: "#1e293b", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 }, chipOn: { backgroundColor: "#0369a1" },
  input: { backgroundColor: "#1e293b", color: "#fff", minHeight: 100, borderRadius: 8, padding: 12, textAlignVertical: "top" },
  bar: { height: 12, backgroundColor: "#1e293b", borderRadius: 6, overflow: "hidden" }, barFill: { height: 12 },
  sosTrack: { height: 64, width: 324, backgroundColor: "#450a0a", borderRadius: 32, justifyContent: "center", alignSelf: "center", marginTop: "auto" },
  sosKnob: { position: "absolute", width: 64, height: 64, borderRadius: 32, backgroundColor: "#dc2626" }, sosTxt: { color: "#fecaca", textAlign: "center", fontWeight: "700" },
});
