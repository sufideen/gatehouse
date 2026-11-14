import { Card, CardTitle } from "@/components/ui/card";

export default function GuardhouseImport() {
  return (
    <Card>
      <CardTitle>Guardhouse 1-click migration</CardTitle>
      <p className="text-sm text-slate-300">Upload Guards and Sites &amp; Checkpoints CSVs. Preview flags expired SIA badges; existing QR/NFC tag UIDs are kept so wall tags keep working.</p>
      <p className="mt-2 text-xs text-slate-500">Backend: POST /import/guardhouse/preview and /commit (implemented). Upload UI pending.</p>
    </Card>
  );
}
