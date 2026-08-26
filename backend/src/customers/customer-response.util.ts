import type { CustomerRow } from '../db/types';

// The one place a `customer` DB row is allowed to become part of an API
// response. CustomerRow carries passwordHash/failedLoginAttempts/
// lastFailedLoginAt (customer-auth internals) alongside the fields an admin
// actually needs to see — spreading the raw row (as findOne/update both did
// before this file existed) leaks the bcrypt hash straight into the JSON
// response. Every response-shaping method in this module must build its
// object through this function rather than `{ ...customer, ... }`.
export interface SafeCustomer {
  id: number;
  shopId: number;
  name: string;
  phone: string;
  email: string | null;
  birthday: Date | null;
  createdAt: Date;
}

export function toSafeCustomer(row: CustomerRow): SafeCustomer {
  return {
    id: row.id,
    shopId: row.shopId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    birthday: row.birthday,
    createdAt: row.createdAt,
  };
}
