import {
  CredentialEncryptionKeyError,
  decryptCredential,
  encryptCredential,
} from './credential-crypto.js';

export interface BookingCustomerSummary {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  display_name: string;
  phone_last4: string;
  pet_name: string | null;
  is_line_linked: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingCustomerDetail extends BookingCustomerSummary {
  phone: string;
  email: string | null;
}

interface BookingCustomerRow extends Omit<BookingCustomerSummary, 'is_line_linked'> {
  phone_encrypted: string;
  email_encrypted: string | null;
}

function encryptionSecret(secret: string | undefined): string {
  const value = secret?.trim();
  if (!value) throw new CredentialEncryptionKeyError();
  return value;
}

export function normalizeBookingCustomerPhone(input: string): string {
  const normalized = input.normalize('NFKC').trim();
  const compact = normalized.replace(/[\s()（）\-‐‑–—ー]/g, '');
  if (!/^\+?\d{7,15}$/.test(compact)) {
    throw new Error('booking_customer_phone_invalid');
  }
  return compact;
}

async function phoneHash(phone: string, secret: string | undefined): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${encryptionSecret(secret)}:${phone}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function summary(row: BookingCustomerRow): BookingCustomerSummary {
  return {
    id: row.id,
    line_account_id: row.line_account_id,
    friend_id: row.friend_id,
    display_name: row.display_name,
    phone_last4: row.phone_last4,
    pet_name: row.pet_name,
    is_line_linked: row.friend_id !== null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createBookingCustomer(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    displayName: string;
    phone: string;
    petName?: string | null;
    email?: string | null;
    encryptionKey?: string;
  },
): Promise<BookingCustomerSummary> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100) {
    throw new Error('booking_customer_name_invalid');
  }
  const phone = normalizeBookingCustomerPhone(input.phone);
  const email = input.email?.trim() || null;
  if (email && (email.length > 254 || !email.includes('@'))) {
    throw new Error('booking_customer_email_invalid');
  }
  const petName = input.petName?.trim() || null;
  if (petName && petName.length > 100) throw new Error('booking_customer_pet_name_invalid');
  const secret = encryptionSecret(input.encryptionKey);
  const [hash, phoneEncrypted, emailEncrypted] = await Promise.all([
    phoneHash(phone, secret),
    encryptCredential(phone, secret),
    email ? encryptCredential(email, secret) : Promise.resolve(null),
  ]);
  await db.prepare(
    `INSERT INTO booking_customers (
       id, line_account_id, display_name, phone_normalized_hash,
       phone_encrypted, phone_last4, email_encrypted, pet_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    input.lineAccountId,
    displayName,
    hash,
    phoneEncrypted,
    phone.slice(-4),
    emailEncrypted,
    petName,
  ).run();
  const created = await db.prepare(
    `SELECT id, line_account_id, friend_id, display_name,
            phone_encrypted, phone_last4, email_encrypted, pet_name,
            created_at, updated_at
       FROM booking_customers WHERE id = ? AND line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<BookingCustomerRow>();
  if (!created) throw new Error('booking_customer_create_failed');
  return summary(created);
}

export async function getBookingCustomer(
  db: D1Database,
  id: string,
  lineAccountId: string,
  encryptionKey?: string,
): Promise<BookingCustomerDetail | null> {
  const row = await db.prepare(
    `SELECT id, line_account_id, friend_id, display_name,
            phone_encrypted, phone_last4, email_encrypted, pet_name,
            created_at, updated_at
       FROM booking_customers WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<BookingCustomerRow>();
  if (!row) return null;
  const [phone, email] = await Promise.all([
    decryptCredential(row.phone_encrypted, encryptionKey),
    row.email_encrypted
      ? decryptCredential(row.email_encrypted, encryptionKey)
      : Promise.resolve(null),
  ]);
  return { ...summary(row), phone, email };
}

export async function searchBookingCustomers(
  db: D1Database,
  input: {
    lineAccountId: string;
    query?: string;
    encryptionKey?: string;
    limit?: number;
  },
): Promise<BookingCustomerSummary[]> {
  const query = input.query?.trim() ?? '';
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(Math.trunc(input.limit!), 50))
    : 20;
  let phone: string | null = null;
  try {
    phone = query ? normalizeBookingCustomerPhone(query) : null;
  } catch {
    phone = null;
  }
  const hash = phone ? await phoneHash(phone, input.encryptionKey) : null;
  const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
  const rows = await db.prepare(
    `SELECT id, line_account_id, friend_id, display_name,
            phone_encrypted, phone_last4, email_encrypted, pet_name,
            created_at, updated_at
       FROM booking_customers
      WHERE line_account_id = ?
        AND (? = '' OR display_name LIKE ? ESCAPE '\\' OR phone_normalized_hash = ?)
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`,
  ).bind(
    input.lineAccountId,
    query,
    `%${escaped}%`,
    hash,
    limit,
  ).all<BookingCustomerRow>();
  return rows.results.map(summary);
}
