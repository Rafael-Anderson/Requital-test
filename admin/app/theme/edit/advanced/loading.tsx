import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SettingsCardsSkeleton cards={6} fieldsPerCard={2} />;
}
