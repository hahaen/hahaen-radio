const bitrates = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
const rates = [44100, 48000, 32000];

function frameHeader(bytes: Uint8Array, offset: number) {
  const first = bytes[offset]!;
  const second = bytes[offset + 1]!;
  const third = bytes[offset + 2]!;
  const fourth = bytes[offset + 3]!;
  const version = (second >> 3) & 3;
  const rate = rates[(third >> 2) & 3];
  if (
    first !== 0xff ||
    (second & 0xe0) !== 0xe0 ||
    ((second >> 1) & 3) !== 1 ||
    version === 1 ||
    !rate
  )
    return;
  const mpeg1 = version === 3;
  const bitrate = bitrates[mpeg1 ? 0 : 1]![third >> 4];
  if (!bitrate) return;
  const sampleRate = rate / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const numberOfChannels = fourth >> 6 === 3 ? 1 : 2;
  const samples = mpeg1 ? 1152 : 576;
  const size = Math.floor((samples * bitrate * 1000) / (8 * sampleRate)) + ((third >> 1) & 1);
  return { size, samples, sampleRate, numberOfChannels };
}

export function createMp3Framer() {
  let remainder = new Uint8Array(0);
  let skip = 0;
  let synced = false;
  return function* frames(chunk: Uint8Array) {
    const bytes = new Uint8Array(remainder.length + chunk.length);
    bytes.set(remainder);
    bytes.set(chunk, remainder.length);
    let offset = Math.min(skip, bytes.length);
    skip -= offset;
    while (offset + 4 <= bytes.length) {
      if (
        !synced &&
        bytes[offset] === 0x49 &&
        bytes[offset + 1] === 0x44 &&
        bytes[offset + 2] === 0x33
      ) {
        if (offset + 10 > bytes.length) break;
        const flags = bytes[offset + 5]!;
        const length =
          ((bytes[offset + 6]! & 127) << 21) |
          ((bytes[offset + 7]! & 127) << 14) |
          ((bytes[offset + 8]! & 127) << 7) |
          (bytes[offset + 9]! & 127);
        if (length > 1024 * 1024) throw new Error('MP3 metadata too large');
        const next = offset + 10 + length + (flags & 0x10 ? 10 : 0);
        skip = Math.max(0, next - bytes.length);
        offset = Math.min(next, bytes.length);
        continue;
      }
      const header = frameHeader(bytes, offset);
      if (!header) {
        synced = false;
        offset++;
        continue;
      }
      const end = offset + header.size;
      if (end > bytes.length || (!synced && end + 4 > bytes.length)) break;
      if (!synced && !frameHeader(bytes, end)) {
        offset++;
        continue;
      }
      synced = true;
      yield { ...header, data: bytes.subarray(offset, end) };
      offset = end;
    }
    remainder = bytes.slice(offset);
  };
}
