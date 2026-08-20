"use client";

import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AddressSelect, EMPTY_ADDRESS, type AddressValue } from "@/components/AddressSelect";
import { regularCustomerOwnersElsewhereAction, type RegularDuplicateCheck } from "@/lib/actions/regular-customers";

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

  /**
   * Warning before saving, when somebody else already keeps this number.
   *
   * Checked on submit rather than while typing: a check that fires on every
   * keystroke asks the database for every half-finished number, and turns the
   * field into a lookup for whether a number is taken.
   *
   * `confirmed` is what lets the second submit through. Without it the dialog
   * would raise itself again on the very submit it approved.
   */
  const [duplicate, setDuplicate] = useState<RegularDuplicateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const problems = [
    !values.full_name.trim() && { field: "full_name", label: "Customer Name" },
    !values.phone.trim() && { field: "phone", label: "Phone Number" },
  ].filter(Boolean) as { field: string; label: string }[];

  const problemFor = (field: string) =>
    showProblems && problems.some((p) => p.field === field) ? "This field is required." : undefined;

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(e) => {
        if (problems.length > 0) {
          e.preventDefault();
          setShowProblems(true);
          return;
        }
        if (confirmed.current) return;

        e.preventDefault();
        setChecking(true);
        const agentId = (formRef.current?.elements.namedItem("agent_id") as HTMLSelectElement | null)?.value;
        regularCustomerOwnersElsewhereAction(values.phone, agentId || undefined)
          .then((found) => {
            if (found.count === 0) {
              confirmed.current = true;
              formRef.current?.requestSubmit();
              return;
            }
            setDuplicate(found);
          })
          // A failed check must not block the save. The rule is a warning, and
          // an unreachable warning is not a reason to refuse somebody's work.
          .catch(() => {
            confirmed.current = true;
            formRef.current?.requestSubmit();
          })
          .finally(() => setChecking(false));
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
        <Button type="submit" disabled={checking}>
          {checking ? "Checking…" : "Save Regular Customer"}
        </Button>
      </div>

      {duplicate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDuplicate(null)}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">This number is already a regular customer</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {duplicate.count === 1
                    ? "Another agent already keeps this phone number as a regular customer."
                    : `${duplicate.count} other agents already keep this phone number as a regular customer.`}
                </p>
              </div>
            </div>

            {/* Names only for a Team Lead or Administrator. An Agent is told the
                number is taken and no more — see the server action for why. */}
            {duplicate.owners.length > 0 && (
              <ul className="divide-y divide-slate-100 border-b border-slate-100">
                {duplicate.owners.map((o, i) => (
                  <li key={i} className="px-5 py-2.5 text-sm">
                    <span className="font-medium text-slate-800">{o.customerName}</span>
                    <span className="text-slate-500"> — {o.agentName}</span>
                    {o.regularSince && (
                      <span className="block text-xs text-slate-400">Regular since {o.regularSince.slice(0, 10)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* This used to say "adding them is not blocked" and offer an Add
                anyway button, which was true while the rule was only a warning.
                The server refuses the save now — one number, one owner — so the
                button led to a dialog approving something the next screen
                rejected. A dead end that reads as approval is worse than no
                button, and the honest thing is to say what to do instead. */}
            <div className="px-5 py-4">
              <p className="text-xs text-slate-500">
                A number belongs to one agent, so this cannot be saved as a second record for the same person. Ask the
                owner to share the customer with you, or ask a Team Lead to reassign it.
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="button" size="sm" onClick={() => setDuplicate(null)}>
                  Back to the form
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
