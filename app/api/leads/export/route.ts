import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeOrders } from "@/lib/order-access";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { buildBrandedCsv } from "@/lib/csv";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LEAD_STATUS_LABELS } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = readDb();
  if (!can(user.role, "orders", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").toLowerCase();
  const status = searchParams.get("status") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";

  const usernameByAgentId = new Map(db.profiles.map((p) => [p.id, p.username.toLowerCase()]));

  // Scope is always applied server-side first — never trust a client-provided agent filter here.
  let orders = scopeOrders(user, db.orders, db);
  if (q) {
    orders = orders.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.toLowerCase().includes(q) ||
        (usernameByAgentId.get(o.agent_id) || "").includes(q)
    );
  }
  if (status) orders = orders.filter((o) => o.status === status);
  if (dateFrom) orders = orders.filter((o) => (o.order_date || "") >= dateFrom);
  if (dateTo) orders = orders.filter((o) => (o.order_date || "") <= dateTo);
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const header = [
    "Order Number",
    "Order Date",
    "Agent",
    "Customer Name",
    "Phone Number",
    "Purok",
    "Barangay",
    "City",
    "Province",
    "Landmark",
    "Previous Order Date",
    "Previous Order Product",
    "Previous Order Amount",
    "New Product Order",
    "Unit Price",
    "Total",
    "Status",
  ];
  const rows = orders.map((o) => [
    o.order_number,
    o.order_date ? formatDate(o.order_date) : "",
    byId.get(o.agent_id) || "",
    o.customer_name,
    o.customer_phone,
    o.purok,
    o.barangay,
    o.city,
    o.province,
    o.landmark,
    o.previous_order_date ? formatDate(o.previous_order_date) : "",
    o.previous_order_product || "",
    o.previous_order_amount != null ? formatCurrency(o.previous_order_amount) : "",
    o.product_name || "",
    o.unit_price != null ? formatCurrency(o.unit_price) : "",
    formatCurrency(o.total_amount),
    LEAD_STATUS_LABELS[o.status],
  ]);
  const csv = buildBrandedCsv("Leads Export", header, rows);

  const info = await getRequestInfo();
  logActivity(db, user.id, "REPORT_EXPORTED", "order", null, { count: orders.length }, { module: "orders", ...info });
  writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-export-${Date.now()}.csv"`,
    },
  });
}
