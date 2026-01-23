import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { motion } from 'framer-motion';
import { Plus, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePortfolios } from '@/hooks/usePortfolios';
import { useAssets } from '@/hooks/useAssets';
import { PortfolioCard } from '@/components/portfolio/PortfolioCard';
import { PortfolioFormDialog } from '@/components/portfolio/PortfolioFormDialog';
import { AssetFormDialog } from '@/components/portfolio/AssetFormDialog';
import { EmptyPortfolioState } from '@/components/portfolio/EmptyPortfolioState';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import type { Portfolio, Asset } from '@/types/financial';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { isUnlocked } = useSecureStorage();
  const {
    portfoliosWithAssets,
    isLoading,
    createPortfolio,
    updatePortfolio,
    removePortfolio,
    refresh: refreshPortfolios,
    refreshQuotesNow,
    quotesLastUpdated,
  } = usePortfolios();

  const quotesLastUpdatedLabel = quotesLastUpdated
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(quotesLastUpdated)
    : null;

  const { createAsset, updateAsset, removeAsset } = useAssets();

  // Dialog states
  const [portfolioDialogOpen, setPortfolioDialogOpen] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [assetPortfolioId, setAssetPortfolioId] = useState<string>('');

  const totalValue = portfoliosWithAssets.reduce((acc, p) => acc + p.currentValue, 0);
  const totalTargetAllocation = portfoliosWithAssets.reduce(
    (acc, p) => acc + (Number.isFinite(p.targetAllocation) ? p.targetAllocation : 0),
    0
  );
  const missingAllocation = Math.max(0, 100 - totalTargetAllocation);
  const overAllocation = Math.max(0, totalTargetAllocation - 100);

  // Portfolio handlers
  const handleCreatePortfolio = () => {
    setSelectedPortfolio(null);
    setPortfolioDialogOpen(true);
  };

  const handleEditPortfolio = (portfolio: Portfolio) => {
    setSelectedPortfolio(portfolio);
    setPortfolioDialogOpen(true);
  };

  const handlePortfolioSubmit = async (
    data: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (selectedPortfolio) {
      await updatePortfolio(selectedPortfolio.id, data);
    } else {
      await createPortfolio(data);
    }
  };

  const handleDeletePortfolio = async (id: string) => {
    await removePortfolio(id);
  };

  // Asset handlers
  const handleAddAsset = (portfolioId: string) => {
    setSelectedAsset(null);
    setAssetPortfolioId(portfolioId);
    setAssetDialogOpen(true);
  };

  const handleEditAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setAssetPortfolioId(asset.portfolioId);
    setAssetDialogOpen(true);
  };

  const handleAssetSubmit = async (
    data: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (selectedAsset) {
      await updateAsset(selectedAsset.id, data);
    } else {
      await createAsset(data);
    }
    await refreshPortfolios();
  };

  const handleDeleteAsset = async (assetId: string) => {
    await removeAsset(assetId);
    await refreshPortfolios();
  };

  if (!isUnlocked) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Desbloqueie o cofre para acessar seus portfólios.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold text-foreground">Portfólio</h1>
            <p className="text-muted-foreground">
              {portfoliosWithAssets.length > 0 ? (
                <>
                  Patrimônio total:{' '}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(totalValue)}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}• Peso total:{' '}
                    <span className="font-medium text-foreground tabular-nums">
                      {totalTargetAllocation.toFixed(1)}%
                    </span>
                    {missingAllocation > 0 && (
                      <span className="tabular-nums"> (faltam {missingAllocation.toFixed(1)}%)</span>
                    )}
                    {overAllocation > 0 && (
                      <span className="tabular-nums"> (excedeu {overAllocation.toFixed(1)}%)</span>
                    )}
                  </span>
                </>
              ) : (
                'Gerencie suas carteiras e alocações'
              )}
            </p>
          </div>
          {portfoliosWithAssets.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={refreshQuotesNow}
                  disabled={isLoading}
                  title="Atualiza as cotações agora"
                >
                  <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  Atualizar agora
                </Button>
                {quotesLastUpdatedLabel && (
                  <span className="mt-1 text-xs text-muted-foreground">
                    Última atualização: {quotesLastUpdatedLabel}
                  </span>
                )}
              </div>

              <Button className="gap-2" onClick={handleCreatePortfolio}>
                <Plus className="h-4 w-4" />
                Nova Carteira
              </Button>
            </div>
          )}
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && portfoliosWithAssets.length === 0 && (
          <EmptyPortfolioState onCreatePortfolio={handleCreatePortfolio} />
        )}

        {/* Portfolio Cards */}
        {!isLoading && portfoliosWithAssets.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {portfoliosWithAssets.map((portfolio, index) => (
              <PortfolioCard
                key={portfolio.id}
                portfolio={portfolio}
                index={index}
                onOpenDetails={() => navigate(`/portfolio/${portfolio.id}`)}
                onEdit={() => handleEditPortfolio(portfolio)}
                onDelete={() => handleDeletePortfolio(portfolio.id)}
                onAddAsset={() => handleAddAsset(portfolio.id)}
                onEditAsset={handleEditAsset}
                onDeleteAsset={handleDeleteAsset}
              />
            ))}
          </div>
        )}

        {/* Dialogs */}
        <PortfolioFormDialog
          open={portfolioDialogOpen}
          onOpenChange={setPortfolioDialogOpen}
          portfolio={selectedPortfolio}
          onSubmit={handlePortfolioSubmit}
        />

        <AssetFormDialog
          open={assetDialogOpen}
          onOpenChange={setAssetDialogOpen}
          portfolioId={assetPortfolioId}
          asset={selectedAsset}
          onSubmit={handleAssetSubmit}
        />
      </div>
    </DashboardLayout>
  );
}
