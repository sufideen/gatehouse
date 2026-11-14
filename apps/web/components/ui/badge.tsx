import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      green: "bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-500/40",
      amber: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40",
      red: "bg-red-600/25 text-red-300 ring-1 ring-red-500/50",
      neutral: "bg-slate-700 text-slate-200",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
