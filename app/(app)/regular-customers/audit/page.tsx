import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { MIN_DELIVERED_ORDERS } from "@/lib/reg-cx-validation";
import { RegCxAuditClient } from "@/components/RegCxAuditClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every existing regular customer, measured against the REG CX rules.
 *
 * The rules arrived after the records did. 2,678 customers were tagged under no
 * rule at all, and the question "how many of them would the rule keep" has no
 * answer in this database — the evidence is in Pancake, one lookup per number.
 *
 * Administrator only, and read-only by construction: the sweep it runs writes
 * an audit entry per customer and changes nothing else. Deleting on the result
 * is a separate decision, made by a person, after reading it.
 */
export default async function RegCxAuditPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!isFullAccess(user.role) || !can(user.role, "regular_customers", "view", db.role_permissions)) {
    redirect("/regular-customers");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">Regular Customer Rule Check</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Measures every existing regular customer against the tagging rules — at least {MIN_DELIVERED_ORDERS}{" "}
            delivered orders in Pancake, and either the same Order Source or the same Caller. These records were
            created before the rules existed, so this is the only way to know which of them the rules would keep.
          </p>
        </div>
        <Link
          href="/regular-customers"
          className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          ← Regular Customers
        </Link>
      </div>

      <RegCxAuditClient />
    </div>
  );
}
