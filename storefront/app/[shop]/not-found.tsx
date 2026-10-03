import NotFoundContent from "@/components/NotFoundContent";

// Rendered inside the [shop] layout (so ShopProvider is available) whenever a
// route under /[shop] calls notFound() or matches nothing (see [...rest]).
export default function ShopNotFound() {
  return <NotFoundContent />;
}
