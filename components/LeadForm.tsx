"use client";

import { useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AddressSelect, EMPTY_ADDRESS, type AddressValue } from "@/components/AddressSelect";
import { OrderItemsEditor, type EditorLine } from "@/components/OrderItemsEditor";
import { AGENT_EDITABLE_STATUSES, LEAD_STATUS_LABELS, PACKAGING_STATUS } from "@/lib/validation";
import { packagingProblems } from "@/lib/lead-workflow";
import { blockImplicitSubmit } from "@/lib/form-keys";

interface ProductOption {
  id: string;
  name: string;
  code: string | null;
  selling_price: number | null;
  variants: string[] | null;
  pancake_variation_id: string | null;
}

/**
 * The lead form: a sale being worked, in the required field order — Customer
 * Name, Phone Number, Address/Purok, Province, City, Barangay, Landmark,
 * Product, Quantity, Unit Price, Status.
 *
 * Not to be confused with `RegularCustomerForm`, which adds a person to the
 * agent's Regular Customers and creates no order at all. This form was once
 * called RegularCustomerForm after the spec section it came from, which read
 * as though the two were the same act; they are not.
 *
 * The seven retired fields (previous-order trio, discount, shipping fee, courier,
 * payment method) are gone from the form. Shipping fee, payment method and courier
 * are still sent to Pancake — they come from the integration account's defaults at
 * forward time, so an agent never has to know them.
 *
 * Packaging validation runs here for immediate per-field feedback; the server
 * re-runs the identical check (lib/lead-workflow.ts) and is what actually decides.
 */
export interface RegularCustomerPrefill {
  id: string;
  full_name: string;
  phone: string;
  purok: string;
  landmark: string;
  address: AddressValue;
}

export function LeadForm({
  action,
  agents,
  activeProducts,
  currentUser,
  canReassign,
  agentStatuses = AGENT_EDITABLE_STATUSES as readonly string[],
  regularCustomer = null,
}: {
  action: (formData: FormData) => void | Promise<void>;
  agents: { id: string; full_name: string; username: string }[];
  activeProducts: ProductOption[];
  currentUser: { id: string; full_name: string; username: string };
  canReassign: boolean;
  agentStatuses?: readonly string[];
  /** Set when the order is being raised from a Regular Customer's record: the
   * customer's details start the form and `customer_id` rides along, so the
   * server can attach the order to that customer rather than re-deriving them
   * from the typed phone number. */
  regularCustomer?: RegularCustomerPrefill | null;
}) {
  const [address, setAddress] = useState<AddressValue>(regularCustomer?.address ?? EMPTY_ADDRESS);
  const [values, setValues] = useState({
    customer_name: regularCustomer?.full_name ?? "",
    customer_phone: regularCustomer?.phone ?? "",
    purok: regularCustomer?.purok ?? "",
    landmark: regularCustomer?.landmark ?? "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    // `new` is the system's own starting point and is not agent-selectable
    // (Section 3), so a lead the agent is actively working starts at Ringing.
    status: "ringing",
  });
  const [showProblems, setShowProblems] = useState(false);
  // Mirrors the line editor, purely so the Packaging pre-check below can still
  // ask "is there a product, a quantity and a price" now that those live in
  // lines rather than in three fields on this form.
  const [lines, setLines] = useState<EditorLine[]>([]);

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const filled = lines.filter((line) => line.product_id);
  const lineSummary = {
    product_id: filled[0]?.product_id || null,
    quantity: filled.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    // The first priced line stands for the order: Packaging requires a price,
    // and one line without one is what the server will object to as well.
    unit_price: filled.length === 0 ? null : Number(filled.find((line) => line.unit_price !== "")?.unit_price ?? NaN),
  };

  // Only Packaging demands the full field set; every other status may be saved
  // with an incomplete lead, which is the whole point of the call pipeline.
  const problems =
    values.status === PACKAGING_STATUS
      ? packagingProblems({
          customer_name: values.customer_name,
          customer_phone: values.customer_phone,
          purok: values.purok,
          barangay: address.barangay,
          city: address.city,
          province: address.province,
          product_id: lineSummary.product_id,
          quantity: lineSummary.quantity,
          unit_price: Number.isNaN(lineSummary.unit_price as number) ? null : lineSummary.unit_price,
        })
      : [];
  const problemFor = (field: string) => (showProblems ? problems.find((p) => p.field === field)?.message : undefined);

  function FieldError({ field }: { field: string }) {
    const message = problemFor(field);
    if (!message) return null;
    return <p className="mt-1 text-xs text-red-600">{message}</p>;
  }

  return (
    <form
      action={action}
      onKeyDown={blockImplicitSubmit}
      onSubmit={(e) => {
        if (problems.length > 0) {
          e.preventDefault();
          setShowProblems(true);
        }
      }}
      className="space-y-4"
      noValidate
    >
      {showProblems && problems.length > 0 && (
        <Alert kind="error">
          Missing required fields for Packaging: {problems.map((p) => p.label).join(", ")}.
        </Alert>
      )}

      {regularCustomer && (
        <>
          <Alert kind="info">
            Order for regular customer <strong>{regularCustomer.full_name}</strong>. Their details are filled in below —
            edit anything that has changed. This order is recorded against their customer record and stays out of the
            Leads list.
          </Alert>
          <input type="hidden" name="customer_id" value={regularCustomer.id} />
        </>
      )}

      <div>
        <Label htmlFor="customer_name">Customer Name</Label>
        <Input
          id="customer_name"
          name="customer_name"
          value={values.customer_name}
          onChange={(e) => set("customer_name", e.target.value)}
          required
        />
        <FieldError field="customer_name" />
      </div>

      <div>
        <Label htmlFor="customer_phone">Phone Number</Label>
        <Input
          id="customer_phone"
          name="customer_phone"
          inputMode="tel"
          placeholder="09171234567"
          value={values.customer_phone}
          onChange={(e) => set("customer_phone", e.target.value)}
        />
        <FieldError field="customer_phone" />
      </div>

      <div>
        <Label htmlFor="purok">Address / Purok</Label>
        <Input id="purok" name="purok" value={values.purok} onChange={(e) => set("purok", e.target.value)} />
        <FieldError field="purok" />
      </div>

      {/* Province → City → Barangay, each unlocked by the one above. Emits PSGC
          codes as hidden inputs; the server rejects any mismatched combination. */}
      <AddressSelect
        value={address}
        onChange={setAddress}
        errors={{
          province: problemFor("province"),
          city: problemFor("city"),
          barangay: problemFor("barangay"),
        }}
      />

      <div>
        <Label htmlFor="landmark">Landmark</Label>
        <Input id="landmark" name="landmark" value={values.landmark} onChange={(e) => set("landmark", e.target.value)} />
        <p className="mt-1 text-xs text-slate-400">Sent to Pancake POS as the shipping notes.</p>
      </div>

      <div>
        <Label htmlFor="items">Products</Label>
        {/* No shipping fee on this form by design (Section 5) — it comes from
            the Pancake account's defaults at forward time. */}
        <OrderItemsEditor products={activeProducts} onLinesChange={setLines} />
        <FieldError field="product_id" />
        <FieldError field="quantity" />
        <FieldError field="unit_price" />
      </div>

      <div>
        <Label htmlFor="status">Status</Label>
        <Select id="status" name="status" value={values.status} onChange={(e) => set("status", e.target.value)}>
          {agentStatuses.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s as keyof typeof LEAD_STATUS_LABELS]}
            </option>
          ))}
        </Select>
        {values.status === PACKAGING_STATUS && (
          <p className="mt-1 text-xs text-slate-400">Saving with Packaging sends this order to Pancake POS.</p>
        )}
      </div>

      <div>
        <Label htmlFor="agent_id">Agent</Label>
        {canReassign ? (
          <Select id="agent_id" name="agent_id" defaultValue={currentUser.id}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name} ({a.username})
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Input value={`${currentUser.full_name} (${currentUser.username})`} disabled />
            <input type="hidden" name="agent_id" value={currentUser.id} />
          </>
        )}
        <p className="mt-1 text-xs text-slate-400">This determines whose performance metrics the sale counts toward.</p>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <LinkButton href={regularCustomer ? "/regular-customers" : "/leads"} variant="outline">
          Cancel
        </LinkButton>
        <Button type="submit">{regularCustomer ? "Save Order" : "Save Lead"}</Button>
      </div>
    </form>
  );
}
