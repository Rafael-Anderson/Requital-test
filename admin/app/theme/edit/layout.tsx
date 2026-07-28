import BackButton from "@/components/ui/BackButton";
import ThemeTabs from "@/components/ThemeTabs";

// The actual tabbed editor (Site Settings / Appearance Color / Advanced) —
// nested under the plain admin-role-guard layout at /theme/layout.tsx.
export default function ThemeEditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <BackButton href="/theme" />
      <h1 className="text-2xl font-semibold mb-1">Edit theme</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Controls what customers see on your storefront. The admin panel itself always stays teal.
      </p>
      <ThemeTabs />
      {children}
    </div>
  );
}
