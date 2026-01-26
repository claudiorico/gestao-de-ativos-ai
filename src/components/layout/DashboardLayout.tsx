import { ReactNode, useMemo } from "react";
import { AppSidebar } from "./AppSidebar";
import { Header } from "./Header";
import { SidebarProvider } from "@/components/ui/sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const defaultOpen = useMemo(() => {
    if (typeof window === "undefined") return true;

    // Prefer persisted cookie state (set by SidebarProvider) over viewport heuristics.
    const cookie = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("sidebar:state="));

    if (cookie) {
      const value = cookie.split("=")[1];
      if (value === "true") return true;
      if (value === "false") return false;
    }

    // Fallback: open by default on desktop widths.
    return window.innerWidth >= 1024;
  }, []);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <Header />
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

