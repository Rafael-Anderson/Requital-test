// A wa.me link with the message prefilled (shop name, total, link), addressed to
// the customer's number when there is one. wa.me takes digits only.
export function whatsappShareUrl(phone: string | null, message: string): string {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
