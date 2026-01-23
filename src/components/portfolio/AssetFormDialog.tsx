import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invokeBackendFunction } from '@/lib/backend/functionsClient';
import { normalizeTickerForStorage } from '@/lib/ticker';
import type { Asset } from '@/types/financial';

const ASSET_TYPES: { value: Asset['type']; label: string }[] = [
  { value: 'stock', label: 'Ação' },
  { value: 'reit', label: 'FII' },
  { value: 'etf', label: 'ETF' },
  { value: 'fixed_income', label: 'Renda Fixa' },
  { value: 'investment_fund', label: 'Fundo de Investimento (CVM)' },
  { value: 'crypto', label: 'Criptoativo' },
  { value: 'international', label: 'Internacional' },
];

interface AssetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  asset?: Asset | null;
  onSubmit: (data: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}

export function AssetFormDialog({
  open,
  onOpenChange,
  portfolioId,
  asset,
  onSubmit,
}: AssetFormDialogProps) {
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Asset['type']>('stock');
  const [targetAllocation, setTargetAllocation] = useState('');
  const [shares, setShares] = useState('');
  const [averagePrice, setAveragePrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingName, setIsLoadingName] = useState(false);

  const isEditing = !!asset;

  // Fetch asset name from API when ticker changes
  const fetchAssetName = useCallback(
    async (tickerValue: string) => {
      const cleaned = tickerValue.trim();

      // Regras de tamanho por tipo
      const minLength = type === 'crypto' ? 3 : type === 'investment_fund' ? 14 : 4;
      if (!cleaned || cleaned.length < minLength) return;

      // Fundo CVM: usa CNPJ (somente dígitos)
      const normalizedTicker = type === 'investment_fund'
        ? cleaned.replace(/\D/g, '').slice(0, 14)
        : cleaned.toUpperCase();

      const upper = normalizedTicker.toUpperCase();

      // Fallback instantâneo para alguns criptoativos comuns (evita depender 100% da API)
      if (type === 'crypto') {
        const cryptoNameMap: Record<string, string> = {
          BTC: 'Bitcoin',
          ETH: 'Ethereum',
          USDT: 'Tether',
          USDC: 'USD Coin',
          HYPE: 'Hyperliquid',
        };
        const mapped = cryptoNameMap[upper];
        if (mapped) {
          setName(mapped);
          return;
        }
      }

      setIsLoadingName(true);
      try {
        console.log('[CVM][UI] consultando nome para', { type, input: tickerValue, upper });

        const { data, error } = await invokeBackendFunction<{ quotes?: Array<{ name?: string; error?: string }>; error?: string }>(
          'get-quotes',
          { body: { tickers: [upper] } }
        );

        console.log('[CVM][UI] resposta get-quotes', { error, data });

        if (!error && data?.quotes?.[0]) {
          const result = data.quotes[0];
          console.log('[CVM][UI] quote[0]', result);

          // Para Fundo CVM, queremos ao menos preencher o nome mesmo que ainda não haja cota.
          if (type === 'investment_fund') {
            if (result.error) {
              console.warn('[CVM][UI] fundo retornou erro', result.error);
            }

            const candidate = (result.name ?? '').trim();
            const isFallback = /^Fundo\s/i.test(candidate);

            console.log('[CVM][UI] nome recebido', {
              candidate,
              isFallback,
              sameAsCnpj: candidate === upper,
            });

            // Só auto-preenche quando realmente temos um nome "humano" do fundo.
            // Se a API devolveu o fallback "Fundo <CNPJ>", mantemos em branco para o usuário preencher.
            if (candidate && !isFallback && candidate !== upper) setName(candidate);
            return;
          }

          if (result.name) {
            // Para Tesouro Direto, preenche o nome mesmo se a cota/preço não estiver disponível
            if (type === 'fixed_income' && upper.startsWith('TD:')) {
              setName(result.name);
            } else if (!result.error) {
              setName(result.name);
            }
          }
        }
        // If API fails or returns error, just let user fill name manually
      } catch (err) {
        console.log('Could not auto-fill asset name:', err);
      } finally {
        setIsLoadingName(false);
      }
    },
    [type]
  );

  // Debounce ticker input to fetch name
  useEffect(() => {
    if (asset) return;

    const minLength = type === 'crypto' ? 3 : type === 'investment_fund' ? 14 : 4;
    const raw = ticker.trim();
    const effectiveLen = type === 'investment_fund' ? raw.replace(/\D/g, '').length : raw.length;
    if (effectiveLen < minLength) return;

    const timeoutId = setTimeout(() => {
      fetchAssetName(ticker);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [ticker, asset, fetchAssetName, type]);

  useEffect(() => {
    if (asset) {
      setTicker(asset.ticker);
      setName(asset.name);
      setType(asset.type);
      setTargetAllocation(asset.targetAllocation.toString());
      setShares(asset.shares.toString());
      setAveragePrice(asset.averagePrice.toString());
    } else {
      setTicker('');
      setName('');
      setType('stock');
      setTargetAllocation('');
      setShares('0');
      setAveragePrice('0');
    }
  }, [asset, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !name.trim() || !targetAllocation) return;

    setIsSubmitting(true);
    try {
      const normalizedTicker = normalizeTickerForStorage(ticker, type);

      const normalizedName = name.trim().toUpperCase();

      await onSubmit({
        portfolioId,
        ticker: normalizedTicker,
        name: normalizedName,
        type,
        targetAllocation: parseFloat(targetAllocation),
        shares: parseFloat(shares) || 0,
        averagePrice: parseFloat(averagePrice) || 0,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Editar Ativo' : 'Novo Ativo'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Atualize os dados do ativo.'
                : 'Adicione um novo ativo à carteira.'}
            </DialogDescription>
          </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="ticker">{type === 'investment_fund' ? 'CNPJ do Fundo' : 'Ticker'}</Label>
                  <Input
                    id="ticker"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    placeholder={type === 'investment_fund' ? 'Ex: 12.345.678/0001-90' : 'Ex: PETR4'}
                    required
                  />
                </div>

              <div className="grid gap-2">
                <Label htmlFor="type">Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as Asset['type'])}>
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Nome</Label>
              <div className="relative">
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Petrobras PN"
                  required
                />
                {isLoadingName && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="targetAllocation">Alocação Alvo na Carteira (%)</Label>
              <Input
                id="targetAllocation"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={targetAllocation}
                onChange={(e) => setTargetAllocation(e.target.value)}
                placeholder="Ex: 10"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="shares">Quantidade</Label>
                <Input
                  id="shares"
                  type="number"
                  min="0"
                  step="0.00000001"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="averagePrice">Preço Médio (R$)</Label>
                <Input
                  id="averagePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={averagePrice}
                  onChange={(e) => setAveragePrice(e.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : isEditing ? 'Atualizar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
