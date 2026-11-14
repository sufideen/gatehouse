import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

export default function ClientPortal() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Site coverage</CardTitle>
        <Badge tone="green">Site Secured - Officer On Duty</Badge>
        <p className="mt-3 text-sm text-slate-400">SIA licence verified. Guard home addresses and personal details are never exposed to clients.</p>
      </Card>
      <Card><CardTitle>Patrol completion log</CardTitle><p className="text-sm text-slate-400">Scoped to the signed-in client&apos;s sites once auth is wired.</p></Card>
    </div>
  );
}
