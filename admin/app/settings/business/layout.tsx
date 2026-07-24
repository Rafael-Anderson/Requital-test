import BusinessSettingsSubNav from "@/components/BusinessSettingsSubNav";

export default function BusinessSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-8 flex-col sm:flex-row">
      <BusinessSettingsSubNav />
      <div className="max-w-xl flex-1">{children}</div>
    </div>
  );
}
