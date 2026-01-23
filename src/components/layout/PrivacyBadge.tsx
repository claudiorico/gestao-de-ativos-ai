/**
 * Privacy Badge - Visual indicator of zero-knowledge status
 */

import { Shield, Lock, Database } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function PrivacyBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 rounded-full bg-success-muted px-3 py-1.5 cursor-help"
        >
          <Shield className="h-3.5 w-3.5 text-success" />
          <span className="text-xs font-medium text-success">Zero-Knowledge</span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Shield className="h-4 w-4 text-success" />
            Arquitetura Zero-Knowledge
          </div>
          <div className="space-y-1 text-muted-foreground">
            <div className="flex items-center gap-2">
              <Lock className="h-3 w-3" />
              Dados criptografados localmente (AES-256)
            </div>
            <div className="flex items-center gap-2">
              <Database className="h-3 w-3" />
              Armazenados apenas no seu dispositivo
            </div>
          </div>
          <p className="text-xs text-muted-foreground/80 pt-1 border-t border-border">
            Nenhum servidor tem acesso aos seus dados financeiros
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
