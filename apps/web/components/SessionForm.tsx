"use client";

/** DEV-ONLY identity / channel / state switcher. Submits on change; the server action stores cookies. */
export function SessionForm({ action, users, userKey, channel, state, internal }: { action: (fd: FormData) => Promise<void>; users: { value: string; label: string }[]; userKey: string; channel: string; state: string; internal: boolean }) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-[12px]" onChange={(e) => e.currentTarget.requestSubmit()}>
      <span className="rounded bg-amber-100 px-1.5 py-[1px] font-semibold text-amber-900" title="Development-only cookie auth (wpi_user). No password. Not for production.">DEV AUTH</span>
      <label className="flex items-center gap-1">User
        <select name="user" defaultValue={userKey}>{users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
      </label>
      <label className="flex items-center gap-1">Channel
        <select name="channel" defaultValue={channel} disabled={!internal} title={internal ? "" : "Public and customer users are always in the ValveMan channel"}>
          <option value="welsford">welsford</option>
          <option value="valveman">valveman</option>
        </select>
      </label>
      <label className="flex items-center gap-1">State
        <input type="text" name="state" defaultValue={state} maxLength={2} placeholder="PA" className="mono w-12 uppercase" />
      </label>
      <button className="btn small secondary" type="submit">Apply</button>
    </form>
  );
}
