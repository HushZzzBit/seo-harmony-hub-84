import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BarChart3, FileText, Tags, Upload } from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/meta", label: "Meta Tags", icon: Tags },
  { to: "/texts", label: "SEO Texts", icon: FileText },
  { to: "/import", label: "Import / Export", icon: Upload },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-56 border-r border-border bg-sidebar p-4 flex flex-col gap-1 sticky top-0 h-screen">
        <div className="px-2 py-3 mb-2">
          <div className="text-lg font-semibold">SEO Analytics</div>
          <div className="text-xs text-muted-foreground">MVP</div>
        </div>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent transition"
            activeProps={{ className: "bg-sidebar-accent font-medium" }}
          >
            <n.icon className="size-4" />
            {n.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 min-w-0 p-6 overflow-x-hidden">{children}</main>
    </div>
  );
}
