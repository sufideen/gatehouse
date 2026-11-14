import { Card, CardTitle } from "@/components/ui/card";

export default function Forbidden() {
  return <Card><CardTitle>Not allowed</CardTitle><p className="text-sm text-slate-300">Your role does not have access to that page.</p></Card>;
}
