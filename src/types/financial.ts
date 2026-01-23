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
  type: 'dividend' | 'jcp' | 'yield' | 'bonus';
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
