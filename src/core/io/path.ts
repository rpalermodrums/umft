import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export async function ensureDirForFile(path: string): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });
}
