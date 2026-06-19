import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { SecureStorageProvider } from "@/contexts/SecureStorageContext";
import { GoogleUserProvider } from "@/contexts/GoogleUserContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { VaultGuard } from "@/components/vault/VaultGuard";
import { useAutoSync } from "@/hooks/use-auto-sync";
import Landing from "./pages/Landing";
import AuthDiagnostics from "./pages/AuthDiagnostics";
import Privacy from "./pages/Privacy";
import Help from "./pages/Help";
import NotFound from "./pages/NotFound";
import {
  BackupCriptografadoPage,
  ControleCarteiraPage,
  ImportarB3Page,
  ImpostoRendaPage,
  RebalanceamentoCarteiraPage,
} from "./pages/FeatureSeoPage";
import { installPerformanceMonitor } from "./lib/performance-monitor";

installPerformanceMonitor();

// Rotas protegidas: lazy-loaded para manter o bundle inicial pequeno
// (só carregam após login + desbloqueio do cofre, então o code-split não atrasa a home pública)
const Index = lazy(() => import("./pages/Index"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const PortfolioDetail = lazy(() => import("./pages/PortfolioDetail"));
const Balancing = lazy(() => import("./pages/BalancingPage"));
const Transactions = lazy(() => import("./pages/Transactions"));
const TransactionNew = lazy(() => import("./pages/TransactionNew"));
const Dividends = lazy(() => import("./pages/Dividends"));
const Taxes = lazy(() => import("./pages/Taxes"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Settings = lazy(() => import("./pages/Settings"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function AutoSyncListener() {
  useAutoSync();
  return null;
}

// ProtectedLayout: Google Auth -> Vault -> App Content
function ProtectedLayout() {
  return (
    <AuthGuard>
      <VaultGuard>
        <AutoSyncListener />
        <Outlet />
      </VaultGuard>
    </AuthGuard>
  );
}

// Main app with correct provider hierarchy
function AppContent() {
  return (
    <BrowserRouter>
      <Toaster />
      <Sonner />
        <Routes>
          {/* Public pages (no login required) */}
          <Route path="/" element={<Landing />} />
          <Route path="/auth/diagnostico" element={<AuthDiagnostics />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/ajuda" element={<Help />} />
          <Route path="/importar-b3" element={<ImportarB3Page />} />
          <Route path="/controle-carteira-investimentos" element={<ControleCarteiraPage />} />
          <Route path="/imposto-renda-investimentos" element={<ImpostoRendaPage />} />
          <Route path="/backup-criptografado-google-drive" element={<BackupCriptografadoPage />} />
          <Route path="/rebalanceamento-carteira" element={<RebalanceamentoCarteiraPage />} />

          {/* Everything requires: 1) Google login 2) Vault unlock */}
          <Route element={<ProtectedLayout />}>
            <Route
              path="/home"
              element={<Suspense fallback={<RouteFallback />}><Index /></Suspense>}
            />
            <Route
              path="/portfolio"
              element={<Suspense fallback={<RouteFallback />}><Portfolio /></Suspense>}
            />
            <Route
              path="/portfolio/:portfolioId"
              element={<Suspense fallback={<RouteFallback />}><PortfolioDetail /></Suspense>}
            />
            <Route
              path="/balancing"
              element={<Suspense fallback={<RouteFallback />}><Balancing /></Suspense>}
            />
            <Route
              path="/transactions"
              element={<Suspense fallback={<RouteFallback />}><Transactions /></Suspense>}
            />
            <Route
              path="/transactions/new"
              element={<Suspense fallback={<RouteFallback />}><TransactionNew /></Suspense>}
            />
            <Route
              path="/dividends"
              element={<Suspense fallback={<RouteFallback />}><Dividends /></Suspense>}
            />
            <Route
              path="/taxes"
              element={<Suspense fallback={<RouteFallback />}><Taxes /></Suspense>}
            />
            <Route
              path="/analytics"
              element={<Suspense fallback={<RouteFallback />}><Analytics /></Suspense>}
            />
            <Route
              path="/settings"
              element={<Suspense fallback={<RouteFallback />}><Settings /></Suspense>}
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GoogleUserProvider>
          <SecureStorageProvider>
            <AppContent />
          </SecureStorageProvider>
        </GoogleUserProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
