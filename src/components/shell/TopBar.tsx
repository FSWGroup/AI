'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, Search, LogOut, User as UserIcon, ShieldCheck } from 'lucide-react';
import { cx } from '@/components/ui';

export function TopBar({
  userName,
  userEmail,
  workerId,
  unreadCount,
  signOutAction,
}: {
  userName: string;
  userEmail: string;
  workerId: string | null;
  unreadCount: number;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-ink-200/70 bg-white/90 pr-4 pl-14 backdrop-blur lg:pl-64">
      <form
        role="search"
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-300" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, tasks, documents…  (⌘K)"
          aria-label="Global search"
          className="h-9 w-full rounded-md border border-transparent bg-ink-100/70 pr-3 pl-9 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500"
        />
      </form>

      <div className="flex items-center gap-1.5">
        <Link
          href="/notifications"
          aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
          className="relative rounded-md p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        >
          <Bell size={18} />
          {unreadCount > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-white">
              {userName
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            <span className="hidden text-sm font-medium text-ink-800 sm:block">{userName}</span>
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute right-0 mt-1 w-56 rounded-md border border-ink-200 bg-white py-1 shadow-pop">
              <div className="border-b border-ink-100 px-3 py-2">
                <div className="text-sm font-medium text-ink-900">{userName}</div>
                <div className="truncate text-[12px] text-ink-400">{userEmail}</div>
              </div>
              {workerId ? (
                <Link
                  role="menuitem"
                  href={`/people/${workerId}`}
                  onClick={() => setMenuOpen(false)}
                  className={cx('flex items-center gap-2 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50')}
                >
                  <UserIcon size={15} /> My profile
                </Link>
              ) : null}
              <Link
                role="menuitem"
                href="/account/security"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
              >
                <ShieldCheck size={15} /> Security & sessions
              </Link>
              <form action={signOutAction}>
                <button role="menuitem" type="submit" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50">
                  <LogOut size={15} /> Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
