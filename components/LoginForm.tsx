"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { loginAction } from "@/lib/actions/auth";

export function LoginForm() {
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={loginAction}
      onSubmit={() => setPending(true)}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" name="username" autoComplete="username" placeholder="e.g. admin" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <a href="/forgot-password" className="text-[var(--brand-primary)] hover:underline">
          Forgot Password?
        </a>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Log In"}
      </Button>
    </form>
  );
}
