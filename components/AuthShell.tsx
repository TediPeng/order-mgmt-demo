import Image from "next/image";
import { LoginAside } from "./LoginAside";

/** The signed-out surface: login, forgot-password and reset-password.
 *
 * One component rather than the same split card written three times, because
 * these pages are one flow -- a visitor moves between them by clicking, and a
 * layout that changes underneath them mid-flow reads as having landed
 * somewhere else. Keeping the panel identical is the point.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Optional block under the form, above the card edge. Only the login page
   * uses it, for the version number and release notes. */
  footer?: React.ReactNode;
}) {
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
              so a small screen still opens on the brand rather than a bare
              form, and a large one does not show it twice. */}
          <div className="mb-6 flex justify-center md:hidden">
            <Image
              src="/brand-logo.png"
              alt="4S ROMA"
              width={240}
              height={170}
              className="h-24 w-auto object-contain"
              unoptimized
              priority
            />
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>

          {children}

          {footer && (
            <div className="mt-6 flex flex-col items-center gap-1 border-t border-slate-100 pt-4">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
