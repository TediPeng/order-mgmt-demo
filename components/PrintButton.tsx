"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Section 8: print button producing a print-optimized monthly schedule via
 * the browser's print dialog and the @media print rules in globals.css (a
 * pragmatic substitute for a full PDF-rendering pipeline). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print
    </Button>
  );
}
