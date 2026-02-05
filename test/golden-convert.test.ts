import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runConvert } from '../src/core/convert';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { ConvertJob } from '../src/core/convert/types';
import { ConversionReport } from '../src/core/report/types';

describe('golden convert', () => {
  it('midi->midi matches golden output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-golden-'));
    const inputPath = join('test', 'fixtures', 'simple.mid');
    const outPath = join(dir, 'out.mid');
    const reportPath = join(dir, 'report.json');

    const job: ConvertJob = {
      inputPath,
      targetFormat: 'midi',
      outPath,
      reportPath,
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: {
        overwrite: true,
        reportFormat: 'json',
        noReport: true,
      },
    };

    const result = await runConvert(job);
    assert.equal(result.exitCode, 0);

    const actual = await readFile(outPath);
    const expected = await readFile(join('test', 'golden', 'simple.mid'));
    assert.equal(Buffer.compare(actual, expected), 0);

    const report = result.report as ConversionReport;
    assert.equal(report.input.format, 'midi');
    assert.equal(report.output.format, 'midi');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.dropped, 0);
    assert.equal(report.summary.approximate, 0);

    await rm(dir, { recursive: true, force: true });
  });

  it('midi->musicxml matches golden output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-golden-mxml-'));
    const inputPath = join('test', 'fixtures', 'simple.mid');
    const outPath = join(dir, 'out.musicxml');
    const reportPath = join(dir, 'report.json');

    const job: ConvertJob = {
      inputPath,
      targetFormat: 'musicxml',
      outPath,
      reportPath,
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: {
        overwrite: true,
        reportFormat: 'json',
        noReport: true,
      },
    };

    const result = await runConvert(job);
    assert.equal(result.exitCode, 0);

    const actual = await readFile(outPath, 'utf8');
    const expected = await readFile(join('test', 'golden', 'simple.musicxml'), 'utf8');
    assert.equal(actual, expected);

    const report = result.report as ConversionReport;
    assert.equal(report.input.format, 'midi');
    assert.equal(report.output.format, 'musicxml');
    assert.equal(report.summary.errors, 0);

    await rm(dir, { recursive: true, force: true });
  });

  it('musicxml->midi matches golden output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-golden-mxml-midi-'));
    const inputPath = join('test', 'fixtures', 'simple.musicxml');
    const outPath = join(dir, 'out.mid');
    const reportPath = join(dir, 'report.json');

    const job: ConvertJob = {
      inputPath,
      targetFormat: 'midi',
      outPath,
      reportPath,
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: {
        overwrite: true,
        reportFormat: 'json',
        noReport: true,
      },
    };

    const result = await runConvert(job);
    assert.equal(result.exitCode, 0);

    const actual = await readFile(outPath);
    const expected = await readFile(join('test', 'golden', 'simple-from-mxml.mid'));
    assert.equal(Buffer.compare(actual, expected), 0);

    const report = result.report as ConversionReport;
    assert.equal(report.input.format, 'musicxml');
    assert.equal(report.output.format, 'midi');
    assert.equal(report.summary.errors, 0);

    await rm(dir, { recursive: true, force: true });
  });
});
