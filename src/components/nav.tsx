import Image from "next/image";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/production", label: "Production" },
  { href: "/reconciliation", label: "Reconciliation" },
  { href: "/admin", label: "Admin" },
  { href: "/board", label: "Board" },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav className="bg-navy-deep border-b border-white/10">
      <div className="container mx-auto px-8 max-w-7xl">
        <div className="flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 py-2">
            <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
              <Image
                src="/u1d-logo.png"
                alt="U1Dynamics"
                width={150}
                height={44}
                priority
                className="h-9 w-auto"
              />
            </span>
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-white/70 md:inline">
              Monthly Board Report
            </span>
          </Link>

          <ul className="flex gap-1">
            {NAV_ITEMS.map((item) => {
              const isCurrent = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      isCurrent
                        ? "inline-block px-4 py-3 text-sm font-medium text-white border-b-2 border-[#E1261C]"
                        : "inline-block px-4 py-3 text-sm font-medium text-white/70 hover:text-white border-b-2 border-transparent"
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
