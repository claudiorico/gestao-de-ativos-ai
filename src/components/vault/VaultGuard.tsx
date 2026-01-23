/**
 * Vault Guard - Wrapper that ensures vault is unlocked before showing content
 * This runs AFTER FirebaseAuthGuard ensures the user is logged in
 */

import { useState, useEffect } from 'react';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { useFirebaseAuth } from '@/contexts/FirebaseAuthContext';
import { VaultSetup } from './VaultSetup';
import { VaultUnlock } from './VaultUnlock';
import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface VaultGuardProps {
  children: React.ReactNode;
}

export function VaultGuard({ children }: VaultGuardProps) {
  const { isInitialized, isUnlocked, isLoading } = useSecureStorage();
  const { user } = useFirebaseAuth();
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!isLoading && !isInitialized) {
      setShowSetup(true);
    }
  }, [isLoading, isInitialized]);

  // User info component for vault screens
  const UserBadge = () => {
    if (!user) return null;
    
    return (
      <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5 shadow-sm">
        <Avatar className="h-6 w-6">
          <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User'} />
          <AvatarFallback className="text-xs">
            {user.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground max-w-[150px] truncate">
          {user.displayName || user.email?.split('@')[0]}
        </span>
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative">
        <UserBadge />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
          >
            <Shield className="h-8 w-8 text-primary" />
          </motion.div>
          <p className="text-muted-foreground">Carregando cofre seguro...</p>
          {user && (
            <p className="text-xs text-muted-foreground mt-2">
              Conta: {user.email}
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  // Setup flow for new users
  if (showSetup || !isInitialized) {
    return (
      <div className="relative">
        <UserBadge />
        <VaultSetup
          onComplete={() => setShowSetup(false)}
        />
      </div>
    );
  }

  // Unlock flow for returning users
  if (!isUnlocked) {
    return (
      <div className="relative">
        <UserBadge />
        <VaultUnlock
          onUnlock={() => {}}
          onReset={() => setShowSetup(true)}
        />
      </div>
    );
  }

  // Vault is unlocked, show the app
  return <>{children}</>;
}
