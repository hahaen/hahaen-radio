import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../tests/fixtures/audio/', import.meta.url));
mkdirSync(directory, { recursive: true });
const binary = process.env.FFMPEG_BIN || 'ffmpeg';
const source = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=44100:duration=12',
  '-af',
  'volume=0.2',
  '-ac',
  '1',
];
for (const output of [
  ['-c:a', 'libmp3lame', '-b:a', '64k', join(directory, 'tone.mp3')],
  ['-c:a', 'aac', '-b:a', '64k', '-f', 'adts', join(directory, 'tone.aac')],
  [
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    join(directory, 'segment-%02d.ts'),
    join(directory, 'tone.m3u8'),
  ],
]) {
  const result = spawnSync(binary, [...source, ...output], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Audio fixture generation failed');
}
