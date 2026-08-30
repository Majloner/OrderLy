import { Button } from "@/components/ui/button";

interface ErrorPanelProps {
  message: string;
  // With onRetry this is the full-screen initial-load error; without it, the
  // inline action banner. Six copies across the three managers collapsed here.
  onRetry?: () => void;
}

export function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  if (onRetry) {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-2xl border p-6">
        <p>{message}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
          Spróbuj ponownie
        </Button>
      </div>
    );
  }
  return (
    <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
      {message}
    </p>
  );
}
