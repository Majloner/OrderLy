import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  // The call-to-action button; callers keep their own icon/label/handler.
  children?: ReactNode;
}

// The dashed empty state repeated across the three managers, collapsed here.
export function EmptyState({ message, children }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center">
      <p className="text-white/70">{message}</p>
      {children}
    </div>
  );
}
