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
      <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-red-100">
        <p>{message}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
          Spróbuj ponownie
        </Button>
      </div>
    );
  }
  return <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{message}</p>;
}
