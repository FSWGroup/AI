'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cx } from '@/components/ui';
import type { NavGroup } from '@/lib/nav';

function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
  return (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-3 pb-8">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label ? (
            <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
              {group.label}
            </div>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cx(
                    'block rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors',
                    isActive(item.href)
                      ? 'bg-brand-600/15 font-medium text-white'
                      : 'text-ink-300 hover:bg-white/5 hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 py-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-[13px] font-bold text-white">
        FSW
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-white">
        FSW <span className="text-brand-300">People</span>
      </span>
    </Link>
  );
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink-900 lg:flex">
        <Wordmark />
        <NavLinks groups={groups} />
      </aside>

      {/* Mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed top-3.5 left-3 z-40 rounded-md bg-ink-900 p-2 text-white lg:hidden"
      >
        <Menu size={18} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink-900">
            <div className="flex items-center justify-between pr-3">
              <Wordmark />
              <button onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded p-2 text-ink-300 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
