# Android development build (Expo dev client)

Why not Expo Go: the app uses `react-native-nfc-manager` (NFC), which Expo Go does not include. A **development build** is your own copy of the app with the dev tools inside; it loads the JavaScript live from your laptop.

**What was verified (in the authoring environment, no Android SDK or phone):** the native Android project generates (`expo prebuild`) with the right permissions, package id (`uk.gatehouse.guard`), the `gatehouse://` deep link, and cleartext HTTP only in dev builds; the JavaScript bundles with Metro for Android (about 640 modules); typecheck and unit tests pass. **Not verified:** the Gradle compile, installing on a phone, or any hardware feature (GPS, camera, NFC). Expect a first-run snag or two.

Toolchain the project needs (from the generated project): JDK 17, Android SDK platform 35, build-tools 35.0.0, NDK 26.1.10909125, minSdk 24, Gradle 8.10.2 (downloaded by the wrapper).

> **Data warning:** you are tethering. The first local build downloads roughly 1.5-3 GB (SDK, Gradle, dependencies). Do it on Wi-Fi/ethernet if you can, or use Route B (cloud build, ~100 MB APK).

## 0. Prepare the phone
1. Settings > About phone > tap **Build number** 7 times > Developer options > enable **USB debugging**.
2. Connect it to the laptop by USB. When it asks, tap **Allow** (trust this computer).

## Route A: build on your Ubuntu laptop
```bash
# JDK + adb
sudo apt install -y openjdk-17-jdk unzip adb
# Android command-line tools: download "Command line tools only" for Linux from
# https://developer.android.com/studio#command-line-tools-only  then:
mkdir -p ~/Android/Sdk/cmdline-tools && unzip ~/Downloads/commandlinetools-linux-*.zip -d ~/Android/Sdk/cmdline-tools
mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
cat >> ~/.bashrc <<'RC'
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
RC
source ~/.bashrc
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;26.1.10909125"

adb devices            # your phone should be listed as "device" (not "unauthorized")
```
Build and install (from the repo root, with the web app running on port 4000):
```bash
cd apps/mobile
# USB route: the phone reaches your laptop through the cable, no Wi-Fi/LAN needed
adb reverse tcp:8081 tcp:8081     # Metro (JavaScript)
adb reverse tcp:4000 tcp:4000     # Gatehouse web API
export EXPO_PUBLIC_API_URL=http://localhost:4000
export GATEHOUSE_DEV_CLEARTEXT=1  # allow http:// in this dev build only
pnpm prebuild                     # generates android/ (git-ignored)
pnpm android                      # compiles, installs on the phone, starts Metro. First build ~10-20 min
```
If you change `GATEHOUSE_DEV_CLEARTEXT` or the plugins later, run `pnpm prebuild -- --clean` again. After the first install, day-to-day you only need `pnpm start` (and `adb reverse` again after re-plugging the cable).

## Route B: cloud build with EAS (no Android SDK on your laptop)
Needs a free Expo account.
```bash
sudo npm i -g eas-cli && eas login
cd apps/mobile
# edit eas.json: set EXPO_PUBLIC_API_URL under build.development.env to your laptop's address, e.g. http://192.168.232.61:4000
eas build --profile development --platform android     # prints a link/QR to the APK; open it on the phone and install
pnpm start                                             # then open the app on the phone and pick your laptop's Metro
```
Here the phone reaches the laptop over the network (not USB), so: laptop and phone on the same network (your hotspot is fine), and `sudo ufw allow 4000/tcp && sudo ufw allow 8081/tcp` if the firewall is on.

## Try it
1. Web app (signed in as admin): Roster > assign **Fatima Khan** (green) a shift.
2. On the phone: sign in as `fatima.khan@thamesshield.example` / `demo-password-1`. Your shift appears on **My shift**.
3. **Geofence:** you are not standing at Canary Wharf, so clock-in will correctly say how far you are. To test for real, move the site to where you are (get your coordinates from Google Maps):
   ```bash
   docker compose exec db psql -U gatehouse gatehouse -c \
     "UPDATE sites SET centre = ST_SetSRID(ST_MakePoint(<LNG>, <LAT>), 4326)::geography WHERE name = 'Canary Wharf Tower Lobby';"
   ```
4. Clock in (front-camera selfie), scan a checkpoint. QR: generate one for a tag id such as `GH-1-100` (`sudo apt install qrencode; qrencode -t ansi GH-1-100`). NFC: any NFC sticker works, its UID is matched against checkpoint tag ids (the seed tags are strings like `GH-1-100`, so an NFC sticker will show as an "unrecognised tag" unless you add its UID as a checkpoint).
5. Pull the phone off the network (airplane mode), scan again, reconnect: queued records sync. Check the web Dashboard and Audit trail.
6. **My data** tab: try withdrawing consent, export, and delete.

## Troubleshooting
- `adb devices` shows `unauthorized`: unlock the phone, accept the prompt (or revoke USB debugging authorisations and replug).
- `SDK location not found`: `echo $ANDROID_HOME` must point at `~/Android/Sdk` in the same terminal.
- `Failed to install NDK` / licence errors: re-run the `sdkmanager` line and `yes | sdkmanager --licenses`.
- App opens but "No connection": check `adb reverse --list`, that the web app is up on 4000, and that you built with `EXPO_PUBLIC_API_URL` set (it is baked into the JavaScript at bundle time; restart Metro with `pnpm start -- --clear` after changing it).
- Cleartext/`Network request failed` on http URLs: you built without `GATEHOUSE_DEV_CLEARTEXT=1`; re-run prebuild with `--clean`.
- Dev menu: shake the phone, or `adb shell input keyevent 82`.

## Known limits (be aware when testing)
- Selfie/incident/SOS photos and audio are recorded and queued on the phone, but **uploading them to storage is not built** (no S3 endpoint yet); the server stores only their keys.
- SOS text message needs `EXPO_PUBLIC_CONTROL_ROOM_MOBILE` set, and opens the phone's SMS composer rather than sending silently.
- Sync runs while the app is open; there is no background sync service yet.
- NFC and the camera/GPS flow have only been typechecked and bundled, never run on hardware.
