import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";

// Payment and Delivery Providers settings both moved to the new
// Integrations app — this replaces their old Settings pages so an existing
// bookmark/link lands on a real, explanatory page rather than a 404 (per
// the migration notes: "leave a pointer in Settings"). Not a redirect —
// the old page still resolves, just to this instead of the moved content.
export default function MovedToIntegrations({ href }: { href: string }) {
  return (
    <PageShell variant="form">
      <Card className="text-center py-10">
        <p className="text-sm font-medium text-text-secondary dark:text-zinc-300">
          Payment and integration settings have moved to Integrations.
        </p>
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text dark:text-accent hover:underline"
        >
          Go to Integrations
          <ArrowRight className="size-3.5" />
        </Link>
      </Card>
    </PageShell>
  );
}
