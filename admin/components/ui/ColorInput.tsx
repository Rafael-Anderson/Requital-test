"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

// A bare <input type="color"> renders a browser-default inset padding
// around its actual swatch (::-webkit-color-swatch-wrapper in Chromium,
// ::-moz-color-swatch in Firefox) — every existing color-picker usage in
// this app only styled the outer input box (size, rounded corners, border),
// leaving a visible gap between that border and the color fill, i.e. a box
// inside a box. Resetting those pseudo-elements' own padding/border here is
// the actual fix; wrapping it in one shared component (matching Input.tsx's
// own pattern) is what makes every usage across the admin update from a
// single place instead of needing the same className repeated at each
// call site — and re-drifting the next time one of them is edited.
// `swatchSize`, not `size` — the native <input> element already has its own
// `size` HTML attribute (a number, unrelated meaning), so reusing that name
// here would collide with InputHTMLAttributes's own typing.
interface ColorInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  swatchSize?: "sm" | "md";
}

const SIZE_CLASS: Record<NonNullable<ColorInputProps["swatchSize"]>, string> = {
  sm: "size-7",
  md: "size-8",
};

const ColorInput = forwardRef<HTMLInputElement, ColorInputProps>(function ColorInput(
  { swatchSize = "md", className = "", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="color"
      // dark:border-white/30, not the usual /15 every other bordered control
      // in this app uses — a near-black swatch fill (a merchant's real dark
      // header/footer colors) sits right next to a dark card background, and
      // /15 white wasn't enough contrast to tell where the swatch actually
      // is. Light mode's border-black/15 doesn't have this problem (a dark
      // swatch fill still contrasts against a light card), so only the dark
      // variant needed bumping.
      className={`${SIZE_CLASS[swatchSize]} shrink-0 rounded-md border border-black/15 dark:border-white/30 cursor-pointer bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-[inherit] [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-[inherit] ${className}`}
      {...props}
    />
  );
});

export default ColorInput;
