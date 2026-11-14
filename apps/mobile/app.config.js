// Wraps app.json. Plain-HTTP (cleartext) traffic is allowed ONLY for development builds so the phone can talk to a laptop on your LAN.
// Production builds keep Android's default of HTTPS only.
module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  if (process.env.GATEHOUSE_DEV_CLEARTEXT === "1") {
    plugins.push(["expo-build-properties", { android: { usesCleartextTraffic: true } }]);
  }
  return { ...config, plugins };
};
