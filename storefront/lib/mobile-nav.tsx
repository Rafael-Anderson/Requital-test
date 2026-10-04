"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

// SearchBar listens for this; the bottom-bar "Search" tab dispatches it.
export const OPEN_SEARCH_EVENT = "requital:open-search";

interface MobileNavContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  // The hamburger, so focus returns to it when the panel closes (Safari does not focus a
  // button on click, so "the element focused before opening" is not always the trigger).
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

// The hamburger lives in the header row (ThemeDrivenHeader renders it in flow, so it can never
// cover the logo) while the panel is portalled to <body> by MobileNav: the two are siblings in
// different trees, so the open state is shared through this small context, like the cart drawer's.
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const value = useMemo(() => ({ open, setOpen, triggerRef }), [open]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

// Tolerant of a missing provider (a header rendered in a test or a preview tree without one):
// the trigger is simply inert, same convention as useWishlist().
export function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  const fallbackRef = useRef<HTMLButtonElement | null>(null);
  return ctx ?? { open: false, setOpen: () => {}, triggerRef: fallbackRef };
}
