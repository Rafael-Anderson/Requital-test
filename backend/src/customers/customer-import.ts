// Customers CSV/XLSX import (ONB-1). PURE: no I/O.
//
// THE PHONE RULE (this is the whole point of the module):
//   customer is unique on [shopId, phone] but phones are stored RAW by
//   checkout ("0501234567", "050 123 4567" and "+971501234567" are three rows
//   today). So the import never trusts the spelling:
//    * every phone in the file is normalised to E.164 with the SHOP's country
//      (normalizePhoneToE164(raw, shop.countryCode));
//    * every EXISTING customer's stored phone is normalised the same way and
//      the file is matched against that, so "0501234567" in the file finds
//      the row stored as "+971501234567" and never creates a second person;
//    * a matched row keeps the phone it already has (rewriting it could
//      collide with another row and would change a registered customer's
//      login); a NEW row is stored as E.164, the form the admin editor writes;
//    * the same person twice in the file collapses to one row, and two rows
//      for one phone with different names or emails are a CONFLICT that
//      imports neither (we do not pick a winner);
//    * several existing rows already sharing one normalised phone are a
//      CONFLICT too (the data is already ambiguous: not ours to merge).
//
// CONSENT: nothing here sets, reads or implies marketing consent. A column
// that looks like a marketing flag is ignored and says so. No email is sent.
//
// PII: messages name the row number and the field, never the value. The
// preview shows the name and a masked phone.

import { randomUUID } from 'crypto';
import { normalizePhoneToE164 } from '../common/phone';
import { normaliseHeader } from '../products/platform-import';

export const MAX_CUSTOMER_ROWS = 10_000;
const NAME_MAX = 191;
const ADDRESS_MAX = 500;

const ALIASES = {
  name: [
    'name',
    'full name',
    'customer name',
    'customer',
    'اسم العميل',
    'الاسم',
  ],
  phone: [
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'telephone',
    'tel',
    'رقم الجوال',
    'الجوال',
    'رقم الهاتف',
    'الهاتف',
  ],
  email: ['email', 'e-mail', 'email address', 'البريد الالكتروني', 'البريد'],
  address: ['address', 'address 1', 'street', 'العنوان'],
  area: ['area', 'city', 'المنطقة', 'المدينة'],
  label: ['address label', 'label', 'عنوان التسمية'],
} as const;
type Field = keyof typeof ALIASES;

const CONSENT_HEADER =
  /marketing|newsletter|subscri|consent|opt[\s_-]?in|sms|whatsapp|اشتراك|النشرة|موافقة|تسويق/i;

export class CustomerColumnsError extends Error {
  constructor(readonly missing: Field[]) {
    super(
      `This does not look like a customers file. Missing columns: ${missing
        .map((f) => `${f} (${ALIASES[f].slice(0, 3).join(' / ')})`)
        .join('; ')}`,
    );
  }
}

export interface CustomerRowIn {
  rowNumber: number;
  name: string;
  phone: string | null; // E.164, or null when missing/invalid
  email: string | null;
  address: {
    id: string;
    label?: string;
    address: string;
    area?: string;
  } | null;
  errors: string[];
  warnings: string[];
}

// Arabic-Indic and Persian digits to ASCII, nothing else.
function asciiDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normaliseCustomerPhone(
  raw: string,
  countryCode: string | null,
): string | null {
  const text = asciiDigits(raw.normalize('NFKC'))
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
  if (text === '') return null;
  // A spreadsheet may hand a phone over as 9.71501234567E11. Not recoverable
  // exactly: refuse rather than guess.
  if (/e/i.test(text)) return null;
  // Only the shapes a phone can have; letters would be silently dropped otherwise.
  if (!/^\+?[\s(]*[0-9][0-9\s\-().]*$/.test(text)) return null;
  return normalizePhoneToE164(text.replace(/\./g, ''), countryCode);
}

export function maskPhone(e164: string): string {
  if (e164.length <= 6) return '•'.repeat(e164.length);
  return `${e164.slice(0, 4)}${'•'.repeat(e164.length - 6)}${e164.slice(-2)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCustomerRows(
  rows: Record<string, string>[],
  headers: string[],
  countryCode: string | null,
): {
  rows: CustomerRowIn[];
  unsupportedColumns: string[];
  warnings: string[];
} {
  const byNormal = new Map<string, string>();
  for (const h of headers) {
    const key = normaliseHeader(h);
    if (key && !byNormal.has(key)) byNormal.set(key, h);
  }
  const col: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const h = byNormal.get(normaliseHeader(alias));
      if (h !== undefined && !used.has(h)) {
        col[field] = h;
        used.add(h);
        break;
      }
    }
  }
  const missing = (['name', 'phone'] as Field[]).filter((f) => !col[f]);
  if (missing.length > 0) throw new CustomerColumnsError(missing);
  const get = (row: Record<string, string>, f: Field) => {
    const header = col[f];
    return header ? (row[header] ?? '').trim() : '';
  };

  const out: CustomerRowIn[] = rows.map((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = get(row, 'name');
    if (!name) errors.push('Name is required');
    if (name.length > NAME_MAX)
      errors.push(`Name is longer than ${NAME_MAX} characters`);
    const rawPhone = get(row, 'phone');
    let phone: string | null = null;
    if (!rawPhone) errors.push('Phone is required');
    else {
      phone = normaliseCustomerPhone(rawPhone, countryCode);
      if (phone === null) errors.push('Phone is not a valid number');
    }
    let email: string | null = get(row, 'email') || null;
    if (email !== null && (email.length > NAME_MAX || !EMAIL.test(email))) {
      warnings.push('Email is not valid, so it was not imported');
      email = null;
    }
    const addressText = get(row, 'address');
    let address: CustomerRowIn['address'] = null;
    if (addressText) {
      if (addressText.length > ADDRESS_MAX) {
        warnings.push(
          `Address is longer than ${ADDRESS_MAX} characters, so it was not imported`,
        );
      } else {
        const area = get(row, 'area');
        const label = get(row, 'label');
        address = {
          id: randomUUID().slice(0, 8),
          ...(label ? { label: label.slice(0, 100) } : {}),
          address: addressText,
          ...(area ? { area } : {}),
        };
      }
    }
    return { rowNumber, name, phone, email, address, errors, warnings };
  });

  const warnings: string[] = [];
  const unsupported = new Set<string>();
  let consentColumn = false;
  for (const h of headers) {
    if (h === '' || used.has(h)) continue;
    if (CONSENT_HEADER.test(h)) consentColumn = true;
    if (rows.some((r) => (r[h] ?? '').trim() !== '')) unsupported.add(h);
  }
  if (consentColumn) {
    warnings.push(
      'The file has a marketing or subscription column. It was ignored: importing customers never subscribes anyone to anything.',
    );
  }
  return { rows: out, unsupportedColumns: [...unsupported].sort(), warnings };
}

// ---------------------------------------------------------------- planning

export interface ExistingCustomer {
  id: number;
  name: string;
  email: string | null;
  addresses: { address?: string }[];
}

export type CustomerAction =
  'create' | 'update' | 'skip' | 'conflict' | 'error';

export interface CustomerPlanRow {
  rowNumber: number;
  name: string;
  phoneMasked: string | null;
  action: CustomerAction;
  reason: string | null;
  // Field LABELS only, never values.
  changes: string[];
  warnings: string[];
  errors: string[];
  // ---- writer only ----
  phone: string | null;
  existingId: number | null;
  setEmail: string | null;
  addAddress: CustomerRowIn['address'];
  email: string | null;
}

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase();

export function planCustomerImport(
  input: CustomerRowIn[],
  // normalised phone -> existing customers that normalise to it
  existing: Map<string, ExistingCustomer[]>,
  onExisting: 'update' | 'skip',
): CustomerPlanRow[] {
  const plans: CustomerPlanRow[] = input.map((r) => ({
    rowNumber: r.rowNumber,
    name: r.name,
    phoneMasked: r.phone ? maskPhone(r.phone) : null,
    action: 'error',
    reason: null,
    changes: [],
    warnings: [...r.warnings],
    errors: [...r.errors],
    phone: r.phone,
    existingId: null,
    setEmail: null,
    addAddress: r.address,
    email: r.email,
  }));

  // ---- the same person more than once in the file ----
  const groups = new Map<string, number[]>();
  input.forEach((r, i) => {
    if (r.errors.length > 0 || r.phone === null) return;
    const list = groups.get(r.phone) ?? [];
    list.push(i);
    groups.set(r.phone, list);
  });
  const handled = new Set<number>();
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const first = input[indices[0]];
    const compatible = indices.every((i) => {
      const r = input[i];
      return (
        same(r.name, first.name) &&
        (r.email === null || first.email === null || same(r.email, first.email))
      );
    });
    if (!compatible) {
      for (const i of indices) {
        plans[i].action = 'conflict';
        plans[i].reason =
          `Rows ${indices.map((n) => input[n].rowNumber).join(', ')} have the same phone number but different names or emails. None were imported. Fix the file.`;
        handled.add(i);
      }
      continue;
    }
    // Identical people: the first row stands for all. It adopts an email or
    // address a later row has and the first lacks.
    const lead = plans[indices[0]];
    for (const i of indices.slice(1)) {
      lead.email ??= input[i].email;
      lead.addAddress ??= input[i].address;
      plans[i].action = 'skip';
      plans[i].reason = `Same person as row ${first.rowNumber}`;
      handled.add(i);
    }
  }

  // ---- against the customers that already exist ----
  input.forEach((r, i) => {
    const plan = plans[i];
    if (handled.has(i) || plan.errors.length > 0 || r.phone === null) {
      if (plan.errors.length > 0) plan.action = 'error';
      return;
    }
    const matches = existing.get(r.phone) ?? [];
    if (matches.length > 1) {
      plan.action = 'conflict';
      plan.reason = `${matches.length} existing customers already share this phone number, so it is not clear which to use. Nothing was imported for this row.`;
      return;
    }
    if (matches.length === 0) {
      plan.action = 'create';
      if (plan.email) plan.setEmail = plan.email;
      return;
    }
    const current = matches[0];
    plan.existingId = current.id;
    if (onExisting === 'skip') {
      plan.action = 'skip';
      plan.reason = 'Already a customer, kept as it is';
      plan.addAddress = null;
      return;
    }
    // Update fills gaps only. It never overwrites a name or an email.
    if (!same(current.name, plan.name)) {
      plan.warnings.push('The existing name was kept');
    }
    if (current.email === null && plan.email !== null) {
      plan.setEmail = plan.email;
      plan.changes.push('Email');
    } else if (
      current.email !== null &&
      plan.email !== null &&
      !same(current.email, plan.email)
    ) {
      plan.warnings.push('The existing email was kept');
    }
    if (
      plan.addAddress &&
      !current.addresses.some(
        (a) =>
          a.address !== undefined && same(a.address, plan.addAddress!.address),
      )
    ) {
      plan.changes.push('Address');
    } else {
      plan.addAddress = null;
    }
    if (plan.changes.length === 0) {
      plan.action = 'skip';
      plan.reason = 'No changes';
    } else {
      plan.action = 'update';
    }
  });
  return plans;
}
