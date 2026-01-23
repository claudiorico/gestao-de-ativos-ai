import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Briefcase,
  Scale,
  ArrowLeftRight,
  Coins,
  Receipt,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const menuItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Portfólio", url: "/portfolio", icon: Briefcase },
  { title: "Balanceamento", url: "/balancing", icon: Scale },
  { title: "Movimentações", url: "/transactions", icon: ArrowLeftRight },
  { title: "Proventos", url: "/dividends", icon: Coins },
  { title: "Imposto de Renda", url: "/taxes", icon: Receipt },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar"
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
          <TrendingUp className="h-5 w-5 text-primary-foreground" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col"
            >
              <span className="text-lg font-bold text-foreground">InvestPro</span>
              <span className="text-xs text-muted-foreground">Gestão de Ativos</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {menuItems.map((item, index) => {
          const isActive = location.pathname === item.url;
          const Icon = item.icon;

          return (
            <NavLink
              key={item.url}
              to={item.url}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <motion.div
                initial={{ scale: 1 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-sidebar-foreground group-hover:bg-primary/10 group-hover:text-primary"
                )}
              >
                <Icon className="h-4 w-4" />
              </motion.div>
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2, delay: index * 0.02 }}
                  >
                    {item.title}
                  </motion.span>
                )}
              </AnimatePresence>
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute right-0 h-8 w-1 rounded-l-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span>Recolher</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
