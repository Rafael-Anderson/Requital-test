// Pure half of scripts/backfill-address-regions.ts: stamp a `regionId` onto
// each saved address whose `emirate` names a region of the customer's shop's
// country. `customer.addresses` is JSON, not a table, so this cannot be a SQL
// UPDATE ... JOIN like the order/draftorder/outlet backfills.
//
// An address that matches no region keeps no `regionId`: unknown stays unknown.

export interface AddressWithRegion {
  emirate?: unknown;
  regionId?: unknown;
  [key: string]: unknown;
}

export interface MappedAddresses {
  addresses: AddressWithRegion[];
  // Addresses that gained a regionId in this pass.
  mapped: number;
  // Addresses that already carried one (a re-run is a no-op).
  alreadyMapped: number;
  // Non-empty `emirate` values that matched no region, for the report.
  unmapped: string[];
}

export function mapAddressRegions(
  addresses: unknown,
  regionIdByName: ReadonlyMap<string, number>,
): MappedAddresses {
  const out: MappedAddresses = {
    addresses: [],
    mapped: 0,
    alreadyMapped: 0,
    unmapped: [],
  };
  if (!Array.isArray(addresses)) return out;
  for (const raw of addresses as AddressWithRegion[]) {
    if (raw.regionId != null) {
      out.alreadyMapped++;
      out.addresses.push(raw);
      continue;
    }
    const name = typeof raw.emirate === 'string' ? raw.emirate.trim() : '';
    const regionId = regionIdByName.get(name.toLowerCase());
    if (regionId === undefined) {
      if (name) out.unmapped.push(name);
      out.addresses.push(raw);
      continue;
    }
    out.mapped++;
    out.addresses.push({ ...raw, regionId });
  }
  return out;
}
