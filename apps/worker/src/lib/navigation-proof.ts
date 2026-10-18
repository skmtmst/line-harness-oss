const encoder = new TextEncoder();
async function key(secret: string, usage: Array<'sign' | 'verify'>) {
  if (!secret) throw new Error('Missing signing key');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
export async function navigationProof(secret: string, purpose: string, value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, ['sign']), encoder.encode(`${purpose}\n${value}`)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyNavigationProof(secret: string, purpose: string, value: string, proof: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const bytes = Uint8Array.from(proof.match(/../g)!, pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await key(secret, ['verify']), bytes, encoder.encode(`${purpose}\n${value}`));
}
