"use client";

import { useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AddressSelect, EMPTY_ADDRESS, type AddressValue } from "@/components/AddressSelect";
import { ProductCombobox } from "@/components/ProductCombobox";
import { AGENT_EDITABLE_STATUSES, LEAD_STATUS_LABELS, PACKAGING_STATUS } from "@/lib/validation";
import { packagingProblems } from "@/lib/lead-workflow";

interface ProductOption {
  id: string;
  name: string;
  code: string | null;
}

/**
 * Section 5: the Regular Customer order form, in the exact required field order —
 * Customer Name, Phone Number, Address/Purok, Province, City, Barangay, Landmark,
 * Product, Quantity, Unit Price, Status.
 *
 * The seven retired fields (previous-order trio, discount, shipping fee, courier,
 * payment method) are gone from the form. Shipping fee, payment method and courier
 * are still sent to Pancake — they come from the integration account's defaults at
 * forward time, so an agent never has to know them.
 *
 * Packaging validation runs here for immediate per-field feedback; the server
 * re-runs the identical check (lib/lead-workflow.ts) and is what actually decides.
 */
export function RegularCustomerForm({
  action,
  agents,
  activeProducts,
  currentUser,
  canReassign,
  agentStatuses = AGENT_EDITABLE_STATUSES as readonly string[],
}: {
  action: (formData: FormData) => void | Promise<void>;
  agents: { id: string; full_name: string; username: string }[];
  activeProducts: ProductOption[];
  currentUser: { id: string; full_name: string; username: string };
  canReassign: boolean;
  agentStatuses?: readonly string[];
}) {
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [values, setValues] = useState({
    customer_name: "",
    customer_phone: "",
    purok: "",
    landmark: "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    // `new` is the system's own starting point and is not agent-selectable
    // (Section 3), so a lead the agent is actively working starts at Ringing.
    status: "ringing",
  });
  const [showProblems, setShowProblems] = useState(false);

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

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
          product_id: values.product_id || null,
          quantity: Number(values.quantity) || 0,
          unit_price: values.unit_price === "" ? null : Number(values.unit_price),
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
        <Label htmlFor="product_id">Product</Label>
        <ProductCombobox
          name="product_id"
          products={activeProducts}
          onChange={(id) => set("product_id", id)}
        />
        <FieldError field="product_id" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            step={1}
            value={values.quantity}
            onChange={(e) => set("quantity", e.target.value)}
          />
          <FieldError field="quantity" />
        </div>
        <div>
          <Label htmlFor="unit_price">Unit Price</Label>
          <Input
            id="unit_price"
            name="unit_price"
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={values.unit_price}
            onChange={(e) => set("unit_price", e.target.value)}
          />
          <FieldError field="unit_price" />
        </div>
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
        <LinkButton href="/leads" variant="outline">
          Cancel
        </LinkButton>
        <Button type="submit">Save Lead</Button>
      </div>
    </form>
  );
}
