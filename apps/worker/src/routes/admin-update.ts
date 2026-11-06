import { Hono } from 'hono';

/** 配備は運用 CLI/CI に限定し、長期の配備キーをアプリ認証に使わせない。設定で HTTP 更新を再開せず、すべて拒む。将来の追加にはセッション・MFA・対象制限・必須監査の設計が必要。公開版情報は別 route で扱う。 */
const app = new Hono();
app.all('*', (c) => c.notFound());
export default app;
