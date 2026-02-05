import { Format } from '../core/ir';
import { FormatAdapter } from './types';
import { midiAdapter } from './midi';
import { musicxmlAdapter } from './musicxml';
import { aafAdapter } from './aaf';
import { omfAdapter } from './omf';

const adapters: FormatAdapter[] = [midiAdapter, musicxmlAdapter, aafAdapter, omfAdapter];

export function getAdapter(format: Format): FormatAdapter {
  const adapter = adapters.find((entry) => entry.format === format);
  if (!adapter) {
    throw new Error(`No adapter for format: ${format}`);
  }
  return adapter;
}

export async function detectFormat(input: Buffer, pathHint?: string): Promise<Format | null> {
  for (const adapter of adapters) {
    if (await adapter.sniff(input, pathHint)) {
      return adapter.format;
    }
  }
  return null;
}
