import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { SecureStorageProvider } from "@/contexts/SecureStorageContext";
import { GoogleUserProvider } from "@/contexts/GoogleUserContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { VaultGuard } from "@/components/vault/VaultGuard";
import { useAutoSync } from "@/hooks/use-auto-sync";
import Landing from "./pages/Landing";
import Index from "./pages/Index";
import AuthDiagnostics from "./pages/AuthDiagnostics";
import Portfolio from "./pages/Portfolio";
import PortfolioDetail from "./pages/PortfolioDetail";
import Balancing from "./pages/BalancingPage";
import Transactions from "./pages/Transactions";
import TransactionNew from "./pages/TransactionNew";
import Dividends from "./pages/Dividends";
import Taxes from "./pages/Taxes";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import Privacy from "./pages/Privacy";
import Help from "./pages/Help";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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

          {/* Everything requires: 1) Google login 2) Vault unlock */}
          <Route element={<ProtectedLayout />}>
            <Route path="/home" element={<Index />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/portfolio/:portfolioId" element={<PortfolioDetail />} />
            <Route path="/balancing" element={<Balancing />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/transactions/new" element={<TransactionNew />} />
            <Route path="/dividends" element={<Dividends />} />
            <Route path="/taxes" element={<Taxes />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <GoogleUserProvider>
        <SecureStorageProvider>
          <AppContent />
        </SecureStorageProvider>
      </GoogleUserProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
