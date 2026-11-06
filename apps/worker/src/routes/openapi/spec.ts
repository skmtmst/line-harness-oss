import { schemas } from './schemas.js';
import { paths } from './paths.js';
import { withApiErrorContract } from './error-contract.js';

export const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LINE OSS CRM API',
    version: '0.24.0',
    description: 'Open-source LINE Official Account CRM/marketing automation API. API-first design for Claude Code / AI agent integration.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Current server' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      liffIdToken: {type:'http',scheme:'bearer',description:'指定した店舗のLINE Login IDトークン。APIキーとは別。'},
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API Key passed as Bearer token',
      },
    },
    schemas,
  },
  paths: withApiErrorContract(paths),
  tags: [
    { name: 'Dashboard', description: 'ダッシュボードの予定・数字の出どころ・印刷' },
    { name: 'Friends', description: '友だち管理' },
    { name: 'HQ Templates', description: '統括ひな形の作成・事前検査・店舗配布' },
    { name: 'Tags', description: 'タグ管理' },
    { name: 'Friend Attributes', description: '友だち情報欄・対応マーク・保存した検索' },
    { name: 'Scenarios', description: 'ステップ配信シナリオ' },
    { name: 'Broadcasts', description: '一斉配信' },
    { name: 'NEN delivery', description: 'NEN専用配信・コラム・ペット実績' },
    { name: 'Users', description: 'UUID Cross-Account ユーザー管理' },
    { name: 'LINE Accounts', description: 'マルチLINEアカウント管理' },
    { name: 'Conversions', description: 'コンバージョン計測' },
    { name: 'Affiliates', description: 'アフィリエイト管理' },
    { name: 'Booking', description: '予約設定' },
    { name: 'Events', description: 'イベント予約とキャンセル待ち' },
    { name: 'Templates', description: 'テンプレート公開版' },
    { name: 'Forms', description: '回答フォーム' },
    { name: 'Rich Menus', description: 'リッチメニュー公開予約' },
    { name: 'Common Vars', description: '共通情報と監査付きCSV書き出し' },
    { name: 'Automations', description: 'オートメーションの定義・実行記録' },
    { name: 'Webinars', description: 'ウェビナーの動画素材・開催回の定員' },
    { name: 'Settings', description: '機能設定' },
    { name: 'Operator notifications', description: '運用者へのお知らせの自動実行' },
    { name: 'Webhook', description: 'LINE Webhook' },
  ],
};
