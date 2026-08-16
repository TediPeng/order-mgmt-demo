"use client";

import { useMemo, useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

function addDaysToYmd(ymd: string, days: number): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function IssueSuspensionForm({
  action,
  employees,
  today,
}: {
  action: (formData: FormData) => void;
  employees: { id: string; full_name: string }[];
  today: string;
}) {
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState("3");
  const endDate = useMemo(() => addDaysToYmd(startDate, Number(duration) - 1), [startDate, duration]);

  /**
   * Narrowing the list, not replacing the control.
   *
   * The floor is long enough that finding a name meant scrolling a dropdown,
   * and suspension is not something to pick by scrolling past. The select
   * itself stays exactly what it was -- a native control the form submits and
   * the keyboard already knows -- and this only decides which options are in
   * it.
   */
  const [query, setQuery] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? employees.filter((e) => e.full_name.toLowerCase().includes(q)) : employees;
    // Whoever is chosen stays in the list whatever is typed. Filtering them out
    // would drop the option the select holds its value in, and the choice would
    // vanish without anybody touching it.
    if (employeeId && !matches.some((e) => e.id === employeeId)) {
      const chosen = employees.find((e) => e.id === employeeId);
      if (chosen) return [chosen, ...matches];
    }
    return matches;
  }, [employees, query, employeeId]);

  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="employee_id">Employee Name</Label>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee"
          aria-label="Search the employee list"
          aria-controls="employee_id"
          className="mb-1.5"
        />
        <Select
          id="employee_id"
          name="employee_id"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
        >
          <option value="" disabled>
            {visible.length === 0 ? "No employee matches that search" : "Select employee"}
          </option>
          {visible.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </Select>
        {query.trim() !== "" && (
          <p className="mt-1 text-xs text-slate-500">
            {visible.length} of {employees.length} shown
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="start_date">Start Date</Label>
        <Input id="start_date" name="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="duration_days">Suspension Duration</Label>
        <Select id="duration_days" name="duration_days" value={duration} onChange={(e) => setDuration(e.target.value)}>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="15">15 days</option>
        </Select>
      </div>
      <div>
        <Label>End Date (auto-computed)</Label>
        <Input value={endDate} disabled />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="reason">Reason for Suspension</Label>
        <Textarea id="reason" name="reason" rows={2} required placeholder="Required" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea id="remarks" name="remarks" rows={2} placeholder="Optional" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="danger">
          Issue Suspension
        </Button>
      </div>
    </form>
  );
}
