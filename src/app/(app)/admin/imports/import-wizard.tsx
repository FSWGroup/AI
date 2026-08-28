'use client';

import { useActionState, useState } from 'react';
import { Badge, Button, Field, FormError, FormSuccess, Select, Table, THead, TH, TRow, TD } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { validateImportAction, runImportAction, type ImportState } from './actions';

interface KindSpec {
  key: string;
  label: string;
  required: string[];
  optional: string[];
}

export function ImportWizard({ kinds }: { kinds: KindSpec[] }) {
  const [kind, setKind] = useState(kinds[0]?.key ?? 'WORKERS');
  const [fileText, setFileText] = useState<string>('');
  const [validateState, validateAction] = useActionState<ImportState | void, FormData>(validateImportAction, undefined);
  const [runState, runAction] = useActionState<ImportState | void, FormData>(runImportAction, undefined);

  const spec = kinds.find((k) => k.key === kind);
  const preview = validateState && 'preview' in validateState ? validateState.preview : undefined;
  const done = runState && 'success' in runState ? runState.success : undefined;

  return (
    <div className="space-y-5">
      {/* Step 1 — choose type & upload */}
      <form action={validateAction} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="What are you importing?" htmlFor="im-kind">
            <Select id="im-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CSV file" htmlFor="im-file" required>
            <input
              id="im-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setFileText(f ? await f.text() : '');
              }}
              className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
            />
          </Field>
        </div>
        {spec ? (
          <div className="rounded-md bg-ink-50 px-3.5 py-3 text-[12.5px]">
            <div className="mb-1 font-medium text-ink-700">Columns for {spec.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {spec.required.map((c) => (
                <Badge key={c} tone="blue">{c} *</Badge>
              ))}
              {spec.optional.map((c) => (
                <Badge key={c} tone="gray">{c}</Badge>
              ))}
            </div>
          </div>
        ) : null}
        <SubmitButton variant="secondary" pendingLabel="Validating…">
          Validate file
        </SubmitButton>
      </form>

      <FormError message={validateState && 'error' in validateState ? validateState.error : undefined} />

      {/* Step 2 — preview */}
      {preview && !done ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Badge tone="green">{preview.validCount} valid</Badge>
            {preview.errorCount > 0 ? <Badge tone="red">{preview.errorCount} with errors</Badge> : null}
            <span className="text-ink-500">Rows with errors are skipped; everything else imports.</span>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border border-ink-200">
            <Table>
              <THead>
                <TH>Row</TH>
                {preview.headers.map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
                <TH>Validation</TH>
              </THead>
              <tbody>
                {preview.rows.slice(0, 50).map((r) => (
                  <TRow key={r.rowNumber} className={r.errors.length ? 'bg-danger-100/30' : ''}>
                    <TD className="text-[12px] text-ink-400">{r.rowNumber}</TD>
                    {preview.headers.map((h) => (
                      <TD key={h} className="max-w-40 truncate text-[12.5px]">
                        {r.values[h] || '—'}
                      </TD>
                    ))}
                    <TD className="text-[12px]">
                      {r.errors.length ? (
                        <span className="text-danger-500">{r.errors.join('; ')}</span>
                      ) : (
                        <span className="text-ok-500">ready</span>
                      )}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </div>
          {preview.rows.length > 50 ? (
            <p className="text-[12px] text-ink-400">Showing the first 50 of {preview.rows.length} rows.</p>
          ) : null}

          {/* Step 3 — confirm */}
          {preview.validCount > 0 ? (
            <form action={runAction}>
              <input type="hidden" name="jobId" value={validateState && 'jobId' in validateState ? (validateState.jobId ?? '') : ''} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="payload" value={fileText} />
              <SubmitButton pendingLabel="Importing…">Import {preview.validCount} rows</SubmitButton>
            </form>
          ) : (
            <p className="text-[13px] text-danger-500">Nothing can be imported until the errors above are fixed.</p>
          )}
        </div>
      ) : null}

      <FormSuccess message={done} />
      <FormError message={runState && 'error' in runState ? runState.error : undefined} />
      {done ? (
        <Button variant="secondary" onClick={() => location.reload()}>
          Start another import
        </Button>
      ) : null}
    </div>
  );
}
