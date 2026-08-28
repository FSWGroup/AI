'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { saveSkillAction, saveWorkerSkillAction, removeWorkerSkillAction } from './actions';

const CATEGORIES = ['SAFETY', 'EQUIPMENT', 'PRODUCT', 'SYSTEM', 'LANGUAGE', 'LEADERSHIP', 'TRADE', 'OTHER'];
const LEVELS = [
  { value: 1, label: '1 · Aware' },
  { value: 2, label: '2 · Working' },
  { value: 3, label: '3 · Proficient' },
  { value: 4, label: '4 · Expert' },
  { value: 5, label: '5 · Can teach it' },
];

export interface SkillOption {
  id: string;
  name: string;
  isCertification: boolean;
  validityMonths: number | null;
}

export function AddSkillButton({ skill }: { skill?: {
  id: string; name: string; category: string; description: string | null;
  isCertification: boolean; isCritical: boolean; validityMonths: number | null; active: boolean;
} }) {
  const [open, setOpen] = useState(false);
  const [isCert, setIsCert] = useState(skill?.isCertification ?? false);
  return (
    <>
      <Button variant={skill ? 'ghost' : 'primary'} size={skill ? 'sm' : 'md'} onClick={() => setOpen(true)}>
        {skill ? 'Edit' : 'Add skill'}
      </Button>
      <Drawer title={skill ? `Edit ${skill.name}` : 'Add a skill'} open={open} onClose={() => setOpen(false)}>
        <ActionForm action={saveSkillAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          {skill ? <input type="hidden" name="skillId" value={skill.id} /> : null}
          <Field label="Name" htmlFor="sk-name" required>
            <Input id="sk-name" name="name" defaultValue={skill?.name} required placeholder="Forklift operation (sit-down)" />
          </Field>
          <Field label="Category" htmlFor="sk-cat">
            <Select id="sk-cat" name="category" defaultValue={skill?.category ?? 'EQUIPMENT'}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="sk-desc">
            <Textarea id="sk-desc" name="description" defaultValue={skill?.description ?? ''} rows={2} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox" name="isCertification" defaultChecked={skill?.isCertification}
              onChange={(e) => setIsCert(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300"
            />
            <span>
              This is a certification that expires
              <span className="block text-[12px] text-ink-500">Forklift, OSHA 30, CDL — anything with a renewal date.</span>
            </span>
          </label>
          {isCert ? (
            <Field label="Valid for (months)" htmlFor="sk-validity" hint="Used to set the renewal date automatically. Leave blank if it never expires.">
              <Input id="sk-validity" name="validityMonths" type="number" min={1} max={240} defaultValue={skill?.validityMonths ?? 36} />
            </Field>
          ) : null}
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" name="isCritical" defaultChecked={skill?.isCritical} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
            <span>
              Critical — work stops without it
              <span className="block text-[12px] text-ink-500">
                Only critical skills are reported as coverage risk, so that the word keeps meaning something.
              </span>
            </span>
          </label>
          {skill ? (
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" name="active" defaultChecked={skill.active} className="h-4 w-4 rounded border-ink-300" />
              Active
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

/** Record a skill against one worker. `canVerify` mirrors skills.admin. */
export function RecordSkillButton({
  workerId,
  skills,
  canVerify,
  label = 'Add skill',
}: {
  workerId: string;
  skills: SkillOption[];
  canVerify: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState(skills[0]?.id ?? '');
  const selected = skills.find((s) => s.id === skillId);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={skills.length === 0}>
        {label}
      </Button>
      <Drawer title="Record a skill" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={saveWorkerSkillAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="workerId" value={workerId} />
          <Field label="Skill" htmlFor="ws-skill" required>
            <Select id="ws-skill" name="skillId" value={skillId} onChange={(e) => setSkillId(e.target.value)} required>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Level" htmlFor="ws-level" required>
            <Select id="ws-level" name="level" defaultValue={3}>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </Select>
          </Field>
          <Field
            label={selected?.isCertification ? 'Certified on' : 'Acquired'}
            htmlFor="ws-acquired"
            hint={
              selected?.isCertification && selected.validityMonths
                ? `Renewal is set ${selected.validityMonths} months out unless you override it below.`
                : undefined
            }
          >
            <Input id="ws-acquired" name="acquiredAt" type="date" />
          </Field>
          {selected?.isCertification ? (
            <Field label="Expires" htmlFor="ws-expires" hint="Leave blank to calculate it from the certification date.">
              <Input id="ws-expires" name="expiresAt" type="date" />
            </Field>
          ) : null}
          <Field label="Note" htmlFor="ws-note">
            <Input id="ws-note" name="note" placeholder="Certificate number, awarding body…" />
          </Field>
          {canVerify ? (
            <label className="flex items-start gap-2 text-[13px] text-ink-700">
              <input type="checkbox" name="verified" className="mt-0.5 h-4 w-4 rounded border-ink-300" />
              <span>
                I have seen evidence of this
                <span className="block text-[12px] text-ink-500">
                  Critical skills only count toward coverage once somebody has verified them.
                </span>
              </span>
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Record</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function RemoveSkillButton({ workerSkillId }: { workerSkillId: string }) {
  return (
    <form action={removeWorkerSkillAction}>
      <input type="hidden" name="workerSkillId" value={workerSkillId} />
      <Button type="submit" variant="ghost" size="sm">Remove</Button>
    </form>
  );
}
