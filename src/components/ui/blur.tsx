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
        'transition-[filter] duration-200',
        privacyMode && 'blur-sm select-none',
        className,
      )}
    >
      {children}
    </span>
  );
}
