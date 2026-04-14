"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "chart" },
  { href: "/leads", label: "Leads", icon: "users" },
  { href: "/scrape", label: "Scrape", icon: "search" },
  { href: "/xray", label: "X-Ray Search", icon: "xray" },
  { href: "/pipeline", label: "Pipeline", icon: "flow" },
  { href: "/upload", label: "Upload", icon: "upload" },
  { href: "/instantly", label: "Instantly", icon: "send" },
];

function NavIcon({ icon }: { icon: string }) {
  const icons: Record<string, string> = {
    chart: "M3 13h2v8H3zm6-4h2v12H9zm6-6h2v18h-2z",
    users: "M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
    flow: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    upload: "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z",
    xray: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15H9V8h2v9zm4 0h-2V8h2v9z",
    send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d={icons[icon] || icons.chart} />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-[var(--border)] p-4 flex flex-col gap-1 shrink-0">
      <div className="mb-6">
        <h1 className="text-lg font-bold">Paradise Capital</h1>
        <p className="text-xs text-[var(--muted)]">Lead Intelligence</p>
      </div>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm no-underline transition-colors ${
              isActive
                ? "bg-[var(--accent)]/15 text-[var(--accent)] font-medium"
                : "text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card)]"
            }`}
          >
            <NavIcon icon={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
