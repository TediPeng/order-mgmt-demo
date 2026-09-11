/**
 * The strip that says this browser tab is driving the live database.
 *
 * Shown whenever the app is served from somebody's own machine while
 * SUPABASE_URL names production — which, since the development project was
 * deleted on 12 September 2026 and deliberately not replaced, is every local
 * run. See lib/production-guard.ts.
 *
 * Deliberately ugly, deliberately not dismissible, deliberately at the very
 * top. localhost:3000 and the live site are identical on screen and the orders
 * on both are the same orders; the only other thing that distinguishes them is
 * the address bar, which is exactly where nobody is looking while editing an
 * order. It never renders on Vercel, so no agent ever sees it.
 *
 * Presentational and prop-free so it can sit in both trees: the app shell is a
 * client component and receives the answer as a prop from its layout, while the
 * login page is a server component and asks the guard directly.
 */
export function LiveDatabaseBanner() {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-center gap-2 bg-red-600 px-3 py-1.5 text-center text-[13px] font-semibold text-white"
    >
      <span aria-hidden>⚠</span>
      <span>
        LOCALHOST → <span className="underline">LIVE DATABASE</span> · every change here is a real
        change to the floor&apos;s orders
      </span>
    </div>
  );
}
