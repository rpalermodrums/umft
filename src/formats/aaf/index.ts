import { promises as fs } from 'node:fs';
import {
  FormatAdapter,
  InspectResult,
  ImportOptions,
  ImportResult,
  ExportOptions,
  ExportResult,
} from '../types';

const AAF_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const aafAdapter: FormatAdapter = {
  format: 'aaf',
  async sniff(_input: Buffer, pathHint?: string): Promise<boolean> {
    return Boolean(pathHint?.toLowerCase().endsWith('.aaf'));
  },
  async inspect(path: string): Promise<InspectResult> {
    const stats = await fs.stat(path);
    const header = await readHeader(path, 16);
    const isStructuredStorage =
      header.length >= AAF_MAGIC.length && header.subarray(0, AAF_MAGIC.length).equals(AAF_MAGIC);

    const warnings = ['AAF inspect-only subset in v0.1'];
    if (!isStructuredStorage) {
      warnings.push('AAF header does not match Structured Storage signature.');
    }
    return {
      format: 'aaf',
      details: {
        size: stats.size,
        headerHex: header.toString('hex'),
        structuredStorage: isStructuredStorage,
        subset: 'inspect-only',
      },
      warnings,
    };
  },
  async import(path: string, opts: ImportOptions): Promise<ImportResult> {
    void path;
    void opts;
    throw new Error('AAF import not implemented in v0.1 (inspect-only)');
  },
  async export(ir: unknown, path: string, opts: ExportOptions): Promise<ExportResult> {
    void ir;
    void path;
    void opts;
    throw new Error('AAF export not implemented in v0.1 (inspect-only)');
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
