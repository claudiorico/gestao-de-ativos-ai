import { cn } from '@/lib/utils';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';

interface BlurProps {
  children: React.ReactNode;
  className?: string;
}

export function Blur({ children, className }: BlurProps) {
  const { privacyMode } = usePrivacyMode();
  return (
    <span
      className={cn(
        'transition-all duration-200',
        privacyMode && 'text-transparent bg-foreground/20 rounded blur-[2px] select-none',
        className,
      )}
    >
      {children}
    </span>
  );
}
