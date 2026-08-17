import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { displayCallName } from "@/lib/types";
import { REGULAR_CUSTOMER_IMPORT_HEADERS } from "@/lib/validation";

/**
 * The blank workbook for a regular-customer upload.
 *
 * Behind the same grant as adding one by hand: the file is only useful to
 * somebody who may create the records, and `regular_customers.create` is a
 * separate permission from `orders.create` precisely because adding a regular
 * customer is not adding a lead.
 *
 * The sample row is filled with the downloader's own call name rather than a
 * made-up one. Unrecognized agent names are the commonest reason a lead import
 * comes back with rows rejected, and an agent uploading their own customers
 * should not have to guess which of their names the system wants.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    return NextResponse.json({ error: "You do not have permission to add regular customers." }, { status: 403 });
  }

  const sheet = XLSX.utils.aoa_to_sheet([
    REGULAR_CUSTOMER_IMPORT_HEADERS,
    [
      displayCallName(user),
      "Juan Dela Cruz",
      "0917-000-0000",
      "Purok 2",
      "Barangay Sample",
      "Manila",
      "Metro Manila",
      "Near the sari-sari store",
      "active",
    ],
  ]);
  // Without widths every column arrives at the default eight characters and the
  // addresses read as ####, which is the first thing a person fixes by hand.
  sheet["!cols"] = [
    { wch: 14 },
    { wch: 26 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 10 },
  ];

  // What each column means, in the file itself. A template whose rules live
  // only in somebody's chat history gets filled in wrong by the second person
  // who uses it.
  const guide = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "What to put"],
    ["Agent", "Yes", "The agent's Call Name (e.g. JEWEL) — whoever keeps this customer. An agent uploading their own list puts their own name in every row."],
    ["Customer Name", "Yes", "The person's full name."],
    ["Phone Number", "Yes", "Any format — 0917…, +63917… and 917… are all read as the same number. This is what a customer is matched on, so a row without one cannot be used."],
    ["Purok", "No", "Street, purok or house detail."],
    ["Barangay", "No", "Barangay name."],
    ["City", "No", "City or municipality."],
    ["Province", "No", "Province."],
    ["Landmark", "No", "Anything that helps the rider find it."],
    ["Status", "No", "active or inactive. Left blank means active."],
    [],
    ["Not columns here", "", "Product, quantity, price and order number are deliberately absent. A regular customer is a person, not a sale — no order is created by this upload, and their history builds from the orders raised for them afterwards."],
    ["Addresses and Pancake", "", "Pancake's own address IDs are not in this file. They come from the Select Address picker, and the agent chooses the address on the customer's first order."],
    ["Duplicates", "", "One record per person per agent. A row whose number the same agent already keeps is a duplicate and is not added twice."],
  ]);
  guide["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 110 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Regular Customers");
  XLSX.utils.book_append_sheet(wb, guide, "How to fill this in");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="regular-customers-import-template.xlsx"',
    },
  });
}
