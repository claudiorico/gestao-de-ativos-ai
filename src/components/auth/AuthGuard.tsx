/**
 * Auth Guard - Ensures user is logged in with Google before accessing the app
 * Flow: Google Login -> Vault Setup/Unlock -> App Content
 */

import { useState, useEffect } from 'react';
import { useGoogleUser } from '@/contexts/GoogleUserContext';
import { GoogleLoginScreen } from './GoogleLoginScreen';
import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import {
  checkPendingOAuthToken,
  getPendingClientId,
  clearPendingClientId,
  getGoogleDriveConfig,
} from '@/lib/google-drive';
import { useSearchParams, useNavigate } from 'react-router-dom';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isConnected, isLoading, login } = useGoogleUser();
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Handle OAuth callback from redirect flow
  useEffect(() => {
    const oauthParam = searchParams.get('oauth');
    
    if (oauthParam === 'success') {
      setIsProcessingCallback(true);
      
      const processToken = async () => {
        try {
          const pendingClientId = getPendingClientId();
          
          if (pendingClientId) {
            const success = await checkPendingOAuthToken(pendingClientId);
            
            if (success) {
              clearPendingClientId();
              
              // Login with the new token
              const config = getGoogleDriveConfig();
              if (config?.accessToken && config.expiresAt) {
                const expiresIn = Math.floor((config.expiresAt - Date.now()) / 1000);
                await login(config.accessToken, expiresIn);
              }
            }
          }
        } catch (error) {
          console.error('[AuthGuard] Error processing OAuth callback:', error);
        } finally {
          setIsProcessingCallback(false);
          // Clean URL
          navigate(window.location.pathname, { replace: true });
        }
      };
      
      processToken();
    }
  }, [searchParams, navigate, login]);

  // Loading state
  if (isLoading || isProcessingCallback) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
          <p className="text-muted-foreground">
            {isProcessingCallback ? 'Processando login...' : 'Verificando sessão...'}
          </p>
        </motion.div>
      </div>
    );
  }

  // Not logged in - show Google login screen
  if (!isConnected) {
    return (
      <GoogleLoginScreen 
        onLoginSuccess={() => {
          // Force reload to reinitialize with new user namespace
          window.location.reload();
        }} 
      />
    );
  }

  // User is authenticated, render children (which will include VaultGuard)
  return <>{children}</>;
}
