// Self-contained loading indicator, sized via a size prop rather than each
// call site hand-rolling its own `animate-spin` border classes. Uses
// `border-current` so it inherits whatever text color the parent already
// has (e.g. white on a primary button, zinc-400 on a bare page) instead of
// needing its own color prop.
const SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-5 border-2",
  lg: "size-8 border-2",
};

export default function Spinner({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent ${SIZE_CLASS[size]} ${className}`}
    />
  );
}
