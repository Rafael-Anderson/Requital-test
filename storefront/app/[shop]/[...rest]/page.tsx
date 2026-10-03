import { notFound } from "next/navigation";

// A catch-all that exists only so an unknown URL under /[shop]/... renders the
// shop's own not-found state (app/[shop]/not-found.tsx, inside the shop layout
// and theme) instead of Next's generic root 404, and so that state can report
// the missing path to the merchant's 404 log. Every real route is more
// specific and wins over this.
export default function UnknownRoute() {
  notFound();
}
