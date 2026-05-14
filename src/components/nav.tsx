import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/production", label: "Production" },
  { href: "/reconciliation", label: "Reconciliation" },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav className="bg-navy-deep border-b border-white/10">
      <div className="container mx-auto px-8 max-w-7xl">
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
    </nav>
  );
}
