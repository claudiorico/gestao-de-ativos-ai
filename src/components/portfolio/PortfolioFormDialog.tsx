import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import type { Portfolio } from '@/types/financial';

const COLORS = [
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#6366F1', // Indigo
];

interface PortfolioFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolio?: Portfolio | null;
  onSubmit: (data: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}

export function PortfolioFormDialog({
  open,
  onOpenChange,
  portfolio,
  onSubmit,
}: PortfolioFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetAllocation, setTargetAllocation] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!portfolio;

  useEffect(() => {
    if (portfolio) {
      setName(portfolio.name);
      setDescription(portfolio.description || '');
      setTargetAllocation(portfolio.targetAllocation.toString());
      setColor(portfolio.color);
    } else {
      setName('');
      setDescription('');
      setTargetAllocation('');
      setColor(COLORS[0]);
    }
  }, [portfolio, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetAllocation) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        targetAllocation: parseFloat(targetAllocation),
        color,
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
              {isEditing ? 'Editar Carteira' : 'Nova Carteira'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Atualize os dados da carteira.'
                : 'Crie uma nova carteira para organizar seus investimentos.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Renda Variável"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Ações e ETFs brasileiros"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="targetAllocation">Alocação Alvo (%)</Label>
              <Input
                id="targetAllocation"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={targetAllocation}
                onChange={(e) => setTargetAllocation(e.target.value)}
                placeholder="Ex: 35"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? 'hsl(var(--foreground))' : 'transparent',
                      transform: color === c ? 'scale(1.1)' : 'scale(1)',
                    }}
                  />
                ))}
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
              {isSubmitting ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
