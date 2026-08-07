import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { LoginAside } from "@/components/LoginAside";
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-[var(--brand-primary-10)] p-4">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Decorative half. Dropped entirely below md rather than stacked --
            on a phone it would push the form below the fold, and the form is
            the only thing anyone came here to use. */}
        <div className="relative hidden w-1/2 overflow-hidden border-r border-slate-100 bg-gradient-to-br from-amber-50 to-[var(--brand-primary-10)] md:block">
          <LoginAside />
          <div className="relative z-10 flex h-full flex-col items-center justify-center p-10 text-center">
            <Image
              src="/brand-logo.png"
              alt=""
              width={340}
              height={241}
              className="h-36 w-auto object-contain"
              unoptimized
              priority
            />
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-[var(--brand-primary)]">4S ROMA</h2>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Retention Order Management Application</p>
          </div>
        </div>

        <div className="flex w-full flex-col justify-center p-8 md:w-1/2 md:p-10">
          {/* The logo repeats here only where the panel beside it is hidden,
              so the small screen still opens on the brand rather than a bare
              form, and the large one does not show it twice. */}
          <div className="mb-6 flex flex-col items-center md:hidden">
            <Image
              src="/brand-logo.png"
              alt="4S ROMA"
              width={240}
              height={170}
              className="h-24 w-auto object-contain"
              unoptimized
              priority
            />
            <h1 className="mt-3 text-lg font-bold tracking-tight text-[var(--brand-primary)]">4S ROMA</h1>
          </div>

          <div className="mb-6 hidden md:block">
            <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
          </div>

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

          <div className="mt-6 flex flex-col items-center gap-1 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">Version {APP_VERSION}</p>
            <UpdateLogsPanel releases={releases} />
          </div>
        </div>
      </div>
    </div>
  );
}
