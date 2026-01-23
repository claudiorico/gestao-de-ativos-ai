import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { useFirebaseAuth } from "@/contexts/FirebaseAuthContext";
import { FirebaseLoginScreen } from "./FirebaseLoginScreen";

interface FirebaseAuthGuardProps {
  children: React.ReactNode;
}

export function FirebaseAuthGuard({ children }: FirebaseAuthGuardProps) {
  const { isLoading, isAuthenticated } = useFirebaseAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <Shield className="h-12 w-12 text-primary" />
        </motion.div>
        <p className="mt-4 text-muted-foreground">Verificando sessão...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <FirebaseLoginScreen />;
  }

  return <>{children}</>;
}
