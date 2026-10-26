import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SettingsCardsSkeleton cards={3} fieldsPerCard={2} />;
}
