import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SettingsCardsSkeleton cards={4} fieldsPerCard={2} />;
}
