import Image from "next/image";
import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { requestPasswordResetAction } from "@/lib/actions/auth";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <Image src="/brand-logo.png" alt="4S ROMA" width={140} height={99} className="h-16 w-auto object-contain" unoptimized priority />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Reset your password</h1>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* The confirmation deliberately says nothing about whether the
              address matched an account — the answer is the same either way,
              so this screen cannot be used to find out who has a login here. */}
          {sent ? (
            <Alert kind="success">
              If an account exists for that email, a password reset link has been sent. The link expires in an hour and
              works once. If it does not arrive, check your spam folder or ask an Administrator to reset your password
              from User Management.
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
