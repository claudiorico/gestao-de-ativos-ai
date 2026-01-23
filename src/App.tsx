import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { SecureStorageProvider } from "@/contexts/SecureStorageContext";
import { FirebaseAuthProvider } from "@/contexts/FirebaseAuthContext";
import { FirebaseAuthGuard } from "@/components/auth/FirebaseAuthGuard";
import { VaultGuard } from "@/components/vault/VaultGuard";
import { useAutoSync } from "@/hooks/use-auto-sync";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AutoSyncListener() {
  useAutoSync();
  return null;
}

// ProtectedLayout: Firebase Auth -> Vault -> App Content
function ProtectedLayout() {
  return (
    <FirebaseAuthGuard>
      <VaultGuard>
        <AutoSyncListener />
        <Outlet />
      </VaultGuard>
    </FirebaseAuthGuard>
  );
}

// Main app with correct provider hierarchy
function AppContent() {
  return (
    <BrowserRouter>
      <Toaster />
      <Sonner />
        <Routes>
          {/* Auth helper screens (must be reachable without login) */}
          <Route path="/auth/diagnostico" element={<AuthDiagnostics />} />

          {/* Everything requires: 1) Firebase login 2) Vault unlock */}
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/portfolio/:portfolioId" element={<PortfolioDetail />} />
            <Route path="/balancing" element={<Balancing />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/transactions/new" element={<TransactionNew />} />
            <Route path="/dividends" element={<Dividends />} />
            <Route path="/taxes" element={<Taxes />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <FirebaseAuthProvider>
        <SecureStorageProvider>
          <AppContent />
        </SecureStorageProvider>
      </FirebaseAuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
