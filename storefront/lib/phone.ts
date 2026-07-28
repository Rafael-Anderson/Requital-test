// Keeps only digits, spaces, hyphens, and a single leading "+" — mirrors the
// server-side CreatePublicOrderDto.customerPhone pattern exactly, so nothing
// a customer can type here fails validation only after submitting.
export function sanitizePhoneInput(raw: string): string {
  const leadingPlus = raw.startsWith("+") ? "+" : "";
  const rest = raw.replace(/\+/g, "").replace(/[^0-9\s-]/g, "");
  return leadingPlus + rest;
}
