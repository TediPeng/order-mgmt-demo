import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LeadImportClient } from "@/components/LeadImportClient";
import { LEAD_IMPORT_HEADERS, LEAD_IMPORT_FORBIDDEN_HEADERS } from "@/lib/validation";

// The import sends batches of 500, so no single request needs long — this is
// headroom for a slow connection, not the plan. 300s is the Pro ceiling.
export const maxDuration = 300;

export default async function LeadImportPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-page-title text-slate-900">Import Leads from Excel</h1>
      <Card className="mb-4">
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">1. Download the official template</p>
            {/* Listed from the constants the template and the parser share,
                so this can never describe a file the importer would reject. */}
            <p className="text-sm text-slate-500">
              Headers must match exactly: {LEAD_IMPORT_HEADERS.join(", ")}. The file must not contain{" "}
              {LEAD_IMPORT_FORBIDDEN_HEADERS.join(", ")} columns.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Around 1,000 rows per file imports comfortably. Split a bigger list into several files.
            </p>
          </div>
          <a
            href="/api/leads/template"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
          <LeadImportClient />
        </CardContent>
      </Card>
    </div>
  );
}
