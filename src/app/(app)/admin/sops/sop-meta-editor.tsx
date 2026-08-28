"use client";

import type { SopMeta } from "@/lib/content/types";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { SectionHeading } from "@/components/page-header";

function updateAt<T>(arr: T[], index: number, value: T): T[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}
function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export function SopMetaEditor({ value, onChange }: { value: SopMeta; onChange: (next: SopMeta) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Field label="Purpose" htmlFor="meta-purpose" hint="Why this procedure exists.">
        <Textarea id="meta-purpose" rows={2} value={value.purpose} onChange={(e) => onChange({ ...value, purpose: e.target.value })} />
      </Field>
      <Field label="Scope" htmlFor="meta-scope" hint="Who and what this applies to.">
        <Textarea id="meta-scope" rows={2} value={value.scope} onChange={(e) => onChange({ ...value, scope: e.target.value })} />
      </Field>

      <div>
        <SectionHeading title="Definitions" level={3} />
        <div className="flex flex-col gap-2">
          {value.definitions.map((def, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Term ${index + 1}`}
                placeholder="Term"
                value={def.term}
                onChange={(e) => onChange({ ...value, definitions: updateAt(value.definitions, index, { ...def, term: e.target.value }) })}
                className="w-40"
              />
              <Input
                aria-label={`Definition ${index + 1}`}
                placeholder="Definition"
                value={def.definition}
                onChange={(e) => onChange({ ...value, definitions: updateAt(value.definitions, index, { ...def, definition: e.target.value }) })}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove definition ${index + 1}`} onClick={() => onChange({ ...value, definitions: removeAt(value.definitions, index) })}>
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange({ ...value, definitions: [...value.definitions, { term: "", definition: "" }] })}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add definition
        </Button>
      </div>

      <StringListEditor
        title="Prerequisites"
        items={value.prerequisites}
        onChange={(items) => onChange({ ...value, prerequisites: items })}
        addLabel="Add prerequisite"
      />

      <StringListEditor
        title="Required tools"
        items={value.requiredTools}
        onChange={(items) => onChange({ ...value, requiredTools: items })}
        addLabel="Add tool"
      />

      <Field label="Safety considerations" htmlFor="meta-safety">
        <Textarea id="meta-safety" rows={3} value={value.safetyConsiderations} onChange={(e) => onChange({ ...value, safetyConsiderations: e.target.value })} />
      </Field>

      <div>
        <SectionHeading title="Troubleshooting" level={3} />
        <div className="flex flex-col gap-2">
          {value.troubleshooting.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Problem ${index + 1}`}
                placeholder="Problem"
                value={row.problem}
                onChange={(e) => onChange({ ...value, troubleshooting: updateAt(value.troubleshooting, index, { ...row, problem: e.target.value }) })}
                className="w-48"
              />
              <Input
                aria-label={`Resolution ${index + 1}`}
                placeholder="Resolution"
                value={row.resolution}
                onChange={(e) => onChange({ ...value, troubleshooting: updateAt(value.troubleshooting, index, { ...row, resolution: e.target.value }) })}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} onClick={() => onChange({ ...value, troubleshooting: removeAt(value.troubleshooting, index) })}>
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange({ ...value, troubleshooting: [...value.troubleshooting, { problem: "", resolution: "" }] })}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add row
        </Button>
      </div>

      <Field label="Exceptions" htmlFor="meta-exceptions" hint="Cases where this SOP does not apply.">
        <Textarea id="meta-exceptions" rows={2} value={value.exceptions} onChange={(e) => onChange({ ...value, exceptions: e.target.value })} />
      </Field>

      <div>
        <SectionHeading title="External links" level={3} />
        <div className="flex flex-col gap-2">
          {value.externalLinks.map((link, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Link label ${index + 1}`}
                placeholder="Label"
                value={link.label}
                onChange={(e) => onChange({ ...value, externalLinks: updateAt(value.externalLinks, index, { ...link, label: e.target.value }) })}
                className="w-40"
              />
              <Input
                aria-label={`Link URL ${index + 1}`}
                placeholder="https://…"
                value={link.url}
                onChange={(e) => onChange({ ...value, externalLinks: updateAt(value.externalLinks, index, { ...link, url: e.target.value }) })}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove link ${index + 1}`} onClick={() => onChange({ ...value, externalLinks: removeAt(value.externalLinks, index) })}>
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange({ ...value, externalLinks: [...value.externalLinks, { label: "", url: "" }] })}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add link
        </Button>
      </div>
    </div>
  );
}

function StringListEditor({
  title,
  items,
  onChange,
  addLabel,
}: {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
}) {
  return (
    <div>
      <SectionHeading title={title} level={3} />
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${title} ${index + 1}`}
              value={item}
              onChange={(e) => onChange(updateAt(items, index, e.target.value))}
            />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title.toLowerCase()} ${index + 1}`} onClick={() => onChange(removeAt(items, index))}>
              <Glyph name="trash" className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange([...items, ""])}>
        <Glyph name="plus" className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}
