// WAV encoding (16-bit PCM, little endian). Used by export and by the audio tests.

/** 16-bit PCM WAV (little endian) from one or more equal-length channels, samples clipped to [-1, 1]. */
export function toWav(channels: Float32Array[], sr: number): Uint8Array {
  const nCh = channels.length;
  const n = nCh > 0 ? channels[0]!.length : 0;
  const dataBytes = n * nCh * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const str = (o: number, t: string): void => {
    for (let i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i);
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      o += 2;
    }
  }
  return out;
}
