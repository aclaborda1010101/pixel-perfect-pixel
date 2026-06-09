import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import { RuntimeErrorBoundary } from "@/components/RuntimeErrorBoundary";

// Code-splitting: cada ruta carga sólo cuando se visita.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Owners = lazy(() => import("./pages/Owners"));
const OwnerDetail = lazy(() => import("./pages/OwnerDetail"));
const Buildings = lazy(() => import("./pages/Buildings"));
const Assets = lazy(() => import("./pages/Assets"));
const Calls = lazy(() => import("./pages/Calls"));
const Investors = lazy(() => import("./pages/Investors"));
const Assistant = lazy(() => import("./pages/Assistant"));
const Settings = lazy(() => import("./pages/Settings"));
const CallAnalysis = lazy(() => import("./pages/CallAnalysis"));
const AssetDetail = lazy(() => import("./pages/AssetDetail"));
const BuildingDetail = lazy(() => import("./pages/BuildingDetail"));
const PrepareCallWizard = lazy(() => import("./pages/wizards/PrepareCallWizard"));
const AnalyzeCallWizard = lazy(() => import("./pages/wizards/AnalyzeCallWizard"));
const Leads = lazy(() => import("./pages/Leads"));
const NotasSimples = lazy(() => import("./pages/NotasSimples"));
const NotaSimpleDetail = lazy(() => import("./pages/NotaSimpleDetail"));
const Mensajes = lazy(() => import("./pages/Mensajes"));
const NextActions = lazy(() => import("./pages/NextActions"));
const Productividad = lazy(() => import("./pages/Productividad"));
const JobProgressPage = lazy(() => import("./pages/admin/JobProgressPage"));
const Login = lazy(() => import("./pages/auth/Login"));
const RecoverPassword = lazy(() => import("./pages/auth/RecoverPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const ComercialDashboard = lazy(() => import("./pages/comercial/Dashboard"));
const ComercialEdificios = lazy(() => import("./pages/comercial/Edificios"));
const ComercialEdificio = lazy(() => import("./pages/comercial/EdificioDetalle"));
const ComercialPreparar = lazy(() => import("./pages/comercial/PrepararLlamada"));
const ComercialTareas = lazy(() => import("./pages/comercial/Tareas"));
const ComercialCuenta = lazy(() => import("./pages/comercial/Cuenta"));
const AdminRankingComercial = lazy(() => import("./pages/admin/RankingComercial"));

// React Query: cachea datos entre navegaciones. Volver a una vista ya cargada es instantáneo.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // 1 min: no refetch al volver
      gcTime: 5 * 60_000,           // 5 min en cache
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/recuperar" element={<RecoverPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/propietarios" element={<Owners />} />
                <Route path="/propietarios/:id" element={<OwnerDetail />} />
                <Route path="/edificios" element={<Buildings />} />
                <Route
                  path="/edificios/:id"
                  element={
                    <RuntimeErrorBoundary>
                      <BuildingDetail />
                    </RuntimeErrorBoundary>
                  }
                />
                <Route path="/activos" element={<Assets />} />
                <Route path="/activos/:id" element={<AssetDetail />} />
                <Route path="/llamadas" element={<Calls />} />
                <Route path="/llamadas/:id" element={<CallAnalysis />} />
                <Route path="/preparar-llamada" element={<PrepareCallWizard />} />
                <Route path="/analizar-llamada" element={<AnalyzeCallWizard />} />
                <Route path="/inversores" element={<Investors />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/leads-marketing" element={<Leads />} />
                <Route path="/notas-simples" element={<NotasSimples />} />
                <Route path="/notas-simples/:id" element={<NotaSimpleDetail />} />
                <Route path="/mensajes" element={<Mensajes />} />
                <Route path="/next-actions" element={<NextActions />} />
                <Route path="/productividad" element={<Productividad />} />
                <Route path="/admin/productividad" element={<Productividad />} />
                <Route path="/admin/jobs/:jobId" element={<JobProgressPage />} />
                <Route path="/asistente" element={<Assistant />} />
                <Route path="/asistente-ia" element={<Assistant />} />
                <Route path="/ajustes" element={<Settings />} />
                <Route path="/comercial" element={<ComercialDashboard />} />
                <Route path="/comercial/edificios" element={<ComercialEdificios />} />
                <Route
                  path="/comercial/edificios/:id"
                  element={
                    <RuntimeErrorBoundary>
                      <ComercialEdificio />
                    </RuntimeErrorBoundary>
                  }
                />
                <Route path="/comercial/tareas" element={<ComercialTareas />} />
                <Route path="/comercial/preparar/:ownerId" element={<ComercialPreparar />} />
                <Route path="/comercial/cuenta" element={<ComercialCuenta />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
