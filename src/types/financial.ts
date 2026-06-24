/**
 * Financial data types - stored encrypted locally only
 * Zero-knowledge: these types NEVER touch the backend
 */

export interface Portfolio {
  id: string;
  name: string;
  description?: string;
  targetAllocation: number; // percentage
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Asset {
  id: string;
  portfolioId: string;
  ticker: string;
  name: string;
  type: 'stock' | 'reit' | 'etf' | 'fixed_income' | 'crypto' | 'international' | 'investment_fund';
  targetAllocation: number; // percentage within portfolio
  shares: number;
  averagePrice: number;
  createdAt: number;
  updatedAt: number;
}

export interface Transaction {
  id: string;
  assetId: string;
  portfolioId: string;
  type: 'buy' | 'sell';
  shares: number;
  pricePerShare: number;
  totalValue: number;
  fees: number;
  date: number;
  notes?: string;
  createdAt: number;
}

export type CorporateActionType =
  | 'split'
  | 'reverse_split'
  | 'bonus'
  | 'amortization'
  | 'subscription'
  | 'ticker_change'
  | 'merger';

export interface CorporateAction {
  id: string;
  portfolioId: string;
  assetId: string;
  destinationAssetId?: string;
  type: CorporateActionType;
  date: number;
  ratioNumerator?: number;
  ratioDenominator?: number;
  quantityChange?: number;
  costBasisChange?: number;
  cashValue?: number;
  cashMovementId?: string;
  status: 'applied' | 'pending';
  sourceImportedMovementId?: string;
  notes?: string;
  createdAt: number;
}

export type ImportedMovementClassification =
  | 'accounting'
  | 'corporate_action'
  | 'informational'
  | 'pending';

export interface ImportedMovement {
  id: string;
  source: 'b3_negotiation' | 'b3_movement' | 'spreadsheet';
  fingerprint: string;
  rawDescription: string;
  movementType: string;
  direction?: string;
  productName?: string;
  ticker?: string;
  date: number;
  quantity: number;
  unitPrice: number;
  value: number;
  classification: ImportedMovementClassification;
  suggestedCorporateActionType?: CorporateActionType;
  reason: string;
  status: 'applied' | 'informational' | 'pending';
  linkedRecordIds: string[];
  createdAt: number;
}

export interface CashMovement {
  id: string;
  portfolioId: string;
  type: 'deposit' | 'withdraw';
  value: number;
  date: number;
  notes?: string;
  createdAt: number;
}

export interface Dividend {
  id: string;
  assetId: string;
  portfolioId: string;
  type: 'dividend' | 'jcp' | 'yield' | 'bonus' | 'stock_lending';
  valuePerShare: number;
  shares: number;
  totalValue: number;
  grossValue: number;
  taxWithheld: number;
  paymentDate: number;
  exDate?: number;
  createdAt: number;
}

export interface UserSettings {
  id: string;
  theme: 'light' | 'dark' | 'system';
  currency: string;
  language: string;
  notifications: {
    dividends: boolean;
    rebalance: boolean;
    taxReminders: boolean;
    priceAlerts: boolean;
  };
  /**
   * Regras opcionais para ajustar o preço médio (custo) ao registrar proventos.
   * - FIIs: "yield" pode reduzir custo (custo líquido)
   * - JCP: opcional (depende do seu método)
   */
  averagePriceAdjustments?: {
    fiiYieldReducesCost: boolean;
    jcpReducesCost: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

export interface EncryptionMetadata {
  id: string;
  salt: string; // Base64 encoded salt for key derivation
  version: number;
  createdAt: number;
}

// Aggregated data for display (computed client-side)
export interface PortfolioSummary extends Portfolio {
  currentValue: number;
  currentAllocation: number;
  totalGain: number;
  totalGainPercent: number;
  assets: AssetSummary[];
}

export interface AssetSummary extends Asset {
  currentPrice: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
  currentAllocation: number;
  allocationDiff: number;
}

export interface DashboardMetrics {
  totalPatrimony: number;
  dailyChange: number;
  dailyChangePercent: number;
  totalReturn: number;
  totalReturnPercent: number;
  monthlyContribution: number;
  totalDividends: number;
}
