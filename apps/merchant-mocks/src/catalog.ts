import type { JWK } from 'jose';

import type { Attributes } from './contracts.js';

export type CatalogProduct = {
  merchantSku: string;
  merchantCategoryId: string;
  name: string;
  description: string;
  searchTerms: readonly string[];
  unitAmountMinor: number;
  currency: 'USD';
  availableQuantity: number;
  attributes: Attributes;
};

export type MerchantPricingRules = {
  taxBasisPoints: number;
  flatShippingMinor: number;
  freeShippingAtMinor: number;
};

export type MerchantDefinition = {
  id: string;
  name: string;
  basePath: string;
  merchantCatalogVersion: string;
  signingKeyId: string;
  signingPublicJwk: JWK;
  pricing: MerchantPricingRules;
  catalog: readonly CatalogProduct[];
};

const harvestMarketPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '7C4izDlK5_4FlwtsBXTTWJpLa4ZlQbSirEZWWWBwKbo',
  y: 'OuzRkDK0WIADuQhn8rlZEO9SiuX1pVuzN-s3AzCfe6w',
  key_ops: ['verify'],
  ext: true,
};

const cityBasketPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Y15afop1gkzDoqOqQ77BrISq-uSqjPxTSfGQxEeQ8Yc',
  y: 'WIh3aiQKK9A4sr7TXOkbW0uh1gN3mjLqgGHU8asUcRE',
  key_ops: ['verify'],
  ext: true,
};

/**
 * These are two intentionally incompatible *local* taxonomies. The Mandate
 * service owns every mapping to canonical taxonomy and must not trust these
 * category strings as authorization data.
 */
export const merchantDefinitions: readonly MerchantDefinition[] = [
  {
    id: 'harvest-market',
    name: 'Harvest Market',
    basePath: '/merchants/harvest-market',
    merchantCatalogVersion: 'harvest-2026-08-29',
    signingKeyId: 'harvest-market-2026-08',
    signingPublicJwk: harvestMarketPublicJwk,
    pricing: {
      taxBasisPoints: 825,
      flatShippingMinor: 499,
      freeShippingAtMinor: 5_000,
    },
    catalog: [
      {
        merchantSku: 'hm-rice-jasmine-2lb',
        merchantCategoryId: 'pantry.rice-and-grains',
        name: 'Jasmine Rice, 2 lb',
        description: 'Long-grain jasmine rice.',
        searchTerms: ['rice', 'jasmine', 'grain', 'pantry'],
        unitAmountMinor: 799,
        currency: 'USD',
        availableQuantity: 18,
        attributes: { origin: 'Thailand', organic: false },
      },
      {
        merchantSku: 'hm-chicken-thighs-1lb',
        merchantCategoryId: 'fresh.poultry',
        name: 'Chicken Thighs, 1 lb',
        description: 'Fresh boneless chicken thighs.',
        searchTerms: ['chicken', 'poultry', 'meat', 'fresh'],
        unitAmountMinor: 699,
        currency: 'USD',
        availableQuantity: 12,
        attributes: { boneless: true, frozen: false },
      },
      {
        merchantSku: 'hm-smash-burger-kit',
        merchantCategoryId: 'prepared.burger-kits',
        name: 'Smash Burger Kit',
        description: 'Ready-to-cook burger kit for two.',
        searchTerms: ['burger', 'hamburger', 'prepared', 'kit'],
        unitAmountMinor: 1_499,
        currency: 'USD',
        availableQuantity: 8,
        attributes: { servings: 2, autoRenew: false },
      },
      {
        merchantSku: 'hm-store-credit-25',
        merchantCategoryId: 'stored-value.store-credit',
        name: 'Harvest Market Store Credit, $25',
        description: 'Fixture for an intentionally unmapped local category.',
        searchTerms: ['credit', 'stored value', 'gift'],
        unitAmountMinor: 2_500,
        currency: 'USD',
        availableQuantity: 100,
        attributes: { transferable: true },
      },
    ],
  },
  {
    id: 'city-basket',
    name: 'City Basket',
    basePath: '/merchants/city-basket',
    merchantCatalogVersion: 'city-basket-2026-08-29',
    signingKeyId: 'city-basket-2026-08',
    signingPublicJwk: cityBasketPublicJwk,
    pricing: {
      taxBasisPoints: 975,
      flatShippingMinor: 699,
      freeShippingAtMinor: 7_500,
    },
    catalog: [
      {
        merchantSku: 'cb-basmati-pouch-900g',
        merchantCategoryId: 'grocery/dry-goods/rice',
        name: 'Basmati Rice, 900 g',
        description: 'Aromatic basmati rice pouch.',
        searchTerms: ['rice', 'basmati', 'dry goods', 'grocery'],
        unitAmountMinor: 849,
        currency: 'USD',
        availableQuantity: 20,
        attributes: { origin: 'India', organic: true },
      },
      {
        merchantSku: 'cb-chicken-breasts-1lb',
        merchantCategoryId: 'meat-and-seafood/chicken',
        name: 'Chicken Breasts, 1 lb',
        description: 'Fresh skinless chicken breasts.',
        searchTerms: ['chicken', 'meat', 'poultry', 'fresh'],
        unitAmountMinor: 759,
        currency: 'USD',
        availableQuantity: 16,
        attributes: { boneless: true, frozen: false },
      },
      {
        merchantSku: 'cb-ready-burger-duo',
        merchantCategoryId: 'ready-to-eat/burgers',
        name: 'Burger Duo',
        description: 'Two ready-to-heat burgers.',
        searchTerms: ['burger', 'hamburger', 'ready to eat'],
        unitAmountMinor: 1_299,
        currency: 'USD',
        availableQuantity: 10,
        attributes: { servings: 2, autoRenew: false },
      },
      {
        merchantSku: 'cb-digital-credit-25',
        merchantCategoryId: 'digital/wallet-credit',
        name: 'City Basket Digital Credit, $25',
        description: 'Fixture for an intentionally unmapped local category.',
        searchTerms: ['credit', 'digital', 'gift'],
        unitAmountMinor: 2_500,
        currency: 'USD',
        availableQuantity: 100,
        attributes: { transferable: true },
      },
    ],
  },
];

/**
 * Input for the Mandate-service-controlled registry seed. It has no trust tier
 * because the merchant must never self-assign one.
 */
export const merchantRegistrySeed = merchantDefinitions.map((merchant) => ({
  merchantId: merchant.id,
  endpointPath: merchant.basePath,
  keyId: merchant.signingKeyId,
  publicJwk: merchant.signingPublicJwk,
  lifecycleStatus: 'active' as const,
}));

export function findMerchantDefinition(merchantId: string): MerchantDefinition | undefined {
  return merchantDefinitions.find((merchant) => merchant.id === merchantId);
}
