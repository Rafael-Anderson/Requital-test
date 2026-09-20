import type { JsonLdObject } from "@/lib/structured-data";

// Server-rendered <script type="application/ld+json">. Deliberately not a
// client component and not injected after mount: the storefront is otherwise a
// client-rendered SPA, and structured data that only exists after hydration is
// structured data most crawlers never see.
//
// JSON.stringify output is escaped for the one character that can break out of
// a <script> block. The data is all merchant-controlled strings (product name,
// description, social links), so this is the same discipline as any other
// dangerouslySetInnerHTML on this surface.
export default function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
