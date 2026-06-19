 import { useMemo, useState } from "react";
import { Blur } from "@/components/ui/blur";
 import { useNavigate } from "react-router-dom";
 import { motion } from "framer-motion";
 import { Card } from "@/components/ui/card";
 import { Input } from "@/components/ui/input";
 import { Button } from "@/components/ui/button";
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from "@/components/ui/select";
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from "@/components/ui/table";
 import { Badge } from "@/components/ui/badge";
 import { Search, ArrowUpDown, TrendingUp, TrendingDown } from "lucide-react";
 import type { PortfolioWithAssets } from "@/hooks/usePortfolios";
 import { computeAssetDayGain } from "@/lib/portfolio-summary";
 
 interface AssetsGainsTableProps {
   portfolios: PortfolioWithAssets[];
 }
 
 type SortField = "ticker" | "value" | "dayGain" | "dayGainPercent" | "totalGain" | "allocation";
 type SortDirection = "asc" | "desc";
 const INITIAL_VISIBLE_ROWS = 80;
 
 const typeLabels: Record<string, string> = {
   stock: "Ação",
   reit: "FII",
   etf: "ETF",
   fixed_income: "Renda Fixa",
   crypto: "Cripto",
   international: "Internacional",
   investment_fund: "Fundo",
 };
 
 export function AssetsGainsTable({ portfolios }: AssetsGainsTableProps) {
   const navigate = useNavigate();
   const [searchText, setSearchText] = useState("");
   const [selectedPortfolio, setSelectedPortfolio] = useState<string>("all");
   const [sortField, setSortField] = useState<SortField>("dayGain");
   const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
   const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);
 
   // Calculate total value for allocation
   const totalValue = useMemo(() => {
     return portfolios.reduce((sum, p) => sum + p.currentValue, 0);
   }, [portfolios]);
 
   // Flatten all assets with portfolio info
   const allAssets = useMemo(() => {
     const assets = portfolios.flatMap((portfolio) =>
       portfolio.assets.map((asset) => {
         const dayGainPercent = Number.isFinite(asset.priceChangePercent) ? asset.priceChangePercent : 0;
         const dayGain = computeAssetDayGain(asset);
        const dayGainNumber = Number.isFinite(dayGain) ? dayGain : 0;
         const allocation = totalValue > 0 ? (asset.currentValue / totalValue) * 100 : 0;
 
         return {
           id: asset.id,
           ticker: asset.ticker,
           name: asset.name,
           type: asset.type,
           portfolioId: portfolio.id,
           portfolioName: portfolio.name,
           portfolioColor: portfolio.color,
           shares: asset.shares,
           currentPrice: asset.currentPrice,
           averagePrice: asset.averagePrice,
          currentValue: asset.currentValue,
          dayGain: dayGainNumber,
           dayGainPercent,
           totalGain: asset.gain,
           totalGainPercent: asset.gainPercent,
           allocation,
         };
       })
     );
     return assets;
   }, [portfolios, totalValue]);
 
   // Filter assets
   const filteredAssets = useMemo(() => {
     let filtered = allAssets;
 
     // Filter by portfolio
     if (selectedPortfolio !== "all") {
       filtered = filtered.filter((a) => a.portfolioId === selectedPortfolio);
     }
 
     // Filter by search text
     if (searchText.trim()) {
       const search = searchText.toLowerCase();
       filtered = filtered.filter(
         (a) =>
           a.ticker.toLowerCase().includes(search) ||
           a.name.toLowerCase().includes(search)
       );
     }
 
     return filtered;
   }, [allAssets, selectedPortfolio, searchText]);
 
   // Sort assets
   const sortedAssets = useMemo(() => {
     const sorted = [...filteredAssets];
     sorted.sort((a, b) => {
       let valA: number | string = 0;
       let valB: number | string = 0;
 
       switch (sortField) {
         case "ticker":
           valA = a.ticker;
           valB = b.ticker;
           break;
         case "value":
           valA = a.currentValue;
           valB = b.currentValue;
           break;
         case "dayGain":
           valA = a.dayGain;
           valB = b.dayGain;
           break;
         case "dayGainPercent":
           valA = a.dayGainPercent;
           valB = b.dayGainPercent;
           break;
         case "totalGain":
           valA = a.totalGain;
           valB = b.totalGain;
           break;
         case "allocation":
           valA = a.allocation;
           valB = b.allocation;
           break;
       }
 
       if (typeof valA === "string") {
         return sortDirection === "asc"
           ? valA.localeCompare(valB as string)
           : (valB as string).localeCompare(valA);
       }
 
      const numA = Number(valA);
      const numB = Number(valB);
      return sortDirection === "asc" ? numA - numB : numB - numA;
     });
     return sorted;
   }, [filteredAssets, sortField, sortDirection]);

   const visibleAssets = useMemo(
     () => sortedAssets.slice(0, visibleRows),
     [sortedAssets, visibleRows]
   );
 
   const toggleSort = (field: SortField) => {
     if (sortField === field) {
       setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
     } else {
       setSortField(field);
       setSortDirection("desc");
     }
     setVisibleRows(INITIAL_VISIBLE_ROWS);
   };
 
   const formatCurrency = (value: number) =>
     new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

   const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

   return (
     <motion.div
       initial={{ opacity: 0, y: 20 }}
       animate={{ opacity: 1, y: 0 }}
       transition={{ duration: 0.3, delay: 0.3 }}
     >
       <Card className="p-4 sm:p-6">
         <div className="space-y-4">
           {/* Header */}
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
             <h2 className="text-lg font-semibold">Ganhos Diários por Ativo</h2>
             <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
               {/* Search */}
               <div className="relative flex-1 sm:w-48">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                 <Input
                   placeholder="Buscar ticker/nome..."
                   value={searchText}
                   onChange={(e) => setSearchText(e.target.value)}
                   className="pl-9"
                 />
               </div>
 
               {/* Portfolio filter */}
               <Select value={selectedPortfolio} onValueChange={setSelectedPortfolio}>
                 <SelectTrigger className="w-full sm:w-40">
                   <SelectValue placeholder="Carteira" />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todas</SelectItem>
                   {portfolios.map((p) => (
                     <SelectItem key={p.id} value={p.id}>
                       {p.name}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
           </div>
 
           {/* Table */}
           <div className="rounded-md border overflow-x-auto">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("ticker")}
                       className="h-8 px-2 lg:px-3"
                     >
                       Ativo
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                   <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                   <TableHead className="hidden lg:table-cell">Carteira</TableHead>
                   <TableHead className="text-right hidden md:table-cell">Qtd</TableHead>
                   <TableHead className="text-right hidden md:table-cell">Preço</TableHead>
                   <TableHead className="text-right">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("value")}
                       className="h-8 px-2 lg:px-3 ml-auto"
                     >
                       Valor
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                   <TableHead className="text-right">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("dayGainPercent")}
                       className="h-8 px-2 lg:px-3 ml-auto"
                     >
                       % Dia
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                   <TableHead className="text-right">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("dayGain")}
                       className="h-8 px-2 lg:px-3 ml-auto"
                     >
                       R$ Dia
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                   <TableHead className="text-right hidden lg:table-cell">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("totalGain")}
                       className="h-8 px-2 lg:px-3 ml-auto"
                     >
                       Lucro Total
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                   <TableHead className="text-right hidden xl:table-cell">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => toggleSort("allocation")}
                       className="h-8 px-2 lg:px-3 ml-auto"
                     >
                       Alocação
                       <ArrowUpDown className="ml-1 h-3 w-3" />
                     </Button>
                   </TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {sortedAssets.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                       Nenhum ativo encontrado
                     </TableCell>
                   </TableRow>
                 ) : (
                   visibleAssets.map((asset) => (
                     <TableRow
                       key={asset.id}
                       className="cursor-pointer hover:bg-muted/50"
                       onClick={() => navigate(`/portfolio/${asset.portfolioId}`)}
                     >
                       <TableCell className="font-medium">
                         <div className="flex flex-col">
                           <span className="font-semibold">{asset.ticker}</span>
                           <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                             {asset.name}
                           </span>
                         </div>
                       </TableCell>
                       <TableCell className="hidden sm:table-cell">
                         <Badge variant="outline" className="text-xs">
                           {typeLabels[asset.type] || asset.type}
                         </Badge>
                       </TableCell>
                       <TableCell className="hidden lg:table-cell">
                         <div className="flex items-center gap-2">
                           <div
                             className="w-2 h-2 rounded-full shrink-0"
                             style={{ backgroundColor: asset.portfolioColor }}
                           />
                           <span className="text-sm truncate max-w-[100px]">{asset.portfolioName}</span>
                         </div>
                       </TableCell>
                       <TableCell className="text-right text-sm hidden md:table-cell">
                         <Blur>{asset.shares.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</Blur>
                       </TableCell>
                       <TableCell className="text-right text-sm hidden md:table-cell">
                         <Blur>{formatCurrency(asset.currentPrice)}</Blur>
                       </TableCell>
                       <TableCell className="text-right font-medium">
                         <Blur>{formatCurrency(asset.currentValue)}</Blur>
                       </TableCell>
                       <TableCell
                         className={`text-right font-semibold ${
                           asset.dayGainPercent >= 0 ? "text-green-600" : "text-red-600"
                         }`}
                       >
                         <div className="flex items-center justify-end gap-1">
                           {asset.dayGainPercent >= 0 ? (
                             <TrendingUp className="h-3 w-3" />
                           ) : (
                             <TrendingDown className="h-3 w-3" />
                           )}
                           {formatPercent(asset.dayGainPercent)}
                         </div>
                       </TableCell>
                       <TableCell
                         className={`text-right font-semibold ${
                           asset.dayGain >= 0 ? "text-green-600" : "text-red-600"
                         }`}
                       >
                         <Blur>{formatCurrency(asset.dayGain)}</Blur>
                       </TableCell>
                       <TableCell
                         className={`text-right font-medium hidden lg:table-cell ${
                           asset.totalGain >= 0 ? "text-green-600" : "text-red-600"
                         }`}
                       >
                         <div className="flex flex-col items-end">
                           <Blur>{formatCurrency(asset.totalGain)}</Blur>
                           <span className="text-xs">{formatPercent(asset.totalGainPercent)}</span>
                         </div>
                       </TableCell>
                       <TableCell className="text-right text-sm hidden xl:table-cell">
                         <Blur>{asset.allocation.toFixed(1)}%</Blur>
                       </TableCell>
                     </TableRow>
                   ))
                 )}
               </TableBody>
             </Table>
           </div>
 
           {/* Summary */}
           {sortedAssets.length > 0 && (
             <div className="flex flex-wrap gap-4 text-sm border-t pt-4">
               <div className="flex items-center gap-2">
                 <span className="text-muted-foreground">Total de ativos:</span>
                 <span className="font-semibold">{sortedAssets.length}</span>
               </div>
               <div className="flex items-center gap-2">
                 <span className="text-muted-foreground">Ganho do dia:</span>
                 <span
                   className={`font-semibold ${
                     sortedAssets.reduce((sum, a) => sum + a.dayGain, 0) >= 0
                       ? "text-green-600"
                       : "text-red-600"
                   }`}
                 >
                   <Blur>{formatCurrency(sortedAssets.reduce((sum, a) => sum + a.dayGain, 0))}</Blur>
                 </span>
               </div>
               {visibleRows < sortedAssets.length && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => setVisibleRows((current) => current + INITIAL_VISIBLE_ROWS)}
                 >
                   Mostrar mais {Math.min(INITIAL_VISIBLE_ROWS, sortedAssets.length - visibleRows)}
                 </Button>
               )}
             </div>
           )}
         </div>
       </Card>
     </motion.div>
   );
 }
