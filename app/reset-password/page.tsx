import Image from "next/image";
import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { resetPasswordWithTokenAction } from "@/lib/actions/auth";
import { checkResetToken } from "@/lib/password-reset";

const INVALID_MESSAGE: Record<string, string> = {
  used: "That reset link has already been used. Request a new one to try again.",
  expired: "That reset link has expired. Request a new one to try again.",
  unknown: "That reset link is not valid. Request a new one to try again.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; invalid?: string }>;
}) {
  const { token, error, invalid } = await searchParams;

  // Checked on render as well as on submit, so a dead link says so instead of
  // presenting a form that was always going to be refused.
  const check = invalid ? { ok: false as const, reason: invalid } : await checkResetToken(token || "");
  const reason = check.ok ? null : (check as { reason: string }).reason;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <Image
            src="/brand-logo.png"
            alt="4S ROMA"
            width={140}
            height={99}
            className="h-16 w-auto object-contain"
            unoptimized
            priority
          />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Choose a new password</h1>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {reason ? (
            <>
              <Alert kind="error">{INVALID_MESSAGE[reason] || INVALID_MESSAGE.unknown}</Alert>
              <p className="mt-4 text-center text-sm">
                <a href="/forgot-password" className="text-[var(--brand-primary)] hover:underline">
                  Request a new link
                </a>
              </p>
            </>
          ) : (
            <>
              {error && (
                <Alert kind="error" className="mb-4">
                  {error}
                </Alert>
              )}
              <form action={resetPasswordWithTokenAction} className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <div>
                  <Label htmlFor="new_password">New password</Label>
                  <Input id="new_password" name="new_password" type="password" required minLength={8} autoComplete="new-password" />
                  <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
                </div>
                <div>
                  <Label htmlFor="confirm_password">Confirm new password</Label>
                  <Input
                    id="confirm_password"
                    name="confirm_password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full">
                  Set new password
                </Button>
              </form>
            </>
          )}
          <p className="mt-4 text-center text-sm">
            <a href="/login" className="text-[var(--brand-primary)] hover:underline">
              Back to login
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
