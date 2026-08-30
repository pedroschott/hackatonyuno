import type { JWK } from 'jose';

import type { Attributes } from '@agentic-mandates/contracts';

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

export const autopartsPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'uBUFVoWW2YeBOibdYSSYlV_uyAG58V7_lzMHbPWfYBw',
  y: '0o2yc-c6uIY301hip_fuAmoc1Ce9QSxN9XE0hzbQVbk',
  key_ops: ['verify'],
  ext: true,
};

export const harvestMarketPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '7C4izDlK5_4FlwtsBXTTWJpLa4ZlQbSirEZWWWBwKbo',
  y: 'OuzRkDK0WIADuQhn8rlZEO9SiuX1pVuzN-s3AzCfe6w',
  key_ops: ['verify'],
  ext: true,
};

export const cityBasketPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Y15afop1gkzDoqOqQ77BrISq-uSqjPxTSfGQxEeQ8Yc',
  y: 'WIh3aiQKK9A4sr7TXOkbW0uh1gN3mjLqgGHU8asUcRE',
  key_ops: ['verify'],
  ext: true,
};

export const mareBotanicalsPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Iv1Wb5kXS5k41A0M-dwBjhoeFLkEPWFtjU4U-gzB5Yg',
  y: 'syS_Gu66yn4l-IZxXMKtNug8nrZsRLukk8Wk2C2ACqA',
  key_ops: ['verify'],
  ext: true,
};

export const pneufastPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'rip6umXYk0Vl415u2PNbN5JMcRQrM51AbPdQAeC2coo',
  y: 'tPOW7x5QIYynzPW2Cyv9GjsMhxSUt30PWSkS6e68M2M',
  key_ops: ['verify'],
  ext: true,
};

/**
 * These are intentionally incompatible *local* taxonomies. The Mandate
 * service owns every mapping to canonical taxonomy and must not trust these
 * category strings as authorization data.
 */
export const merchantDefinitions: readonly MerchantDefinition[] = [
  {
    id: 'mrc_autoparts',
    name: 'AutoParts',
    basePath: '/merchants/autoparts',
    merchantCatalogVersion: 'autoparts-2026-08-29',
    signingKeyId: 'autoparts-2026-08',
    signingPublicJwk: autopartsPublicJwk,
    pricing: {
      taxBasisPoints: 500,
      flatShippingMinor: 2_500,
      freeShippingAtMinor: 200_000,
    },
    catalog: [
      {
        merchantSku: 'prd_tire_std',
        merchantCategoryId: 'tires',
        name: 'Standard tire set',
        description: '4× 205/55 R16 all-season. Fleet-grade, 60k km warranty.',
        searchTerms: ['tires', 'tire', 'wheel', 'auto', 'standard'],
        unitAmountMinor: 154_800,
        currency: 'USD',
        availableQuantity: 20,
        attributes: { warranty: '60k km', season: 'all-season' },
      },
      {
        merchantSku: 'prd_tire_prm',
        merchantCategoryId: 'tires',
        name: 'Premium tire set',
        description: '4× 205/55 R16 performance. Low noise, wet-grip A rating.',
        searchTerms: ['tires', 'tire', 'wheel', 'auto', 'premium'],
        unitAmountMinor: 172_000,
        currency: 'USD',
        availableQuantity: 15,
        attributes: { rating: 'A', noise: 'low' },
      },
      {
        merchantSku: 'prd_acc_jack',
        merchantCategoryId: 'accessories',
        name: 'Hydraulic jack 2t',
        description: 'Low-profile trolley jack with dual pump.',
        searchTerms: ['jack', 'hydraulic', 'tools', 'accessories'],
        unitAmountMinor: 38_900,
        currency: 'USD',
        availableQuantity: 10,
        attributes: { capacity: '2t' },
      },
      {
        merchantSku: 'prd_acc_mats',
        merchantCategoryId: 'accessories',
        name: 'All-weather floor mats',
        description: 'Set of 4, trimmable, anti-slip backing.',
        searchTerms: ['mats', 'floor', 'accessories', 'interior'],
        unitAmountMinor: 12_900,
        currency: 'USD',
        availableQuantity: 25,
        attributes: { pieces: 4 },
      },
    ],
  },
  {
    id: 'mrc_harvest_market',
    name: 'Harvest Market',
    basePath: '/merchants/harvest-market',
    merchantCatalogVersion: 'harvest-2026-08-29',
    signingKeyId: 'harvest-market-2026-08',
    signingPublicJwk: harvestMarketPublicJwk,
    pricing: {
      taxBasisPoints: 825,
      flatShippingMinor: 1_490,
      freeShippingAtMinor: 15_000,
    },
    catalog: [
      {
        merchantSku: 'hm-rice-jasmine-2lb',
        merchantCategoryId: 'pantry.rice-and-grains',
        name: 'Jasmine Rice, 2 lb',
        description: 'Long-grain jasmine rice.',
        searchTerms: ['rice', 'jasmine', 'grain', 'pantry'],
        unitAmountMinor: 3_490,
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
        unitAmountMinor: 2_990,
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
        unitAmountMinor: 5_990,
        currency: 'USD',
        availableQuantity: 8,
        attributes: { servings: 2, autoRenew: false },
      },
      {
        merchantSku: 'hm-store-credit-50',
        merchantCategoryId: 'stored-value.store-credit',
        name: 'Harvest Market Store Credit, $50',
        description: 'Fixture for an intentionally unmapped local category.',
        searchTerms: ['credit', 'stored value', 'gift'],
        unitAmountMinor: 5_000,
        currency: 'USD',
        availableQuantity: 100,
        attributes: { transferable: true },
      },
    ],
  },
  {
    id: 'mrc_city_basket',
    name: 'City Basket',
    basePath: '/merchants/city-basket',
    merchantCatalogVersion: 'city-basket-2026-08-29',
    signingKeyId: 'city-basket-2026-08',
    signingPublicJwk: cityBasketPublicJwk,
    pricing: {
      taxBasisPoints: 975,
      flatShippingMinor: 1_990,
      freeShippingAtMinor: 20_000,
    },
    catalog: [
      {
        merchantSku: 'cb-basmati-pouch-900g',
        merchantCategoryId: 'grocery/dry-goods/rice',
        name: 'Basmati Rice, 900 g',
        description: 'Aromatic basmati rice pouch.',
        searchTerms: ['rice', 'basmati', 'dry goods', 'grocery'],
        unitAmountMinor: 3_690,
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
        unitAmountMinor: 3_290,
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
        unitAmountMinor: 4_990,
        currency: 'USD',
        availableQuantity: 10,
        attributes: { servings: 2, autoRenew: false },
      },
      {
        merchantSku: 'cb-digital-credit-50',
        merchantCategoryId: 'digital/wallet-credit',
        name: 'City Basket Digital Credit, $50',
        description: 'Fixture for an intentionally unmapped local category.',
        searchTerms: ['credit', 'digital', 'gift'],
        unitAmountMinor: 5_000,
        currency: 'USD',
        availableQuantity: 100,
        attributes: { transferable: true },
      },
    ],
  },
  {
    id: 'mrc_mare_botanicals',
    name: 'Maré Botanicals',
    basePath: '/merchants/mare-botanicals',
    merchantCatalogVersion: 'mare-botanicals-2026-08-29',
    signingKeyId: 'mare-botanicals-2026-08',
    signingPublicJwk: mareBotanicalsPublicJwk,
    pricing: {
      taxBasisPoints: 700,
      flatShippingMinor: 1_200,
      freeShippingAtMinor: 18_000,
    },
    catalog: [
      {
        merchantSku: 'mb-face-serum-30ml',
        merchantCategoryId: 'skincare.face',
        name: 'Botanical Face Serum, 30ml',
        description: 'Botanical Face Serum, 30ml',
        searchTerms: ['face', 'serum', 'skincare', 'botanical'],
        unitAmountMinor: 14_500,
        currency: 'USD',
        availableQuantity: 15,
        attributes: { size: '30ml', vegan: true },
      },
      {
        merchantSku: 'mb-hair-oil-50ml',
        merchantCategoryId: 'hair.oils',
        name: 'Restorative Hair Oil, 50ml',
        description: 'Restorative Hair Oil, 50ml',
        searchTerms: ['hair', 'oil', 'restorative', 'botanical'],
        unitAmountMinor: 11_800,
        currency: 'USD',
        availableQuantity: 20,
        attributes: { size: '50ml', vegan: true },
      },
      {
        merchantSku: 'mb-clay-mask-100g',
        merchantCategoryId: 'bath.body',
        name: 'Purifying Clay Mask, 100g',
        description: 'Purifying Clay Mask, 100g',
        searchTerms: ['clay', 'mask', 'bath', 'body'],
        unitAmountMinor: 8_900,
        currency: 'USD',
        availableQuantity: 12,
        attributes: { weight: '100g', natural: true },
      },
      {
        merchantSku: 'mb-gift-voucher-100',
        merchantCategoryId: 'vouchers.gift',
        name: 'Maré Gift Voucher, $100',
        description: 'Fixture for an intentionally unmapped local category.',
        searchTerms: ['voucher', 'gift', 'card'],
        unitAmountMinor: 10_000,
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
