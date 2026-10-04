import { useEffect, useState } from "react";
import umakLogo from "../imports/UMak Logo.png";
import { AdminUser } from "../utils/api";

interface HeaderProps {
  breadcrumb: string[];
  title: string;
  notifCount: number;
  onNotifClick: () => void;
  onProfileClick: () => void;
  user: AdminUser;
  onLogout: () => void;
}

export default function Header({ breadcrumb, title, notifCount, onNotifClick, onProfileClick, user, onLogout }: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    document.title = "E-Balik Admin";
    let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = umakLogo;
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = () => setProfileOpen(false);
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [profileOpen]);

  return (
    <header className="print-hide sticky top-0 z-20 flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur-sm sm:px-6">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] font-medium text-ink-muted">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-slate-300"><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              <span className={i === breadcrumb.length - 1 ? "text-ink-soft" : ""} aria-current={i === breadcrumb.length - 1 ? "page" : undefined}>{b}</span>
            </span>
          ))}
        </nav>
        <p className="mt-0.5 truncate font-[family-name:var(--font-heading)] text-[18px] font-semibold leading-tight text-ink">{title}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Notifications */}
        <button type="button" onClick={onNotifClick} aria-label={notifCount > 0 ? `Notifications, ${notifCount} unread` : "Notifications"} className="group relative flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-navy-50">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" className="text-slate-500 group-hover:text-slate-700 transition-colors">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          {notifCount > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[12px] font-bold text-white ring-2 ring-white" aria-hidden="true">{notifCount}</span>
          )}
        </button>

        {/* Profile dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            onClick={(e) => { e.stopPropagation(); setProfileOpen(open => !open); }}
            className="flex items-center gap-2 rounded-xl p-1.5 text-left transition-colors hover:bg-navy-50"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-navy-800 text-[13px] font-bold text-white">{user.fname[0]}{user.lname[0]}</div>
            <div className="text-sm hidden sm:block">
              <div className="whitespace-nowrap text-[14px] font-semibold text-ink">{user.fname} {user.lname}</div>
              <div className="text-[12px] font-medium text-ink-muted">{user.access_level === "super_admin" ? "Super Admin" : "Admin"}</div>
            </div>
            <svg className={`ml-0.5 h-3.5 w-3.5 text-slate-400 transition-transform hidden sm:block ${profileOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-line bg-white shadow-raised" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-line px-4 py-3">
                <div className="text-[14px] font-semibold text-ink">{user.fname} {user.lname}</div>
                <div className="mt-0.5 text-[12px] text-ink-muted">{user.access_level === "super_admin" ? "Super Admin" : "Admin"}</div>
              </div>
              {
                [
                  { label: "Profile & security", action: onProfileClick },
                ].map(item => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      item.action();
                    }}
                    className="block w-full px-4 py-2.5 text-left text-[14px] font-medium text-ink-soft transition-colors hover:bg-navy-50"
                  >
                    {item.label}
                  </button>
                ))
              }
              <div className="border-t border-line" />
              <button type="button" role="menuitem" onClick={onLogout} className="block w-full px-4 py-2.5 text-left text-[14px] font-medium text-rose-700 transition-colors hover:bg-rose-50">
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
