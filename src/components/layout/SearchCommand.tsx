import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Briefcase, TrendingUp } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import type { Asset, Portfolio } from "@/types/financial";

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const navigate = useNavigate();
  const { isUnlocked, getPortfolios, getAssets } = useSecureStorage();

  useEffect(() => {
    if (!isUnlocked) {
      setPortfolios([]);
      setAssets([]);
      return;
    }

    let mounted = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const [nextPortfolios, nextAssets] = await Promise.all([
        getPortfolios(),
        getAssets(),
      ]);

      if (!mounted) return;
      setPortfolios(nextPortfolios);
      setAssets(nextAssets);
    };

    load().catch((error) => {
      console.error("[SearchCommand] Failed to load search data", error);
    });

    const onVaultChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        load().catch((error) => {
          console.error("[SearchCommand] Failed to refresh search data", error);
        });
      }, 300);
    };

    window.addEventListener("vault-data-changed", onVaultChange);
    return () => {
      mounted = false;
      if (debounce) clearTimeout(debounce);
      window.removeEventListener("vault-data-changed", onVaultChange);
    };
  }, [getAssets, getPortfolios, isUnlocked]);

  const searchItems = useMemo(() => {
    if (!isUnlocked) return { portfolios: [], assets: [] };

    const portfolioItems = portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      type: "portfolio" as const,
    }));

    const portfolioById = new Map(portfolios.map((p) => [p.id, p.name] as const));
    const assetItems = assets.map((asset) => ({
      id: asset.id,
      ticker: asset.ticker,
      name: asset.name,
      portfolioId: asset.portfolioId,
      portfolioName: portfolioById.get(asset.portfolioId) ?? "",
      type: "asset" as const,
    }));

    return { portfolios: portfolioItems, assets: assetItems };
  }, [assets, portfolios, isUnlocked]);

  const handleSelect = (type: "portfolio" | "asset", id: string, portfolioId?: string) => {
    setOpen(false);
    setSearch("");
    if (type === "portfolio") {
      navigate(`/portfolio/${id}`);
    } else if (type === "asset" && portfolioId) {
      // Leva à carteira e sinaliza o ativo para rolar/destacar na tabela.
      navigate(`/portfolio/${portfolioId}?asset=${encodeURIComponent(id)}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative hidden w-full max-w-[20rem] cursor-pointer lg:block lg:max-w-md">
          <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Buscar ativos, carteiras...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[var(--radix-popover-trigger-width)] p-0 z-50" 
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Digite para buscar..." 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

            {searchItems.portfolios.length > 0 && search && (
              <CommandGroup heading="Carteiras">
                {searchItems.portfolios
                  .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
                  .map((portfolio) => (
                <CommandItem
                  key={portfolio.id}
                  value={portfolio.name}
                  onSelect={() => handleSelect("portfolio", portfolio.id)}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span>{portfolio.name}</span>
                </CommandItem>
                  ))}
              </CommandGroup>
            )}

            {searchItems.assets.length > 0 && search && (
              <CommandGroup heading="Ativos">
                {searchItems.assets
                  .filter(a => 
                    a.ticker.toLowerCase().includes(search.toLowerCase()) ||
                    a.name.toLowerCase().includes(search.toLowerCase())
                  )
                  .slice(0, 8)
                  .map((asset) => (
                <CommandItem
                  key={asset.id}
                  value={`${asset.ticker} ${asset.name} ${asset.portfolioName}`}
                  onSelect={() => handleSelect("asset", asset.id, asset.portfolioId)}
                  className="flex cursor-pointer items-center gap-2"
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
