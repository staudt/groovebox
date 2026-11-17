// Minimal store-only (no compression) zip writer with CRC-32. No dependency.
// WAV audio barely compresses, so storing is fine. Sizes stay below 4 GB (no zip64).

let table: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds a zip archive (method 0 = stored) from the given files. File names are UTF-8. */
export function zip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const names = entries.map((e) => enc.encode(e.name));
  let size = 22;
  entries.forEach((e, i) => (size += 30 + 46 + 2 * names[i]!.length + e.data.length));
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  const crcs: number[] = [];
  entries.forEach((e, i) => {
    const name = names[i]!;
    const crc = crc32(e.data);
    crcs.push(crc);
    offsets.push(o);
    v.setUint32(o, 0x04034b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 0x0800, true); // UTF-8 names
    v.setUint16(o + 8, 0, true); // stored
    v.setUint16(o + 10, time, true);
    v.setUint16(o + 12, date, true);
    v.setUint32(o + 14, crc, true);
    v.setUint32(o + 18, e.data.length, true);
    v.setUint32(o + 22, e.data.length, true);
    v.setUint16(o + 26, name.length, true);
    v.setUint16(o + 28, 0, true);
    out.set(name, o + 30);
    out.set(e.data, o + 30 + name.length);
    o += 30 + name.length + e.data.length;
  });
  const cdStart = o;
  entries.forEach((e, i) => {
    const name = names[i]!;
    v.setUint32(o, 0x02014b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 20, true);
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, time, true);
    v.setUint16(o + 14, date, true);
    v.setUint32(o + 16, crcs[i]!, true);
    v.setUint32(o + 20, e.data.length, true);
    v.setUint32(o + 24, e.data.length, true);
    v.setUint16(o + 28, name.length, true);
    v.setUint32(o + 42, offsets[i]!, true);
    out.set(name, o + 46);
    o += 46 + name.length;
  });
  v.setUint32(o, 0x06054b50, true);
  v.setUint16(o + 8, entries.length, true);
  v.setUint16(o + 10, entries.length, true);
  v.setUint32(o + 12, o - cdStart, true);
  v.setUint32(o + 16, cdStart, true);
  return out;
}
