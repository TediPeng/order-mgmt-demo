"use client";

import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { EmployeePicker } from "@/components/ui/EmployeePicker";
import { Button } from "@/components/ui/Button";
import { DISCIPLINARY_TYPE_LABELS } from "@/lib/disciplinary-types";

/**
 * Recording a warning.
 *
 * Suspension is absent from the list on purpose. It has its own form below,
 * which blocks the days as well as recording them, and offering it twice would
 * let somebody file the paperwork without stopping the shifts.
 */
const RECORDABLE = ["verbal_warning", "written_warning", "final_warning", "termination"] as const;

export function RecordDisciplinaryForm({
  action,
  employees,
  today,
}: {
  action: (formData: FormData) => void;
  employees: { id: string; full_name: string }[];
  today: string;
}) {
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="d_employee_id">Employee Name</Label>
        <EmployeePicker id="d_employee_id" name="employee_id" options={employees} required />
      </div>
      <div>
        <Label htmlFor="action_date">Date of Action</Label>
        <Input id="action_date" name="action_date" type="date" defaultValue={today} max={today} required />
      </div>
      <div>
        <Label htmlFor="action_type">Action Type</Label>
        <Select id="action_type" name="action_type" defaultValue="verbal_warning">
          {RECORDABLE.map((type) => (
            <option key={type} value={type}>
              {DISCIPLINARY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="offense">Offense</Label>
        <Input id="offense" name="offense" required placeholder="Required — e.g. Repeated tardiness" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="details">Details</Label>
        <Textarea
          id="details"
          name="details"
          rows={3}
          placeholder="What happened, in full. This is the part that matters if the record is ever questioned."
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit">Record Action</Button>
      </div>
    </form>
  );
}
