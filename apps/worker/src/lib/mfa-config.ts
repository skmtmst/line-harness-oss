/** Configuration status only: never include the secret in responses or logs. */
export const MFA_KEY_NOTICE = '二段階認証の鍵が未設定のため、必須にできません';
export function mfaEncryptionConfigured(key?: string): boolean {
  return Boolean(key && key.trim().length >= 32);
}
export function mfaConfiguration(key?: string) {
  const configured = mfaEncryptionConfigured(key);
  return { configured, notice: configured ? null : MFA_KEY_NOTICE };
}
