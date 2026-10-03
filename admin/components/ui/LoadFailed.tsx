import Button from "@/components/ui/Button";

// What a list shows when its request failed before any row arrived: say so and
// offer a retry. Without it a page that only renders `rows === null` as a
// skeleton stays on the skeleton forever once the request has errored.
export default function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="scroll-fade-fill flex flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-[13.5px] text-text-faint dark:text-zinc-400">Could not load {what}.</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
