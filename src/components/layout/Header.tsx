import { Bell, Search, Sun, Moon, User, Lock, Cloud, HardDrive, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PrivacyBadge } from "./PrivacyBadge";
import { useSecureStorage } from "@/contexts/SecureStorageContext";
import { useFirebaseAuth } from "@/contexts/FirebaseAuthContext";
import { BackupRestoreDialog } from "@/components/backup/BackupRestoreDialog";
import { isGoogleDriveConnected } from "@/lib/google-drive";
import { getSyncStatus } from "@/lib/backup";

export function Header() {
  const [isDark, setIsDark] = useState(false);
  const [syncConnected, setSyncConnected] = useState(false);
  const { lockVault } = useSecureStorage();
  const { user, isAuthenticated, logout } = useFirebaseAuth();

  // Get user initials for avatar fallback
  const getUserInitials = (): string => {
    if (user?.displayName) {
      const parts = user.displayName.split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return user.displayName.substring(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'US';
  };

  useEffect(() => {
    setSyncConnected(isGoogleDriveConnected());
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const syncStatus = getSyncStatus();

  return (
    <header className="flex h-16 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4 lg:px-6">
      {/* Search */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <SidebarTrigger className="shrink-0" />
        <div className="relative hidden w-full max-w-[20rem] lg:block lg:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar ativos, carteiras..."
            className="h-10 w-full border-0 bg-muted/50 pl-10 pr-4 text-sm focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>
        <div className="hidden shrink-0 lg:block">
          <PrivacyBadge />
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Sync Status & Backup */}
        <div className="hidden md:block">
          <BackupRestoreDialog
            trigger={
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-9 w-9 rounded-lg"
                  title={syncConnected ? "Google Drive conectado" : "Backup & Sync"}
                >
                  {syncConnected ? (
                    <Cloud className="h-4 w-4 text-success" />
                  ) : (
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                  )}
                  {syncStatus.autoSyncEnabled && syncConnected && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-success animate-pulse" />
                  )}
                </Button>
              </motion.div>
            }
          />
        </div>

        {/* Lock Vault */}
        <motion.div whileTap={{ scale: 0.95 }} className="hidden sm:block">
          <Button
            variant="ghost"
            size="icon"
            onClick={lockVault}
            className="h-9 w-9 rounded-lg"
            title="Bloquear cofre"
          >
            <Lock className="h-4 w-4 text-muted-foreground" />
          </Button>
        </motion.div>

        {/* Theme Toggle */}
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9 rounded-lg"
            title="Alternar tema"
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </motion.div>

        {/* Notifications */}
        <motion.div whileTap={{ scale: 0.95 }} className="hidden lg:block">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-lg"
            title="Notificações"
          >
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
          </Button>
        </motion.div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-1.5 hover:bg-muted sm:px-2"
            >
              <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/20">
                <AvatarImage 
                  src={user?.photoURL || undefined} 
                  alt={user?.displayName || "Usuário"} 
                  referrerPolicy="no-referrer"
                />
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="hidden min-w-0 flex-col items-start xl:flex">
                <span className="truncate text-sm font-medium">
                  {user?.displayName || 'Usuário'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {isAuthenticated ? user?.email : 'Zero-Knowledge'}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-3 py-3">
              <Avatar className="h-10 w-10">
                <AvatarImage 
                  src={user?.photoURL || undefined} 
                  alt={user?.displayName || "Usuário"} 
                  referrerPolicy="no-referrer"
                />
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium">{user?.displayName || 'Usuário'}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {user?.email || 'Dados criptografados localmente'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem>Configurações</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={lockVault} className="text-warning">
              <Lock className="mr-2 h-4 w-4" />
              Bloquear Cofre
            </DropdownMenuItem>
            {isAuthenticated && (
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
