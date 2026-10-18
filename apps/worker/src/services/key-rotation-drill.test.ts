import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptCredential, decryptCredential } from '@line-crm/db';
import { signPrivateImageUrl, privateImageSignatureValid } from './image-access.js';
const fixtureKey=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
afterEach(()=>vi.useRealTimers());
describe('key rotation rehearsal exercises production encryption and URL signatures using fixture keys',()=>{
  it('accepts the new URL and rejects old signatures, changed resources and expired links',async()=>{
    const oldKey=fixtureKey(),newKey=fixtureKey();const path='https://fixture.invalid/images/nen-pets/fixture/photo.jpg';
    const oldUrl=new URL(await signPrivateImageUrl(new URL(path),oldKey));const newUrl=new URL(await signPrivateImageUrl(new URL(path),newKey));
    expect(await privateImageSignatureValid(newUrl,newKey)).toBe(true);
    expect(await privateImageSignatureValid(oldUrl,newKey)).toBe(false);
    newUrl.pathname+='.other';expect(await privateImageSignatureValid(newUrl,newKey)).toBe(false);newUrl.pathname=new URL(path).pathname;
    vi.useFakeTimers();vi.setSystemTime(new Date(Date.now()+16*60000));expect(await privateImageSignatureValid(newUrl,newKey)).toBe(false);
  });
  it('replacing a secret alone loses decryption; a verified migration preserves the old content',async()=>{
    const oldKey=fixtureKey(),newKey=fixtureKey(),plain='fixture-content';const encrypted=await encryptCredential(plain,oldKey);
    await expect(decryptCredential(encrypted,newKey)).rejects.toThrow();
    const migrated=await encryptCredential(await decryptCredential(encrypted,oldKey),newKey);
    expect(await decryptCredential(migrated,newKey)).toBe(plain);
    await expect(decryptCredential(migrated,oldKey)).rejects.toThrow();
  });
});
