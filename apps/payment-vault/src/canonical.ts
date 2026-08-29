import { createHash } from 'node:crypto';

import { canonicalize } from 'json-canonicalize';

export function sha256Base64Url(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function requestFingerprint(value: unknown): string {
  return sha256Base64Url(canonicalize(value));
}

export function requestBodyHash(rawBody: Uint8Array): string {
  return sha256Base64Url(rawBody);
}
