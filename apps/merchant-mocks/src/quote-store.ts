import type { MerchantQuote } from './contracts.js';

export interface QuoteStore {
  save(quote: MerchantQuote): void;
  get(quoteId: string): MerchantQuote | undefined;
}

/**
 * A quote is stored as an immutable snapshot. `get` returns a clone so a route
 * handler cannot accidentally mutate the snapshot that was signed.
 */
export class InMemoryQuoteStore implements QuoteStore {
  private readonly quotes = new Map<string, MerchantQuote>();

  save(quote: MerchantQuote): void {
    if (this.quotes.has(quote.id)) {
      throw new Error(`Quote ${quote.id} already exists.`);
    }

    this.quotes.set(quote.id, freezeDeep(structuredClone(quote)));
  }

  get(quoteId: string): MerchantQuote | undefined {
    const quote = this.quotes.get(quoteId);
    return quote ? structuredClone(quote) : undefined;
  }
}

export function isQuoteExpired(quote: MerchantQuote, now: Date): boolean {
  return Date.parse(quote.expiresAt) <= now.getTime();
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const nestedValue of Object.values(value)) {
      freezeDeep(nestedValue);
    }
  }

  return value;
}
