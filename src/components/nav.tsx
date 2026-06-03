import Link from "next/link";

type NavItem = {
  href: string;
  label: string;
  /** Active when the current path equals href OR starts with any of these prefixes. */
  matchPrefixes: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/",                label: "Overview",       matchPrefixes: ["/"] },
  { href: "/customers",       label: "Customers",      matchPrefixes: ["/customers"] },
  { href: "/products",        label: "Products",       matchPrefixes: ["/products"] },
  { href: "/production",      label: "Production",     matchPrefixes: ["/production"] },
  { href: "/reconciliation",  label: "Reconciliation", matchPrefixes: ["/reconciliation"] },
  { href: "/board",           label: "Board",          matchPrefixes: ["/board"] },
  { href: "/admin",           label: "Admin",          matchPrefixes: ["/admin"] },
];

/**
 * Determines whether a nav item should be marked active for a given `current`
 * path. We treat "/" as an exact-match-only segment so /production doesn't
 * also light up Overview. All other entries match on prefix so deep pages
 * under /admin/* and /board/* keep the right top-level tab lit.
 */
function isActive(current: string, item: NavItem): boolean {
  for (const prefix of item.matchPrefixes) {
    if (prefix === "/") {
      if (current === "/") return true;
      continue;
    }
    if (current === prefix) return true;
    if (current.startsWith(prefix + "/")) return true;
  }
  return false;
}

export function Nav({ current }: { current: string }) {
  return (
    <nav
      className="bg-navy-deep border-b border-white/10"
      aria-label="Primary"
    >
      <div className="container mx-auto px-4 sm:px-8 max-w-7xl">
        {/* Horizontal scroll on narrow screens; flex row on desktop. */}
        <ul
          className="flex gap-1 overflow-x-auto no-scrollbar"
          role="menubar"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(current, item);
            return (
              <li key={item.href} role="none" className="shrink-0">
                <Link
                  href={item.href}
                  role="menuitem"
                  aria-current={active ? "page" : undefined}
                  className={[
                    "group relative inline-flex items-center",
                    "px-4 sm:px-5 py-3.5",
                    "text-sm font-medium tracking-wide whitespace-nowrap",
                    "border-b-2 transition-colors duration-150",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0",
                    active
                      ? "text-white border-[#E1261C] bg-white/[0.04]"
                      : "text-white/70 hover:text-white border-transparent hover:bg-white/[0.04]",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
