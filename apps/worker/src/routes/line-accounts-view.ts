import type { LineAccount as DbLineAccount } from '@line-crm/db';

export function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    displayName: row.line_display_name || row.name,
    folderId: row.folder_id ?? null,
    pictureUrl: row.line_picture_url ?? null,
    basicId: row.line_basic_id ?? null,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    archivedAt: row.archived_at ?? null,
    // 止めた理由。動いていれば null（-33 §10-1）。
    inactiveReason: row.inactive_reason ?? null,
    inactiveReasonDetail: row.inactive_reason_detail ?? null,
    inactivatedAt: row.inactivated_at ?? null,
    lastWebhookReceivedAt: row.last_webhook_received_at ?? null,
    webhookSilenceExempt: Boolean(row.webhook_silence_exempt ?? 0),
    country: row.country,
    role: row.role,
    timezone: row.timezone ?? 'Asia/Tokyo',
    revision: row.revision ?? 1,
    displayOrder: row.display_order,
    // login_channel_id and liff_id are non-secret identifiers (visible in
    // LINE Developers console, embedded in public LIFF URLs). Safe to expose
    // in list responses so the admin UI can show "Login/LIFF configured?"
    // without a separate fetch.
    loginChannelId: row.login_channel_id,
    liffId: row.liff_id,
    ogSiteName: row.og_site_name,
    ogDefaultImageUrl: row.og_default_image_url,
    ogDefaultDescription: row.og_default_description,
    officialProfileUrl: row.official_profile_url ?? null,
    // 上限とアイコンは鍵ではない。閲覧のみの人にも見せる。
    friendCapacity: row.friend_capacity ?? null,
    capacityWarnAt: row.capacity_warn_at ?? null,
    iconUrl: row.icon_url ?? null,
    parentLineAccountId: row.parent_line_account_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    channelAccessTokenConfigured: Boolean(
      row.channel_access_token_encrypted || row.channel_access_token,
    ),
    channelAccessTokenLast4: row.channel_access_token_last4 ?? null,
    channelAccessTokenUpdatedAt: row.channel_access_token_updated_at ?? null,
    channelSecretConfigured: Boolean(row.channel_secret_encrypted || row.channel_secret),
    channelSecretLast4: row.channel_secret_last4 ?? null,
    channelSecretUpdatedAt: row.channel_secret_updated_at ?? null,
    loginChannelSecretConfigured: Boolean(
      row.login_channel_secret_encrypted || row.login_channel_secret,
    ),
    loginChannelSecretLast4: row.login_channel_secret_last4 ?? null,
    loginChannelSecretUpdatedAt: row.login_channel_secret_updated_at ?? null,
  };
}

export function serializeLineAccountFull(row: DbLineAccount) {
  // Credential values are deliberately never returned after persistence.
  // Owners rotate them by submitting a new value; the UI only sees whether
  // each credential is configured.
  return serializeLineAccount(row);
}
