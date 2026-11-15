import { BadRequestException } from '@nestjs/common';

// A separate RECEIVER on an order (the person who gets it, when that is not the
// customer). NULL/NULL on the order means "the customer is the receiver"; nothing
// is ever defaulted from the customer columns, so an order's own two columns are
// the whole truth (capture-time, like the customer name and phone beside them).
//
// One rule for every write path: both or neither. Whitespace is trimmed, and a
// blank value counts as absent, so a form that sends "" for an unticked block
// stores NULL, never an empty string.
export interface OrderReceiver {
  name: string;
  phone: string;
}

export function resolveOrderReceiver(input: {
  receiverName?: string | null;
  receiverPhone?: string | null;
}): OrderReceiver | null {
  const name = (input.receiverName ?? '').trim();
  const phone = (input.receiverPhone ?? '').trim();
  if (!name && !phone) return null;
  if (!name || !phone) {
    throw new BadRequestException(
      'receiverName and receiverPhone must be sent together',
    );
  }
  return { name, phone };
}

// What the receiver is called on a document or a screen where one person is
// named as the contact: the receiver when set, else the customer.
export interface ContactRow {
  customerName: string;
  customerPhone: string;
  receiverName?: string | null;
  receiverPhone?: string | null;
}

export function contactFor(order: ContactRow): { name: string; phone: string; isReceiver: boolean } {
  if (order.receiverName && order.receiverPhone) {
    return {
      name: order.receiverName,
      phone: order.receiverPhone,
      isReceiver: true,
    };
  }
  return {
    name: order.customerName,
    phone: order.customerPhone,
    isReceiver: false,
  };
}
