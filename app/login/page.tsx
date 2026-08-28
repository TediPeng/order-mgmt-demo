import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
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
  // Lite: this page needs one boolean out of app_settings, and it is the one
  // page every signed-out request lands on.
  const { operations } = await readDbLite();
  const portalOnly = operations.agent_login_via_portal_only;

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
      {/* Said before the attempt, not after it. An agent who does not know the
          rule would otherwise type a password that is still correct, be refused,
          and read that as a broken account rather than a moved door. The form
          stays below it: this page is still how Administrators and Team Leads
          sign in, and the notice is addressed to agents rather than replacing
          everyone's way in. */}
      {portalOnly && (
        <Alert kind="info" className="mb-4">
          <span className="font-medium">Agents: please log in using your 4S Portal account.</span>{" "}
          Open the portal, sign in there, and use the ROMA link — you do not need a password here any more. Team Leads
          and Administrators still sign in below.
        </Alert>
      )}
      <LoginForm />
    </AuthShell>
  );
}
