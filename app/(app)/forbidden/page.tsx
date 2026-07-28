import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/Button";

/** Shown when a lead exists but belongs to someone else. Deliberately distinct
 * from "not found": the record is real, access is what was refused. It reveals
 * nothing about the record itself. */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <ShieldAlert className="h-10 w-10 text-red-500" />
      <h1 className="text-page-title text-slate-900">Access denied</h1>
      <p className="text-sm text-slate-500">
        {reason || "This record belongs to another agent. You can only open leads assigned to you."}
      </p>
      <LinkButton href="/leads">Back to my leads</LinkButton>
    </div>
  );
}
