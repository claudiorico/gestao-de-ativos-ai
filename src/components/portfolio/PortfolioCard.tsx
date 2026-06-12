import { useState } from 'react';
import { Blur } from '@/components/ui/blur';
import { motion } from 'framer-motion';
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { PortfolioWithAssets, AssetWithPrice } from '@/hooks/usePortfolios';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

const formatPercent = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

interface PortfolioCardProps {
  portfolio: PortfolioWithAssets;
  index: number;
  onOpenDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddAsset: () => void;
  onEditAsset: (asset: AssetWithPrice) => void;
  onDeleteAsset: (assetId: string) => void;
}

export function PortfolioCard({
  portfolio,
  index,
  onOpenDetails,
  onEdit,
  onDelete,
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
}: PortfolioCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);

  const allocationDiff = portfolio.currentAllocation - portfolio.targetAllocation;
  const isOverAllocated = allocationDiff > 0.5;
  const isUnderAllocated = allocationDiff < -0.5;

  const handleDeleteAsset = (assetId: string) => {
    setAssetToDelete(assetId);
  };

  const confirmDeleteAsset = () => {
    if (assetToDelete) {
      onDeleteAsset(assetToDelete);
      setAssetToDelete(null);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.1 }}
        role="button"
        tabIndex={0}
        onClick={onOpenDetails}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenDetails();
        }}
        className="min-w-0 rounded-xl border border-border bg-card shadow-card transition-shadow hover:shadow-card-hover cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {/* Header with color indicator */}
        <div
          className="h-1.5 rounded-t-xl"
          style={{ backgroundColor: portfolio.color }}
        />

        <div className="p-4 sm:p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate">{portfolio.name}</h3>
              {portfolio.description && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  <span className="block truncate">{portfolio.description}</span>
                </p>
              )}
              <p className="text-2xl font-bold text-foreground tabular-nums mt-1">
                <Blur>{formatCurrency(portfolio.currentValue)}</Blur>
              </p>
              {portfolio.totalGain !== 0 && (
                <div className={cn(
                  "flex items-center gap-1 text-sm mt-0.5",
                  portfolio.totalGain >= 0 ? "text-success" : "text-loss"
                )}>
                  {portfolio.totalGain >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  <span className="tabular-nums font-medium">
                    <Blur>{formatCurrency(portfolio.totalGain)}</Blur>
                  </span>
                  <span className="text-muted-foreground">
                    (<Blur>{formatPercent(portfolio.totalGainPercent)}</Blur>)
                  </span>
                </div>
              )}
            </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAsset();
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Ativo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar Carteira
                  </DropdownMenuItem>
                <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteDialogOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir Carteira
                  </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Allocation Progress */}
          <div className="mb-4 space-y-2">
             <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Peso no total</span>
               <div className="flex items-center gap-2 min-w-0">
                <span className="tabular-nums font-medium text-foreground">
                  {portfolio.currentAllocation.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="tabular-nums text-muted-foreground">
                  {portfolio.targetAllocation}%
                </span>
              </div>
            </div>

            {(() => {
              const achievement =
                portfolio.targetAllocation > 0
                  ? (portfolio.currentAllocation / portfolio.targetAllocation) * 100
                  : 0;
              const achievementClamped = Math.min(Math.max(achievement, 0), 100);

              return (
                <>
                  <Progress value={achievementClamped} className="h-2" />
                   <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-muted-foreground">
                      Atingimento do alvo: {achievementClamped.toFixed(1)}%
                    </span>
                    <span>
                      {isOverAllocated && (
                        <span className="text-warning">
                          +{allocationDiff.toFixed(1)}% acima do alvo
                        </span>
                      )}
                      {isUnderAllocated && (
                        <span className="text-loss">
                          {allocationDiff.toFixed(1)}% abaixo do alvo
                        </span>
                      )}
                       {!isOverAllocated && !isUnderAllocated && (
                         <span className="text-success">No alvo</span>
                       )}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Assets List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Ativos ({portfolio.assets.length})
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                className="h-6 px-2 text-xs"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Menos
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Mais
                  </>
                )}
              </Button>
            </div>

            {portfolio.assets.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Nenhum ativo cadastrado
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAsset();
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Ativo
                </Button>
              </div>
            ) : (
              <>
                {(expanded ? portfolio.assets : portfolio.assets.slice(0, 3)).map(
                  (asset) => {
                    const isPositive = asset.priceChangePercent >= 0;
                    return (
                       <div
                        key={asset.id}
                         className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">
                                {(asset.name || asset.ticker).toUpperCase()}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                <span className="font-mono">{asset.ticker}</span> • {formatCurrency(asset.currentPrice)} × {asset.shares}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "text-xs tabular-nums px-1.5 py-0.5 rounded shrink-0",
                                isPositive
                                  ? "bg-success/10 text-success"
                                  : "bg-loss/10 text-loss"
                              )}
                            >
                              {formatPercent(asset.priceChangePercent)}
                            </span>
                          </div>
                        </div>
                         <div className="flex items-center justify-between gap-2 sm:justify-end">
                          <div className="text-right">
                            <div className="tabular-nums font-medium text-foreground">
                              {formatCurrency(asset.currentValue)}
                            </div>
                            <div className={cn(
                              "text-xs tabular-nums",
                              asset.gain >= 0 ? "text-success" : "text-loss"
                            )}>
                              {asset.gain >= 0 ? '+' : ''}{formatCurrency(asset.gain)}
                            </div>
                          </div>
                           <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditAsset(asset);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAsset(asset.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                )}
                {!expanded && portfolio.assets.length > 3 && (
                  <p className="text-center text-xs text-muted-foreground">
                    +{portfolio.assets.length - 3} ativos
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Delete Portfolio Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Carteira</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a carteira "{portfolio.name}"? Esta ação
              não pode ser desfeita e todos os ativos associados também serão
              removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Asset Dialog */}
      <AlertDialog
        open={!!assetToDelete}
        onOpenChange={() => setAssetToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este ativo? Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteAsset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
