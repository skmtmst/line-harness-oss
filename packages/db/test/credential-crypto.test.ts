import { describe, expect, it, vi } from 'vitest';
import {
  CredentialEncryptionKeyError,
  decryptCredential,
  decryptLineAccountCredentials,
  encryptCredential,
  createLineAccount,
  type LineAccount,
} from '../src/index.js';

const KEY = btoa('0123456789abcdef0123456789abcdef');
const OTHER_KEY = btoa('abcdef0123456789abcdef0123456789');

function account(overrides: Partial<LineAccount> = {}): LineAccount {
  return {
    id: 'acc-1',
    channel_id: 'channel-1',
    name: 'TEST',
    channel_access_token: 'legacy-token',
    channel_secret: 'legacy-secret',
    channel_access_token_encrypted: null,
    channel_secret_encrypted: null,
    login_channel_id: null,
    login_channel_secret: null,
    liff_id: null,
    is_active: 1,
    country: null,
    role: null,
    display_order: 0,
    token_expires_at: null,
    og_site_name: null,
    og_default_image_url: null,
    og_default_description: null,
    friend_capacity: null,
    capacity_warn_at: null,
    icon_url: null,
    parent_line_account_id: null,
    created_at: '2026-08-23',
    updated_at: '2026-08-23',
    ...overrides,
  };
}

describe('LINE credential AES-GCM encryption', () => {
  it('encrypts and decrypts to the original value', async () => {
    const encrypted = await encryptCredential('token-value', KEY);
    await expect(decryptCredential(encrypted, KEY)).resolves.toBe('token-value');
  });

  it('uses a fresh random IV for every encryption', async () => {
    const first = await encryptCredential('same-value', KEY);
    const second = await encryptCredential('same-value', KEY);
    expect(first).not.toBe(second);
    await expect(decryptCredential(first, KEY)).resolves.toBe('same-value');
    await expect(decryptCredential(second, KEY)).resolves.toBe('same-value');
  });

  it('reports a clear error when the key is missing without module startup failure', async () => {
    await expect(encryptCredential('value', undefined)).rejects.toBeInstanceOf(
      CredentialEncryptionKeyError,
    );
  });

  it('falls back to the legacy plaintext columns when decrypt fails', async () => {
    const encryptedToken = await encryptCredential('new-token', KEY);
    const encryptedSecret = await encryptCredential('new-secret', KEY);
    const resolved = await decryptLineAccountCredentials(
      account({
        channel_access_token_encrypted: encryptedToken,
        channel_secret_encrypted: encryptedSecret,
      }),
      OTHER_KEY,
    );
    expect(resolved.channel_access_token).toBe('legacy-token');
    expect(resolved.channel_secret).toBe('legacy-secret');
  });

  it('does not print plaintext values while encrypting or decrypting', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const encrypted = await encryptCredential('DO-NOT-LOG-TOKEN', KEY);
    await decryptCredential(encrypted, KEY);
    const output = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(output).not.toContain('DO-NOT-LOG-TOKEN');
    log.mockRestore();
    error.mockRestore();
  });

  it('writes both encrypted columns when an account is created', async () => {
    let insertValues: unknown[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          bind(...values: unknown[]) {
            if (sql.includes('INSERT INTO line_accounts')) insertValues = values;
            return statement;
          },
          async first() {
            if (sql.includes('MAX(display_order)')) return { next: 0 };
            if (sql.includes('SELECT * FROM line_accounts')) {
              return account({
                id: String(insertValues[0]),
                channel_id: String(insertValues[1]),
                name: String(insertValues[2]),
                channel_access_token: String(insertValues[3]),
                channel_secret: String(insertValues[4]),
                channel_access_token_encrypted: String(insertValues[5]),
                channel_secret_encrypted: String(insertValues[6]),
              });
            }
            return null;
          },
          async run() {
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const created = await createLineAccount(db, {
      channelId: 'channel-1',
      name: 'TEST',
      channelAccessToken: 'token-value',
      channelSecret: 'secret-value',
    }, KEY);

    expect(insertValues[3]).toBe('token-value');
    expect(insertValues[4]).toBe('secret-value');
    expect(insertValues[5]).not.toBe('token-value');
    expect(insertValues[6]).not.toBe('secret-value');
    expect(created.channel_access_token).toBe('token-value');
    expect(created.channel_secret).toBe('secret-value');
  });
});
