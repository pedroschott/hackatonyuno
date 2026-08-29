import { z } from 'zod';

import { canonicalServiceRequestUrl, type ServiceRequestProofSigner } from './service-request-proof.js';
import type { MerchantQuoteSource, RegisteredMerchant } from './types.js';

const MerchantQuoteEnvelopeSchema = z.object({ quote: z.unknown() }).strict();

export type HttpMerchantQuoteSourceOptions = {
  requestProofSigner: ServiceRequestProofSigner;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/**
 * Reads a quote only from the endpoint selected by the Mandate-owned
 * registry. The adapter signs the request as the Mandate service; it never
 * follows an endpoint supplied by an agent or merchant payload.
 */
export class HttpMerchantQuoteSource implements MerchantQuoteSource {
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpMerchantQuoteSourceOptions) {
    if (!options.requestProofSigner) {
      throw new TypeError('HttpMerchantQuoteSource requires a service request proof signer.');
    }
    if (typeof (options.fetch ?? globalThis.fetch) !== 'function') {
      throw new TypeError('HttpMerchantQuoteSource requires a Fetch implementation.');
    }
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = validateTimeout(options.timeoutMs);
  }

  async getQuote(input: {
    merchant: RegisteredMerchant;
    quoteId: string;
  }): Promise<unknown | undefined> {
    const endpoint = quoteEndpoint(input.merchant.quoteEndpoint, input.quoteId);
    const rawBody = new Uint8Array();
    const proof = await this.options.requestProofSigner.sign({
      method: 'GET',
      url: endpoint,
      rawBody,
      audience: `merchant-api:${input.merchant.merchantId}`,
    });

    const response = await fetchWithTimeout(this.fetchImplementation, endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-mandate-request-proof': proof,
      },
      redirect: 'error',
    }, this.timeoutMs);
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new MerchantQuoteSourceError(
        `The registered merchant quote endpoint returned HTTP ${response.status}.`,
      );
    }

    const body = await parseJson(response, 'The registered merchant quote endpoint returned invalid JSON.');
    const parsed = MerchantQuoteEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new MerchantQuoteSourceError(
        'The registered merchant quote endpoint returned an invalid quote response.',
      );
    }
    return parsed.data.quote;
  }
}

export class MerchantQuoteSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantQuoteSourceError';
  }
}

function quoteEndpoint(baseUrl: string, quoteId: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new MerchantQuoteSourceError('The registered merchant quote endpoint is invalid.');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new MerchantQuoteSourceError('The registered merchant quote endpoint is not an absolute HTTP(S) URL.');
  }
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return canonicalServiceRequestUrl(
    new URL(`quotes/${encodeURIComponent(quoteId)}`, base).toString(),
  );
}

async function parseJson(response: Response, errorMessage: string): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    throw new MerchantQuoteSourceError(errorMessage);
  }
}

function validateTimeout(value: number | undefined): number {
  const timeoutMs = value ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new TypeError('timeoutMs must be a positive integer no greater than 30000.');
  }
  return timeoutMs;
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch {
    throw new MerchantQuoteSourceError('The registered merchant quote endpoint could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}
