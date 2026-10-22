// F9: the shopper's Google Maps was unavailable, so this delivery order has a
// typed address and no map pin. Shown on the board card (compact) and in the
// order detail (full sentence, matching the packing slip's wording).
export const ADDRESS_UNVERIFIED_MESSAGE = "Address not verified on a map, please confirm with the customer";

export default function AddressUnverifiedNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span
        title={ADDRESS_UNVERIFIED_MESSAGE}
        className="inline-block rounded-md bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300"
      >
        Address not verified
      </span>
    );
  }
  return (
    <p role="note" className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-300">
      {ADDRESS_UNVERIFIED_MESSAGE}
    </p>
  );
}
