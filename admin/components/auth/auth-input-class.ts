// Borderless, filled inputs for the redesigned auth screens (AuthCard) —
// overrides Input.tsx's own default border+white-bg classes via the
// `!important` prefix, since Input.tsx is shared everywhere else in the
// admin app and keeps its normal bordered look there; plain (non-`!`)
// classes passed through Input's `className` prop aren't guaranteed to win
// over its hardcoded ones (Tailwind's cascade follows generated-stylesheet
// order, not the order classes appear in a className string), so an
// unprefixed override would be unreliable here.
//
// Light-mode fill is a custom cool grey (#e7edee), not plain zinc-100 —
// zinc-100 sits too close to the card's white to read as a distinct filled
// field (only ~4% luminance apart); this pulls it further from white while
// keeping a slight teal cast that ties it to the brand accent rather than a
// neutral grey. Text contrast is unaffected either way (zinc-900 on either
// tone is >14:1) — this is about input-vs-card separation, not legibility.
export const AUTH_INPUT_CLASS =
  "!rounded-lg !border-none !shadow-none !bg-[#e7edee] dark:!bg-white/[0.06] !text-zinc-900 dark:!text-white placeholder:!text-zinc-400 dark:placeholder:!text-zinc-500";
