import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { importAction } from "@/app/actions";
import { ADMINS, requireRole } from "@/lib/auth";

const GUARDS = `First Name,Last Name,Email,Mobile,SIA Licence Number,Licence Expiry,Employment Type
Test,Expired,test.expired@demo.example,07700900901,1111 2222 3333 0001,01/01/2020,Full-Time
Test,Relief,test.relief@demo.example,07700900902,1111 2222 3333 0002,31/12/2030,Relief Bank
Real,Looking,someone@gmail.com,07911123456,1111 2222 3333 0003,31/12/2030,Full-Time`;
const SITES = `Site Name,Address,Postcode,Latitude,Longitude,Checkpoint Name,Tag UID
Demo Warehouse,1 Test Rd,N1 9GU,51.5322,-0.1058,Gate,GH-9001
Demo Warehouse,1 Test Rd,N1 9GU,51.5322,-0.1058,Gate again,GH-9001
Demo Warehouse,1 Test Rd,N1 9GU,51.5322,-0.1058,Dock,04:AA:BB:CC:DD`;

export default async function GuardhouseImport() {
  await requireRole(ADMINS);
  return (
    <Card>
      <CardTitle>Guardhouse 1-click migration (synthetic mode)</CardTitle>
      <p className="mb-3 text-sm text-slate-300">Paste CSV exports. Preview flags expired SIA badges and duplicate tag UIDs. Commit only accepts reserved test email domains, so the "Real Looking" row is refused: real data needs the consent-gated pilot path.</p>
      <ActionForm action={importAction} className="space-y-3">
        <textarea name="guardsCsv" defaultValue={GUARDS} rows={5} className={`${inputCls} w-full font-mono text-xs`} />
        <textarea name="sitesCsv" defaultValue={SITES} rows={5} className={`${inputCls} w-full font-mono text-xs`} />
        <div className="flex gap-2">
          <button name="intent" value="preview" className={btnCls}>Preview</button>
          <button name="intent" value="commit" className={`${btnCls} bg-emerald-600 hover:bg-emerald-500`}>Commit (synthetic)</button>
        </div>
      </ActionForm>
    </Card>
  );
}
