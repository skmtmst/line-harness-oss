


/** ブラウザの申告ではなく、実際の先頭バイトが選んだ形式と一致するかを見る。 */
export function hasMediaSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 8
        && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
          .every((value, index) => bytes[index] === value);
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4':
    case 'audio/mp4':
      return bytes.length >= 12 && ascii(4, 4) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3'
        || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    default:
      return false;
  }
}
