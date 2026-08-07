import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { Alert } from "@/components/ui/Alert";
import { UpdateLogsPanel } from "@/components/UpdateLogsPanel";
import { listUpdateLogs } from "@/lib/update-logs";
import { APP_VERSION } from "@/lib/version";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const { error, reset } = await searchParams;
  const releases = await listUpdateLogs({ publishedOnly: true });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/brand-logo.png"
            alt="4S ROMA"
            width={140}
            height={99}
            className="h-20 w-auto object-contain"
            priority
            unoptimized
          />
          <h1 className="mt-3 text-xl font-bold tracking-tight text-[var(--brand-primary)]">4S ROMA</h1>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Retention Order Management Application
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          {reset && (
            <Alert kind="success" className="mb-4">
              Your password has been changed. Sign in with the new one.
            </Alert>
          )}
          <LoginForm />
          <div className="mt-5 flex flex-col items-center gap-1 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">Version {APP_VERSION}</p>
            <UpdateLogsPanel releases={releases} />
          </div>
        </div>
      </div>
    </div>
  );
}
