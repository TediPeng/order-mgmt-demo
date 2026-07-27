import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { Alert } from "@/components/ui/Alert";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <Image src="/brand-logo.png" alt="4S RETENTION" width={140} height={99} className="h-20 w-auto object-contain" priority unoptimized />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">4S RETENTION</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          <LoginForm />
          <div className="mt-5 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            <p className="font-medium text-slate-600">Demo accounts</p>
            <p>admin / admin123</p>
            <p>manager / manager123</p>
            <p>employee / employee123</p>
          </div>
        </div>
      </div>
    </div>
  );
}
