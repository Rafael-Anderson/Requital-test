import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SettingsCardsSkeleton cards={2} fieldsPerCard={3} />;
}
