import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, FileText, Tags, Upload, Wand2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import logoAsset from "@/assets/seo-ggsel-logo.png.asset.json";

const nav = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/meta", label: "Meta Tags", icon: Tags },
  { to: "/texts", label: "SEO Texts", icon: FileText },
  { to: "/prompts", label: "Настройки", icon: Wand2 },
  { to: "/import", label: "Import / Export", icon: Upload },
];

const STORAGE_KEY = "seo-ggsel-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw != null) setCollapsed(raw === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="min-h-screen text-foreground flex gap-4 p-4">
      <aside
        className={`glass rounded-3xl p-3 flex flex-col gap-1 sticky top-4 h-[calc(100vh-2rem)] shrink-0 transition-[width] duration-200 ease-out ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className={`px-1.5 py-3 mb-1 flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
          <div className="size-9 rounded-xl overflow-hidden bg-white shadow-md grid place-items-center shrink-0">
            <img src={logoAsset.url} alt="SEO GGSEL" className="size-full object-contain" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">SEO GGSEL</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Studio
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          className={`mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5 transition ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Свернуть</span>}
        </button>

        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              title={collapsed ? n.label : undefined}
              className={`group relative flex items-center gap-3 rounded-xl text-sm text-sidebar-foreground/80 hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5 transition-all ${
                collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
              }`}
              activeProps={{
                className:
                  "bg-white/60 dark:bg-white/10 text-foreground font-medium shadow-[0_1px_0_oklch(1_0_0/0.7)_inset,0_6px_20px_-10px_oklch(0.2_0.05_260/0.35)]",
              }}
            >
              <n.icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden pr-2">{children}</main>
    </div>
  );
}
