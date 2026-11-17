import { describe, expect, it } from 'vitest';
import { crc32, zip } from '../../src/app/zip';

/** Tiny zip reader: walks the central directory and checks local headers and CRCs. */
function read(z: Uint8Array): { name: string; data: Uint8Array }[] {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const n = v.getUint16(eocd + 10, true);
  let o = v.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(o, true)).toBe(0x02014b50);
    expect(v.getUint16(o + 10, true)).toBe(0);
    const crc = v.getUint32(o + 16, true);
    const size = v.getUint32(o + 24, true);
    const nameLen = v.getUint16(o + 28, true);
    const local = v.getUint32(o + 42, true);
    const name = new TextDecoder().decode(z.subarray(o + 46, o + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 22, true)).toBe(size);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = z.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    o += 46 + nameLen;
  }
  return out;
}

describe('zip writer', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('packs two files that read back identically', () => {
    const a = new TextEncoder().encode('hello world');
    const b = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
    const files = read(zip([{ name: 'KICK.wav', data: a }, { name: 'ünï.wav', data: b }]));
    expect(files.map((f) => f.name)).toEqual(['KICK.wav', 'ünï.wav']);
    expect(Array.from(files[0]!.data)).toEqual(Array.from(a));
    expect(Array.from(files[1]!.data)).toEqual(Array.from(b));
  });
  it('an empty archive is just the end record', () => {
    expect(read(zip([])).length).toBe(0);
  });
});
