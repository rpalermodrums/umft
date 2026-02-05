import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FALLBACK_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'UMFT Conversion Report',
  type: 'object',
};

export function loadReportSchema(): unknown {
  try {
    const schemaPath = resolve(process.cwd(), 'docs', 'REPORT_SCHEMA.json');
    const raw = readFileSync(schemaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return FALLBACK_SCHEMA;
  }
}
