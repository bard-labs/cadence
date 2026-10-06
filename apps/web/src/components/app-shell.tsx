import Link from "next/link";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/upload", label: "Upload" },
  { href: "/groups", label: "Groups" },
];

export function AppShell({ children, username }: { children: React.ReactNode; username?: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">BardLabs</span>
            <span className="text-lg font-semibold tracking-tight">Cadence</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-zinc-400">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-white transition-colors">
                {l.label}
              </Link>
            ))}
            {username ? <span className="text-zinc-500">@{username}</span> : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
