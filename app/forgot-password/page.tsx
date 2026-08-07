import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AuthShell } from "@/components/AuthShell";
import { requestPasswordResetAction } from "@/lib/actions/auth";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sent ? undefined : "We will email you a link to choose a new one."}
    >
      {/* The confirmation deliberately says nothing about whether the address
          matched an account — the answer is the same either way, so this
          screen cannot be used to find out who has a login here. */}
      {sent ? (
        <Alert kind="success">
          If an account exists for that email, a password reset link has been sent. The link expires in an hour and
          works once. If it does not arrive, check your spam folder or ask an Administrator to reset your password from
          User Management.
        </Alert>
      ) : (
        <form action={requestPasswordResetAction} className="space-y-4">
          <div>
            <Label htmlFor="email">Email address</Label>
            <Input id="email" name="email" type="email" required placeholder="you@company.com" />
          </div>
          <Button type="submit" className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <a href="/login" className="text-[var(--brand-primary)] hover:underline">
          Back to login
        </a>
      </p>
    </AuthShell>
  );
}
