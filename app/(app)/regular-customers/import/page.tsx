import { Download } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { RegularCustomerImportClient } from "@/components/RegularCustomerImportClient";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { REGULAR_CUSTOMER_IMPORT_HEADERS } from "@/lib/validation";

// The import sends batches, so no single request needs long — this is headroom
// for a slow connection, not the plan. 300s is the Pro ceiling.
export const maxDuration = 300;

export default async function RegularCustomerImportPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "regular_customers", "view", db.role_permissions)) redirect("/dashboard");
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to add regular customers.</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-page-title text-slate-900">Import Regular Customers from Excel</h1>

      {/* Said before the file is chosen, not after it is written. Two things
          about this upload surprise people: the customers become the
          uploader's, and leads already held on those numbers leave the Leads
          list. Both are the same rules Add Regular Customer follows one at a
          time, but a file of five hundred makes them worth stating. */}
      <Alert kind="info" className="mb-4">
        Everything in the file becomes <strong>{user.full_name}&apos;s</strong> regular customers — there is no Agent
        column. Any lead you already hold on one of these numbers moves onto the customer record and leaves the active
        Leads list, exactly as it does when you add a regular customer by hand.
      </Alert>

      <Card className="mb-4">
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-800">1. Download the official template</p>
            {/* Listed from the constant the template and the parser share, so
                this can never describe a file the importer would reject. */}
            <p className="text-sm text-slate-500">
              Headers must match exactly: {REGULAR_CUSTOMER_IMPORT_HEADERS.join(", ")}.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Customer Name and Phone Number are required; the rest may be blank. No product, price or order
              columns — this adds people, not sales.
            </p>
          </div>
          <a
            href="/api/regular-customers/template"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download template
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload and preview</CardTitle>
        </CardHeader>
        <CardContent>
          <RegularCustomerImportClient />
        </CardContent>
      </Card>
    </div>
  );
}
