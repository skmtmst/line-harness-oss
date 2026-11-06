/**
 * Read the CSRF token issued at login. The session credential itself lives in
 * an HttpOnly cookie (never exposed to JS); only the CSRF token is held
 * client-side and echoed back via the X-CSRF-Token header on mutating
 * requests. In a cross-site topology the SPA cannot read the API's CSRF cookie
 * directly, so the token is delivered in the login/session response body and
 * cached here.
 */
// 一斉配信の本送信は取り消せない。サーバー側がこのヘッダを見て、
// 画面の確認手順を経ずに URL を直接叩く操作を弾く。
export const IRREVERSIBLE_BROADCAST_HEADERS = { 'X-Confirm-Irreversible': 'broadcast-send' }
