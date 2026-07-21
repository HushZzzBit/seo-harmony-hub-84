import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BarChart3, FileText, Tags, Upload, Wand2 } from "lucide-react";
import logoAsset from "@/assets/seo-ggsel-logo.png.asset.json";

const nav = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/meta", label: "Meta Tags", icon: Tags },
  { to: "/texts", label: "SEO Texts", icon: FileText },
  { to: "/prompts", label: "AI Промты", icon: Wand2 },
  { to: "/import", label: "Import / Export", icon: Upload },
];


export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-foreground flex gap-4 p-4">
      <aside className="glass rounded-3xl w-60 p-3 flex flex-col gap-1 sticky top-4 h-[calc(100vh-2rem)] shrink-0">
        <div className="px-3 py-4 mb-2 flex items-center gap-2.5">
          <div className="size-9 rounded-xl overflow-hidden bg-white shadow-md grid place-items-center">
            <img src={logoAsset.url} alt="SEO GGSEL" className="size-full object-contain" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">SEO GGSEL</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Studio
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-sidebar-foreground/80 hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5 transition-all"
              activeProps={{
                className:
                  "bg-white/60 dark:bg-white/10 text-foreground font-medium shadow-[0_1px_0_oklch(1_0_0/0.7)_inset,0_6px_20px_-10px_oklch(0.2_0.05_260/0.35)]",
              }}
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden pr-2">{children}</main>
    </div>
  );
}
