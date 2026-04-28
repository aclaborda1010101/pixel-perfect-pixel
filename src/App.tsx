import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Owners from "./pages/Owners";
import OwnerDetail from "./pages/OwnerDetail";
import Buildings from "./pages/Buildings";
import Assets from "./pages/Assets";
import Calls from "./pages/Calls";
import Investors from "./pages/Investors";
import Matching from "./pages/Matching";
import Compliance from "./pages/Compliance";
import Cadences from "./pages/Cadences";
import Settings from "./pages/Settings";
import CallAnalysis from "./pages/CallAnalysis";
import AssetDetail from "./pages/AssetDetail";
import BuildingDetail from "./pages/BuildingDetail";
import PrepareCallWizard from "./pages/wizards/PrepareCallWizard";
import AnalyzeCallWizard from "./pages/wizards/AnalyzeCallWizard";
import Login from "./pages/auth/Login";
import RecoverPassword from "./pages/auth/RecoverPassword";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/recuperar" element={<RecoverPassword />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/propietarios" element={<Owners />} />
                <Route path="/propietarios/:id" element={<OwnerDetail />} />
                <Route path="/edificios" element={<Buildings />} />
                <Route path="/edificios/:id" element={<BuildingDetail />} />
                <Route path="/activos" element={<Assets />} />
                <Route path="/activos/:id" element={<AssetDetail />} />
                <Route path="/llamadas" element={<Calls />} />
                <Route path="/llamadas/:id" element={<CallAnalysis />} />
                <Route path="/preparar-llamada" element={<PrepareCallWizard />} />
                <Route path="/analizar-llamada" element={<AnalyzeCallWizard />} />
                <Route path="/inversores" element={<Investors />} />
                <Route path="/matching" element={<Matching />} />
                <Route path="/compliance" element={<Compliance />} />
                <Route path="/cadencias" element={<Cadences />} />
                <Route path="/ajustes" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
