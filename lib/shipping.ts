import type { ShippingAddress, ShippingAddressSource } from "@/lib/domain";

/**
 * The account's registered delivery address, as stored on `customer_profiles`.
 * It is the address the buyer confirmed once and the default for every order,
 * which is why a purchase never has to ask for one: an agent that had to collect
 * an address in chat would be collecting it from whoever is talking to it.
 */
export type CustomerProfileRow = {
  legal_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
};

export const SHIPPING_FIELDS =
  "legal_name, phone, address_line1, address_line2, city, region, postal_code, country_code";

export type ResolvedShipping = {
  address: ShippingAddress;
  source: ShippingAddressSource;
};

/**
 * Turns the registered profile into a delivery address, or explains what is
 * missing. Returning the missing field names rather than a bare `null` is what
 * lets the agent tell the user "add a postal code" instead of "something is
 * wrong with your account".
 */
export function registeredShippingAddress(
  profile: CustomerProfileRow | null,
): { address: ShippingAddress } | { missing: string[] } {
  const required: Array<[keyof CustomerProfileRow, string]> = [
    ["legal_name", "legal name"],
    ["address_line1", "street address"],
    ["city", "city"],
    ["postal_code", "postal code"],
    ["country_code", "country"],
  ];
  const missing = required.filter(([field]) => !profile?.[field]?.toString().trim()).map(([, label]) => label);
  if (!profile || missing.length) return { missing };
  return {
    address: {
      recipient: profile.legal_name!.trim(),
      line1: profile.address_line1!.trim(),
      ...(profile.address_line2?.trim() ? { line2: profile.address_line2.trim() } : {}),
      city: profile.city!.trim(),
      ...(profile.region?.trim() ? { region: profile.region.trim() } : {}),
      postal_code: profile.postal_code!.trim(),
      country_code: profile.country_code!.trim().toUpperCase(),
      ...(profile.phone?.trim() ? { phone: profile.phone.trim() } : {}),
    },
  };
}

/**
 * Fills the gaps in a one-off address from the registered one. A buyer who says
 * "send it to the Newark depot instead" gives a street and a city, not a
 * recipient and a phone number, and an order that dropped those would arrive
 * without anyone to sign for it.
 */
export function mergeShippingAddress(
  registered: ShippingAddress | null,
  custom: Partial<ShippingAddress>,
): ShippingAddress {
  const pick = (value: string | undefined, fallback: string | undefined) => value?.trim() || fallback?.trim() || "";
  const merged: ShippingAddress = {
    recipient: pick(custom.recipient, registered?.recipient),
    line1: pick(custom.line1, registered?.line1),
    city: pick(custom.city, registered?.city),
    postal_code: pick(custom.postal_code, registered?.postal_code),
    country_code: (pick(custom.country_code, registered?.country_code) || "US").toUpperCase(),
  };
  const line2 = pick(custom.line2, custom.line1 ? undefined : registered?.line2);
  const region = pick(custom.region, custom.line1 ? undefined : registered?.region);
  const phone = pick(custom.phone, registered?.phone);
  const instructions = custom.instructions?.trim();
  return {
    ...merged,
    ...(line2 ? { line2 } : {}),
    ...(region ? { region } : {}),
    ...(phone ? { phone } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/** True when every field the merchant needs to actually deliver is present. */
export function isDeliverable(address: ShippingAddress): boolean {
  return Boolean(
    address.recipient && address.line1 && address.city && address.postal_code && /^[A-Z]{2}$/.test(address.country_code),
  );
}

/** One-line form for a log entry, a table cell or a narration. */
export function formatShippingAddress(address: ShippingAddress): string {
  return [
    address.recipient,
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(", "),
    address.postal_code,
    address.country_code,
  ]
    .filter(Boolean)
    .join(" · ");
}
