import { motion } from 'framer-motion';
import { Briefcase, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyPortfolioStateProps {
  onCreatePortfolio: () => void;
}

export function EmptyPortfolioState({ onCreatePortfolio }: EmptyPortfolioStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-12 text-center"
    >
      <div className="mb-4 rounded-full bg-muted p-4">
        <Briefcase className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Nenhuma carteira cadastrada
      </h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Comece criando sua primeira carteira para organizar seus investimentos e
        acompanhar suas alocações.
      </p>
      <Button onClick={onCreatePortfolio} className="gap-2">
        <Plus className="h-4 w-4" />
        Criar Primeira Carteira
      </Button>
    </motion.div>
  );
}
