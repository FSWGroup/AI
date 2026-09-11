import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  onCopy: () => Promise<boolean>;
  primary?: boolean;
  title?: string;
}

/** Button that performs a clipboard copy and briefly confirms success. */
export function CopyButton({ label, onCopy, primary, title }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const handle = async () => {
    const ok = await onCopy();
    setState(ok ? 'done' : 'fail');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={handle} title={title}>
      {state === 'done' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}
    </button>
  );
}
