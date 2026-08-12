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

// Carga perezosa resiliente: si el chunk falla (deploy/HMR con hash viejo),
// reintenta una vez y, si sigue fallando, recarga la página una sola vez.
function lazyRetry<T extends { default: React.ComponentType<Record<string, unknown>> }>(
  factory: () => Promise<T>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        return await factory();
      } catch (err2) {
        const key = "lovable:chunk-reloaded";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise<T>(() => {});
        }
        throw err2;
      }
    }
  });
}

const lazy_ = lazyRetry;

// Code-splitting: cada ruta carga sólo cuando se visita.
const Dashboard = lazy_(() => import("./pages/Dashboard"));
const Owners = lazy_(() => import("./pages/Owners"));
const OwnerDetail = lazy_(() => import("./pages/OwnerDetail"));
const Buildings = lazy_(() => import("./pages/Buildings"));
const Assets = lazy_(() => import("./pages/Assets"));
const Calls = lazy_(() => import("./pages/Calls"));
const Investors = lazy_(() => import("./pages/Investors"));
const Assistant = lazy_(() => import("./pages/Assistant"));
const Settings = lazy_(() => import("./pages/Settings"));
const CallExpediente = lazy_(() => import("./pages/comercial/CallExpediente"));
const CallLegacyRedirect = lazy_(() => import("./pages/comercial/CallLegacyRedirect"));
const AssetDetail = lazy_(() => import("./pages/AssetDetail"));
const BuildingDetail = lazy_(() => import("./pages/BuildingDetail"));
const PrepareCallWizard = lazy_(() => import("./pages/wizards/PrepareCallWizard"));
const AnalyzeCallWizard = lazy_(() => import("./pages/wizards/AnalyzeCallWizard"));
const Leads = lazy_(() => import("./pages/Leads"));
const NotasSimples = lazy_(() => import("./pages/NotasSimples"));
const NotaSimpleDetail = lazy_(() => import("./pages/NotaSimpleDetail"));
const Mensajes = lazy_(() => import("./pages/Mensajes"));
const NextActions = lazy_(() => import("./pages/NextActions"));
const Productividad = lazy_(() => import("./pages/Productividad"));
const JobProgressPage = lazy_(() => import("./pages/admin/JobProgressPage"));
const Login = lazy_(() => import("./pages/auth/Login"));
const RecoverPassword = lazy_(() => import("./pages/auth/RecoverPassword"));
const ResetPassword = lazy_(() => import("./pages/auth/ResetPassword"));
const ComercialDashboard = lazy_(() => import("./pages/comercial/Dashboard"));
const ComercialEdificios = lazy_(() => import("./pages/comercial/Edificios"));
const ComercialEdificio = lazy_(() => import("./pages/comercial/EdificioDetalle"));
const ComercialPreparar = lazy_(() => import("./pages/comercial/PrepararLlamada"));
const ComercialTareas = lazy_(() => import("./pages/comercial/Tareas"));
const ComercialCuenta = lazy_(() => import("./pages/comercial/Cuenta"));
const AdminRankingComercial = lazy_(() => import("./pages/admin/RankingComercial"));
const AdminProteccionValidation = lazy_(() => import("./pages/admin/ProteccionValidationQueue"));
const Enriquecimiento = lazy_(() => import("./pages/Enriquecimiento"));
const AdminEquipo = lazy_(() => import("./pages/admin/Equipo"));
const AdminZonas = lazy_(() => import("./pages/admin/Zonas"));
const AdminIA = lazy_(() => import("./pages/admin/IA"));
const AdminOps = lazy_(() => import("./pages/admin/Ops"));
const AdminSync = lazy_(() => import("./pages/admin/Sync"));
const AdminIntegridad = lazy_(() => import("./pages/admin/Integridad"));
const AdminGuardas = lazy_(() => import("./pages/admin/Guardas"));
const AdminColaSimulada = lazy_(() => import("./pages/admin/ColaSimulada"));
const WhatsappDashboard = lazy_(() => import("./pages/whatsapp/WhatsappDashboard"));
const GestorComerciales = lazy_(() => import("./pages/GestorComerciales"));
const Correcciones = lazy_(() => import("./pages/Correcciones"));
const CambiarPasswordObligatorio = lazy_(() => import("./pages/auth/CambiarPasswordObligatorio"));
const Oportunidades = lazy_(() => import("./pages/Oportunidades"));
const RevisionEscaleras = lazy_(() => import("./pages/RevisionEscaleras"));
const OAuthConsent = lazy_(() => import("./pages/OAuthConsent"));

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
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
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
                <Route path="/llamadas/:id" element={<CallLegacyRedirect />} />
                <Route path="/comercial/llamada/:hsId" element={<CallExpediente />} />
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
                <Route path="/admin/ranking" element={<AdminRankingComercial />} />
                <Route path="/admin/proteccion-pgoum" element={<AdminProteccionValidation />} />
                <Route path="/admin/equipo" element={<AdminEquipo />} />
                <Route path="/admin/zonas" element={<AdminZonas />} />
                <Route path="/admin/ia" element={<AdminIA />} />
                <Route path="/admin/_ops" element={<AdminOps />} />
                <Route path="/admin" element={<AdminSync />} />
                <Route path="/admin/sync" element={<AdminSync />} />
                <Route path="/admin/integridad" element={<AdminIntegridad />} />
                <Route path="/admin/guardas" element={<AdminGuardas />} />
                <Route path="/admin/cola-simulada" element={<AdminColaSimulada />} />
                <Route path="/enriquecimiento" element={<Enriquecimiento />} />
                <Route path="/whatsapp" element={<WhatsappDashboard />} />
                <Route path="/gestor-comerciales" element={<GestorComerciales />} />
                <Route path="/correcciones" element={<Correcciones />} />
                <Route path="/cambiar-password" element={<CambiarPasswordObligatorio />} />
                <Route path="/oportunidades" element={<Oportunidades />} />
                <Route path="/revision-escaleras" element={<RevisionEscaleras />} />
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
