import { Outlet } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "@/components/common/CommandPalette";
import { PageTitleProvider } from "./PageTitleContext";
import { BottomNav } from "./BottomNav";

export function AppLayout() {
  return (
    <PageTitleProvider>
      <SidebarProvider
      style={
        {
          "--sidebar-width": "248px",
          "--sidebar-width-icon": "56px",
        } as React.CSSProperties
      }
    >
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:px-6 md:py-6 md:pb-6">
            <Outlet />
          </main>
        </div>
        <BottomNav />
        <CommandPalette />
      </div>
      </SidebarProvider>
    </PageTitleProvider>
  );
}