import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { midiAdapter } from '../src/formats/midi';

const CLI_PATH = join(process.cwd(), 'dist-test', 'src', 'cli.js');

async function createMidiWithUnsupportedForMusicXml(path: string): Promise<void> {
  const project = {
    irVersion: '1.0',
    projectId: 'cli-config',
    meta: {},
    timing: {
      ppq: 480,
      tempoMap: [{ id: '', tick: 0, bpm: 120 }],
      timeSignatures: [{ id: '', tick: 0, numerator: 4, denominator: 4 }],
    },
    tracks: [
      {
        id: '',
        name: 'Piano',
        type: 'midi',
        midi: { channel: 0, program: 0 },
        events: [
          { kind: 'note', id: '', tick: 0, duration: 480, pitch: 60, velocity: 100 },
          { kind: 'cc', id: '', tick: 0, controller: 1, value: 64 },
        ],
      },
    ],
    markers: [],
  };

  const exported = await midiAdapter.export(project as never, path, { overwrite: true });
  assert.equal(exported.ok, true);
}

describe('cli config precedence', () => {
  it('uses policy/profile from config when flags are omitted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-cli-config-'));
    const inputPath = join(dir, 'input.mid');
    const outPath = join(dir, 'out.musicxml');
    const reportPath = join(dir, 'report.json');
    const configPath = join(dir, 'config.json');

    await createMidiWithUnsupportedForMusicXml(inputPath);
    await writeFile(
      configPath,
      JSON.stringify({ policy: 'strict', profile: 'config-profile' }, null, 2),
      'utf8',
    );

    const run = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        'convert',
        inputPath,
        '--to',
        'musicxml',
        '--config',
        configPath,
        '--out',
        outPath,
        '--report',
        reportPath,
        '--overwrite',
        '--log-level',
        'silent',
      ],
      { encoding: 'utf8' },
    );

    assert.equal(run.status, 3);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      run: { policy: string; profile: string };
    };
    assert.equal(report.run.policy, 'strict');
    assert.equal(report.run.profile, 'config-profile');

    await rm(dir, { recursive: true, force: true });
  });
});
