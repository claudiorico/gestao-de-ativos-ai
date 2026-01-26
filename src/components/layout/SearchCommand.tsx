import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Briefcase, TrendingUp } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePortfolios } from "@/hooks/usePortfolios";
import { useSecureStorage } from "@/contexts/SecureStorageContext";

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { portfoliosWithAssets } = usePortfolios();
  const { isUnlocked } = useSecureStorage();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const searchItems = useMemo(() => {
    if (!isUnlocked) return { portfolios: [], assets: [] };

    const portfolios = portfoliosWithAssets.map((p) => ({
      id: p.id,
      name: p.name,
      type: "portfolio" as const,
    }));

    const assets = portfoliosWithAssets.flatMap((portfolio) =>
      portfolio.assets.map((asset) => ({
        id: asset.id,
        ticker: asset.ticker,
        name: asset.name,
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        type: "asset" as const,
      }))
    );

    return { portfolios, assets };
  }, [portfoliosWithAssets, isUnlocked]);

  const handleSelect = (type: "portfolio" | "asset", id: string, portfolioId?: string) => {
    setOpen(false);
    if (type === "portfolio") {
      navigate(`/portfolio/${id}`);
    } else if (type === "asset" && portfolioId) {
      navigate(`/portfolio/${portfolioId}`);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative hidden w-full max-w-[20rem] lg:block lg:max-w-md"
      >
        <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Buscar ativos, carteiras...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Digite para buscar ativos ou carteiras..." />
        <CommandList>
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          
          {searchItems.portfolios.length > 0 && (
            <CommandGroup heading="Carteiras">
              {searchItems.portfolios.map((portfolio) => (
                <CommandItem
                  key={portfolio.id}
                  value={portfolio.name}
                  onSelect={() => handleSelect("portfolio", portfolio.id)}
                  className="flex items-center gap-2"
                >
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span>{portfolio.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {searchItems.assets.length > 0 && (
            <CommandGroup heading="Ativos">
              {searchItems.assets.map((asset) => (
                <CommandItem
                  key={asset.id}
                  value={`${asset.ticker} ${asset.name} ${asset.portfolioName}`}
                  onSelect={() => handleSelect("asset", asset.id, asset.portfolioId)}
                  className="flex items-center gap-2"
                >
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{asset.ticker}</span>
                      <span className="text-xs text-muted-foreground">{asset.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      em {asset.portfolioName}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}