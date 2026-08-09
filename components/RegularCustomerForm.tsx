"use client";

import { useState } from "react";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AddressSelect, EMPTY_ADDRESS, type AddressValue } from "@/components/AddressSelect";

/**
 * Add Regular Customer.
 *
 * A different act from adding a lead, and deliberately a different form: there
 * is no product, quantity, price or pipeline status here, because nothing is
 * being sold yet — this records a person the agent keeps. Saving creates a
 * customer record only, so it can never appear in the Leads list.
 *
 * Phone number is required (unlike on a lead, which may be saved before one is
 * known): it is the identity every customer record is matched and de-duplicated
 * on. See components/LeadForm.tsx for the other form.
 */
export function RegularCustomerForm({
  action,
  agents,
  currentUser,
  canReassign,
}: {
  action: (formData: FormData) => void | Promise<void>;
  agents: { id: string; full_name: string; username: string }[];
  currentUser: { id: string; full_name: string; username: string };
  /** Team Leads and Administrators may file a customer under one of their
   * agents; an agent only ever adds their own. */
  canReassign: boolean;
}) {
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [values, setValues] = useState({ full_name: "", phone: "", purok: "", landmark: "" });
  const [showProblems, setShowProblems] = useState(false);

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const problems = [
    !values.full_name.trim() && { field: "full_name", label: "Customer Name" },
    !values.phone.trim() && { field: "phone", label: "Phone Number" },
  ].filter(Boolean) as { field: string; label: string }[];

  const problemFor = (field: string) =>
    showProblems && problems.some((p) => p.field === field) ? "This field is required." : undefined;

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
      <Alert kind="info">
        This adds a regular customer only — it does not create a lead or an order. Their orders stay out of your Leads
        list.
      </Alert>

      {showProblems && problems.length > 0 && (
        <Alert kind="error">Missing required fields: {problems.map((p) => p.label).join(", ")}.</Alert>
      )}

      <div>
        <Label htmlFor="full_name">Customer Name</Label>
        <Input
          id="full_name"
          name="full_name"
          value={values.full_name}
          onChange={(e) => set("full_name", e.target.value)}
          required
        />
        {problemFor("full_name") && <p className="mt-1 text-xs text-red-600">{problemFor("full_name")}</p>}
      </div>

      <div>
        <Label htmlFor="phone">Phone Number</Label>
        <Input
          id="phone"
          name="phone"
          inputMode="tel"
          placeholder="09171234567"
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          required
        />
        <p className="mt-1 text-xs text-slate-400">
          Used to match this customer to their orders, so it cannot be left blank.
        </p>
        {problemFor("phone") && <p className="mt-1 text-xs text-red-600">{problemFor("phone")}</p>}
      </div>

      <div>
        <Label htmlFor="purok">Address / Purok</Label>
        <Input id="purok" name="purok" value={values.purok} onChange={(e) => set("purok", e.target.value)} />
      </div>

      {/* Same Pancake-sourced picker the lead form uses, so an address recorded
          here is one Pancake recognises when this customer does order. */}
      <AddressSelect value={address} onChange={setAddress} />

      <div>
        <Label htmlFor="landmark">Landmark</Label>
        <Input id="landmark" name="landmark" value={values.landmark} onChange={(e) => set("landmark", e.target.value)} />
      </div>

      <div>
        <Label htmlFor="customer_status">Status</Label>
        <Select id="customer_status" name="customer_status" defaultValue="active">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>

      <div>
        <Label htmlFor="agent_id">Assigned Agent</Label>
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
        <p className="mt-1 text-xs text-slate-400">Whose regular customer this is.</p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <LinkButton href="/regular-customers" variant="outline">
          Cancel
        </LinkButton>
        <Button type="submit">Save Regular Customer</Button>
      </div>
    </form>
  );
}
