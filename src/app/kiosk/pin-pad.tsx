'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { kioskPunchAction, type PunchState } from './actions';

const PIN_LENGTH = 4;

/**
 * Big-target PIN pad. Designed for a gloved hand at 6am, so: no small text,
 * no dropdowns, and the result clears itself so the next person does not see
 * the previous person's name.
 */
export function PinPad({ deviceName }: { deviceName: string }) {
  const [state, formAction] = useActionState<PunchState | void, FormData>(kioskPunchAction, undefined);
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [pin, setPin] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the pad a few seconds after any result, so a shared screen never
  // holds someone's name or an error in front of the next person.
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => {
      setEmployeeNumber('');
      setPin('');
      formRef.current?.reset();
    }, 6000);
    return () => clearTimeout(timer);
  }, [state]);

  const press = (digit: string) => {
    if (pin.length < PIN_LENGTH) setPin(pin + digit);
  };

  return (
    <div>
      <h1 className="text-center text-lg font-semibold text-ink-900">Clock in or out</h1>
      <p className="mt-1 mb-4 text-center text-[12px] text-ink-500">{deviceName}</p>

      {state && 'error' in state && state.error ? (
        <div role="alert" className="mb-4 rounded-md border border-danger-100 bg-danger-100/60 px-4 py-3 text-center text-sm text-danger-500">
          {state.error}
        </div>
      ) : null}
      {state && 'success' in state && state.success ? (
        <div role="status" className="mb-4 rounded-md border border-ok-100 bg-ok-100/60 px-4 py-3 text-center text-sm font-medium text-ok-500">
          {state.success}
        </div>
      ) : null}

      <form ref={formRef} action={formAction}>
        <label className="mb-1 block text-[13px] font-medium text-ink-700" htmlFor="kiosk-emp">
          Employee number
        </label>
        <input
          id="kiosk-emp"
          name="employeeNumber"
          value={employeeNumber}
          onChange={(e) => setEmployeeNumber(e.target.value.toUpperCase())}
          autoComplete="off"
          inputMode="text"
          placeholder="FSW-0001"
          className="mb-4 h-14 w-full rounded-md border border-ink-300 px-4 text-center text-xl tracking-wider text-ink-900 uppercase"
        />

        <div className="mb-2 text-center text-[13px] font-medium text-ink-700">PIN</div>
        <div className="mb-4 flex justify-center gap-3" aria-hidden>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-ink-300'}`}
            />
          ))}
        </div>
        <input type="hidden" name="pin" value={pin} />

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <PadButton key={d} onClick={() => press(d)}>{d}</PadButton>
          ))}
          <PadButton onClick={() => setPin('')} muted>Clear</PadButton>
          <PadButton onClick={() => press('0')}>0</PadButton>
          <PadButton onClick={() => setPin(pin.slice(0, -1))} muted>←</PadButton>
        </div>

        <SubmitPunch disabled={pin.length !== PIN_LENGTH || employeeNumber.length === 0} />
      </form>

      <p className="mt-4 text-center text-[11px] text-ink-400">
        This tablet can only record time. It cannot show pay, personal details or anyone&rsquo;s record.
      </p>
    </div>
  );
}

function PadButton({ children, onClick, muted }: { children: React.ReactNode; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-16 rounded-md border text-xl font-medium transition active:scale-95 ${
        muted ? 'border-ink-200 bg-ink-50 text-ink-600' : 'border-ink-200 bg-white text-ink-900 hover:bg-ink-50'
      }`}
    >
      {children}
    </button>
  );
}

function SubmitPunch({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-4 h-16 w-full rounded-md bg-brand-600 text-lg font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
    >
      {pending ? 'Recording…' : 'Punch'}
    </button>
  );
}
