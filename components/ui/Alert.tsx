import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

type Kind = "error" | "success" | "info";

const styles: Record<Kind, string> = {
  error: "bg-red-50 text-red-700 border-red-200",
  success: "bg-green-50 text-green-700 border-green-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
};

const icons: Record<Kind, React.ElementType> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export function Alert({ kind = "info", children, className }: { kind?: Kind; children: React.ReactNode; className?: string }) {
  const Icon = icons[kind];
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", styles[kind], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
