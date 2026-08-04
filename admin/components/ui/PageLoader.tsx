import Spinner from "./Spinner";

// Full-viewport loading state for the initial auth check (RequireAuth) —
// replaces a blank white screen with the same brand wordmark TopBar uses,
// so the app never appears to hang or flash empty before content is ready.
export default function PageLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-background">
      <span className="text-lg font-bold tracking-tight">Requital</span>
      <Spinner size="md" className="text-zinc-400 dark:text-zinc-600" />
    </div>
  );
}
