import { Card, CardTitle } from "@/components/ui/card";

export default function AuditLogs() {
  return (
    <Card>
      <CardTitle>Immutable audit trail (read-only)</CardTitle>
      <p className="text-sm text-slate-400">Reads from <code>immutable_audit_logs</code>. Search/filter UI is pending the API read endpoint; there is deliberately no edit or delete control.</p>
    </Card>
  );
}
