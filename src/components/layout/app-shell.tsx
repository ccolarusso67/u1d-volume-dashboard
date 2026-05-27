/**
 * src/components/layout/app-shell.tsx
 *
 * PR 005B — Optional page wrapper used to keep all top-level pages
 * visually consistent. Wraps: HeroHeader (passed as `hero`) + Nav
 * (passed as `nav`) + content slot.
 *
 * Many existing pages compose the hero and nav inline; this helper is
 * for new pages or future cleanup. Adopting it on every page right now
 * would balloon the PR.
 */
export function AppShell({
  hero,
  nav,
  children,
  contentClassName = "container mx-auto px-8 py-8 max-w-7xl space-y-6",
}: {
  hero: React.ReactNode;
  nav: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <main className="min-h-screen bg-gray-50">
      {hero}
      {nav}
      <div className={contentClassName}>{children}</div>
    </main>
  );
}
