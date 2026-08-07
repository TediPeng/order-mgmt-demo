import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { AuthShell } from "@/components/AuthShell";
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
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your account"
      footer={
        <>
          <p className="text-xs text-slate-400">Version {APP_VERSION}</p>
          <UpdateLogsPanel releases={releases} />
        </>
      }
    >
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
    </AuthShell>
  );
}
