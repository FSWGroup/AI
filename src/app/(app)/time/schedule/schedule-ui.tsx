'use client';

import { useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { saveShiftAction, assignShiftAction, unassignShiftAction, deleteShiftAction, publishWeekAction } from './actions';

export interface Option { value: string; label: string }

export function NewShiftButton({
  date,
  locations,
  departments,
}: {
  date: string;
  locations: Option[];
  departments: Option[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>+ Shift</Button>
      <Drawer title={`New shift — ${date}`} open={open} onClose={() => setOpen(false)}>
        <ActionForm action={saveShiftAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="date" value={date} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="sh-start" required>
              <Input id="sh-start" name="startTime" type="time" defaultValue="06:00" required />
            </Field>
            <Field label="Ends" htmlFor="sh-end" required hint="An earlier end time means overnight.">
              <Input id="sh-end" name="endTime" type="time" defaultValue="14:30" required />
            </Field>
          </div>
          <Field label="Unpaid break (minutes)" htmlFor="sh-break">
            <Input id="sh-break" name="breakMinutes" type="number" min={0} max={240} defaultValue={30} />
          </Field>
          <Field label="Location" htmlFor="sh-loc">
            <Select id="sh-loc" name="locationId" defaultValue={locations[0]?.value ?? ''}>
              <option value="">Unassigned</option>
              {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
          </Field>
          <Field label="Department" htmlFor="sh-dept">
            <Select id="sh-dept" name="departmentId" defaultValue="">
              <option value="">Any</option>
              {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </Select>
          </Field>
          <Field label="Role" htmlFor="sh-role" hint="What this shift is for — Picker, Driver, Counter Sales.">
            <Input id="sh-role" name="role" placeholder="Picker" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Add shift</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function AssignButton({ shiftId, workers }: { shiftId: string; workers: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Assign</Button>
      <Drawer title="Assign someone" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={assignShiftAction} className="space-y-3">
          <input type="hidden" name="shiftId" value={shiftId} />
          <Field label="Person" htmlFor="as-worker" required>
            <Select id="as-worker" name="workerId" required>
              {workers.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
          </Field>
          <p className="text-[12px] text-ink-500">
            An overlapping shift the same day is refused. Overtime is flagged, not blocked — sometimes it is the right
            call, and the schedule is where you decide that.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            <SubmitButton>Assign</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function UnassignButton({ assignmentId }: { assignmentId: string }) {
  return (
    <form action={unassignShiftAction} className="inline">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button type="submit" className="text-[11px] text-ink-400 hover:text-danger-500" aria-label="Remove from shift">
        ×
      </button>
    </form>
  );
}

export function DeleteShiftButton({ shiftId, published }: { shiftId: string; published: boolean }) {
  return (
    <form action={deleteShiftAction} className="inline">
      <input type="hidden" name="shiftId" value={shiftId} />
      <Button type="submit" variant="ghost" size="sm">{published ? 'Cancel' : 'Delete'}</Button>
    </form>
  );
}

export function PublishWeekButton({ weekStart, draftCount }: { weekStart: string; draftCount: number }) {
  return (
    <ActionForm action={publishWeekAction} className="inline">
      <input type="hidden" name="weekStart" value={weekStart} />
      <SubmitButton variant="primary" size="sm" disabled={draftCount === 0}>
        Publish {draftCount} draft shift{draftCount === 1 ? '' : 's'}
      </SubmitButton>
    </ActionForm>
  );
}
