export interface R2PresignedUploadConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export interface R2PresignedUploadInput {
  key: string;
  contentType: string;
  lineAccountId: string;
  uploadSessionId: string;
  expiresInSeconds?: number;
  now?: Date;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(bucket: string, key: string): string {
  return `/${awsEncode(bucket)}/${key.split('/').map(awsEncode).join('/')}`;
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
}

export async function createR2PresignedPutUrl(
  config: R2PresignedUploadConfig,
  input: R2PresignedUploadInput,
): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> {
  const expiresInSeconds = Math.min(900, Math.max(60, input.expiresInSeconds ?? 900));
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const scope = `${date}/${region}/${service}/aws4_request`;
  const signedHeaders = 'content-type;host;x-amz-meta-line-account-id;x-amz-meta-upload-session-id';
  const headers = {
    'Content-Type': input.contentType,
    'x-amz-meta-line-account-id': input.lineAccountId,
    'x-amz-meta-upload-session-id': input.uploadSessionId,
  };
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
  const canonicalHeaders = [
    `content-type:${input.contentType.trim()}\n`,
    `host:${host}\n`,
    `x-amz-meta-line-account-id:${input.lineAccountId.trim()}\n`,
    `x-amz-meta-upload-session-id:${input.uploadSessionId.trim()}\n`,
  ].join('');
  const canonicalRequest = [
    'PUT', canonicalUri(config.bucketName, input.key), canonicalQuery, canonicalHeaders,
    signedHeaders, 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest),
  ].join('\n');
  const dateKey = await hmac(encoder.encode(`AWS4${config.secretAccessKey}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  const signingKey = await hmac(serviceKey, 'aws4_request');
  query.set('X-Amz-Signature', hex(await hmac(signingKey, stringToSign)));
  const sortedQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
  return {
    url: `https://${host}${canonicalUri(config.bucketName, input.key)}?${sortedQuery}`,
    headers,
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
  };
}
