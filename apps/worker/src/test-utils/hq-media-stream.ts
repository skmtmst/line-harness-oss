import { createHash } from 'node:crypto';
/** Native Worker streaming primitives, emulated only for the Node test runner. */
export function installHqStreamPrimitives() {
  const original = Object.getOwnPropertyDescriptor(crypto, 'DigestStream');
  const fixed = Object.getOwnPropertyDescriptor(globalThis, 'FixedLengthStream');
  class DigestStream extends WritableStream<Uint8Array> {
    digest: Promise<ArrayBuffer>;
    constructor() {
      const hash = createHash('sha256');
      let resolve!: (value: ArrayBuffer) => void, reject!: (error: unknown) => void;
      const digest = new Promise<ArrayBuffer>((a, b) => { resolve = a; reject = b; });
      super({ write(chunk) { hash.update(chunk); }, close() { resolve(new Uint8Array(hash.digest()).buffer); }, abort(error) { reject(error); } });
      this.digest = digest;
    }
  }
  class FixedLength extends TransformStream<Uint8Array, Uint8Array> {
    constructor(size: number) { let count = 0; super({ transform(chunk, c) { count += chunk.length; if (count > size) throw new Error('oversize'); c.enqueue(chunk); }, flush() { if (count !== size) throw new Error('truncated'); } }); }
  }
  Object.defineProperty(crypto, 'DigestStream', { configurable: true, value: DigestStream });
  Object.defineProperty(globalThis, 'FixedLengthStream', { configurable: true, value: FixedLength });
  return () => {
    if (original) Object.defineProperty(crypto, 'DigestStream', original); else Reflect.deleteProperty(crypto, 'DigestStream');
    if (fixed) Object.defineProperty(globalThis, 'FixedLengthStream', fixed); else Reflect.deleteProperty(globalThis, 'FixedLengthStream');
  };
}
