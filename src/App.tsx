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
import Assistant from "./pages/Assistant";
import Settings from "./pages/Settings";
import CallAnalysis from "./pages/CallAnalysis";
import AssetDetail from "./pages/AssetDetail";
import BuildingDetail from "./pages/BuildingDetail";
import PrepareCallWizard from "./pages/wizards/PrepareCallWizard";
import AnalyzeCallWizard from "./pages/wizards/AnalyzeCallWizard";
import Leads from "./pages/Leads";
import NotasSimples from "./pages/NotasSimples";
import Mensajes from "./pages/Mensajes";
import Login from "./pages/auth/Login";
import RecoverPassword from "./pages/auth/RecoverPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/recuperar" element={<RecoverPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
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
                <Route path="/leads" element={<Leads />} />
                <Route path="/notas-simples" element={<NotasSimples />} />
                <Route path="/mensajes" element={<Mensajes />} />
                <Route path="/asistente" element={<Assistant />} />
                <Route path="/ajustes" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
