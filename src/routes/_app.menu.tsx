import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, LayoutGrid, Lock } from "lucide-react";
import { PageHeader } from "@/components/system/page-header";
import { mobileMenuSections } from "@/lib/navigation";
import { isUnrestrictedPath } from "@/lib/access";
import { useAccess } from "@/hooks/use-access";

export const Route = createFileRoute("/_app/menu")({
  head: () => ({
    meta: [
      { title: "Menu — RESQORA" },
      {
        name: "description",
        content:
          "Every RESQORA feature in one place: emergency tools, your safety records, nearby services and account settings.",
      },
      { property: "og:title", content: "RESQORA menu" },
      {
        property: "og:description",
        content: "Emergency tools, safety records, nearby services and account settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const access = useAccess();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutGrid}
        title="Menu"
        description="Everything RESQORA can do, grouped by what you need."
      />

      {mobileMenuSections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </h2>
          <ul className="overflow-hidden rounded-3xl border border-border bg-card">
            {section.items.map((item) => {
              const locked = !access.approved && !isUnrestrictedPath(item.to);
              const inner = (
                <>
                  <item.icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  {locked ? (
                    <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </>
              );

              return (
                <li key={item.to} className="border-b border-border/60 last:border-b-0">
                  {locked ? (
                    <span
                      aria-disabled="true"
                      title={`${item.label} — awaiting administrator approval`}
                      className="flex min-h-14 cursor-not-allowed items-center gap-3 px-4 py-3 opacity-60"
                    >
                      {inner}
                    </span>
                  ) : (
                    <Link
                      to={item.to}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
