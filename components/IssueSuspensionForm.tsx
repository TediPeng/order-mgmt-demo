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

  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="employee_id">Employee Name</Label>
        <Select id="employee_id" name="employee_id" defaultValue="" required>
          <option value="" disabled>
            Select employee
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </Select>
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
