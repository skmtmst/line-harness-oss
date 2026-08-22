import { randomBytes, webcrypto } from "node:crypto";

export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

export function generateCredentialEncryptionKey(): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

/** Encrypts one credential with Web Crypto AES-GCM and a fresh 96-bit IV. */
export async function encryptCredentialForSetup(value: string, secret: string): Promise<string> {
  const rawKey = Buffer.from(secret, "base64");
  if (rawKey.byteLength !== 32) {
    throw new Error("LINE credential encryption key must be 32 bytes");
  }
  const key = await webcrypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  const encode = (bytes: Uint8Array) => Buffer.from(bytes)
    .toString("base64url");
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
