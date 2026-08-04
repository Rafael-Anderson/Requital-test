import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SettingsCardsSkeleton cards={5} fieldsPerCard={1} />;
}
