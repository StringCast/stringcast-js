/**
 * Decode a string file. Apple `.strings` files are often UTF-16 (LE or BE, usually with a BOM).
 * Order: BOM sniffing → UTF-16 heuristic (NUL bytes in alternating positions) → UTF-8.
 */
export function decodeText(buf: Uint8Array): string {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return swap16(b.subarray(2)).toString('utf16le');
  if (b.length >= 4 && b.length % 2 === 0) {
    const sample = b.subarray(0, Math.min(b.length, 512));
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < sample.length; i++) if (sample[i] === 0) i % 2 === 0 ? evenNul++ : oddNul++;
    const half = sample.length / 2;
    if (oddNul > half * 0.3 && evenNul === 0) return b.toString('utf16le');
    if (evenNul > half * 0.3 && oddNul === 0) return swap16(b).toString('utf16le');
  }
  return b.toString('utf8');
}

function swap16(b: Buffer): Buffer {
  const copy = Buffer.from(b.subarray(0, b.length - (b.length % 2)));
  return copy.swap16();
}
