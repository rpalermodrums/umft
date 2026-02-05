import { promises as fs } from 'node:fs';
import {
  FormatAdapter,
  InspectResult,
  ImportOptions,
  ImportResult,
  ExportOptions,
  ExportResult,
} from '../types';

export const omfAdapter: FormatAdapter = {
  format: 'omf',
  async sniff(_input: Buffer, pathHint?: string): Promise<boolean> {
    return Boolean(pathHint?.toLowerCase().endsWith('.omf'));
  },
  async inspect(path: string): Promise<InspectResult> {
    const stats = await fs.stat(path);
    const header = await readHeader(path, 16);
    const magic = header.subarray(0, 4).toString('ascii');
    const versionGuess =
      magic === 'OMF2' ? '2' : magic === 'OMFI' ? '1' : magic.trim() || 'unknown';

    const warnings = ['OMF inspect-only subset in v0.1'];
    if (magic !== 'OMFI' && magic !== 'OMF2') {
      warnings.push('OMF header magic not recognized.');
    }
    return {
      format: 'omf',
      details: {
        size: stats.size,
        headerHex: header.toString('hex'),
        magic,
        versionGuess,
        subset: 'inspect-only',
      },
      warnings,
    };
  },
  async import(path: string, opts: ImportOptions): Promise<ImportResult> {
    void path;
    void opts;
    throw new Error('OMF import not implemented in v0.1 (inspect-only)');
  },
  async export(ir: unknown, path: string, opts: ExportOptions): Promise<ExportResult> {
    void ir;
    void path;
    void opts;
    throw new Error('OMF export not implemented in v0.1 (inspect-only)');
  },
  capabilities() {
    return { supportsImport: false, supportsExport: false, supportsInspect: true };
  },
};

async function readHeader(path: string, length: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
