import { promises as fs } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export interface AtomicWriteOptions {
  mode?: number;
}

export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(targetPath);
  const filename = basename(targetPath);
  const tempPath = join(directory, `.${filename}.tmp-${process.pid}`);

  const handle = await fs.open(tempPath, 'w', options.mode);
  try {
    if (typeof data === 'string') {
      await handle.writeFile(data, 'utf8');
    } else {
      await handle.writeFile(data);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(tempPath, targetPath);
}
