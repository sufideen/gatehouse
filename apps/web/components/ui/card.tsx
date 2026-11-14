import { cn } from "@/lib/utils";
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("rounded-lg border border-slate-700 bg-slate-900 p-4", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) =>
  <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400", className)} {...p} />;
