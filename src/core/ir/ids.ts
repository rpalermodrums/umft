import { createHash } from 'node:crypto';

export type IdPart = string | number | boolean | null | undefined;

export const ID_HEX_LENGTH = 32;

export function makeId(kind: string, parts: IdPart[]): string {
  const payload = [kind, ...parts.map(normalizePart)].join(':');
  const hash = createHash('sha256').update(payload).digest('hex');
  return hash.slice(0, ID_HEX_LENGTH);
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePart(part: IdPart): string {
  if (part === null || part === undefined) {
    return '';
  }
  if (typeof part === 'number') {
    if (Number.isFinite(part)) {
      return String(part);
    }
    return 'NaN';
  }
  if (typeof part === 'boolean') {
    return part ? 'true' : 'false';
  }
  return String(part);
}
