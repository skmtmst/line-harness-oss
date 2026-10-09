import { COMPANY_CONTACT_FIELDS } from '@line-crm/shared';

const properties = Object.fromEntries(COMPANY_CONTACT_FIELDS.map(field => [field.key, {
  type: field.required ? 'string' : ['string', 'null'], maxLength: field.max,
  ...(field.required ? { minLength: 1 } : {}),
}]));
const response = { description: '8項目とrevision（未登録項目はnull）。会社の表示設定と既存の版を共用。',
  content: { 'application/json': { schema: { type: 'object', properties: {
    success: { const: true }, data: { type: 'object', required: [...COMPANY_CONTACT_FIELDS.map(field => field.key), 'revision'],
      properties: { ...Object.fromEntries(COMPANY_CONTACT_FIELDS.map(field => [field.key, { type: ['string', 'null'] }])), revision: { type: 'integer', minimum: 0 } } },
  } } } } };

export const tenantCompanyContactPaths = {
  '/api/tenants/me/company-contact': {
    get: {
      tags: ['Tenants'], summary: '所属する統括の会社と連絡先を読む（オーナー・管理者）',
      description: '通常のメンバーには返さない。統括名だけのGET /api/tenants/meとは別の口。',
      responses: { '200': response, '403': { description: '管理権限なし' }, '404': { description: '統括なし' } },
    },
    patch: {
      tags: ['Tenants'], summary: '所属する統括の会社と連絡先を保存する（オーナー・管理者）',
      description: '郵便番号は7桁（ハイフン許可・保存時除去）。電話番号は国内10〜11桁または+付き国際番号10〜15桁。必須6項目、任意2項目。同じ内容の再送は版と監査を増やさず成功。異なる内容で版が古いと409。閲覧のみは保存不可。',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: [...COMPANY_CONTACT_FIELDS.filter(field => field.required).map(field => field.key), 'expectedRevision'],
        properties: { ...properties, expectedRevision: { type: 'integer', minimum: 0 } },
      } } } },
      responses: { '200': response, '400': { description: '必須・形式・版が不正' }, '403': { description: '管理権限なし・閲覧のみ' },
        '404': { description: '統括なし' }, '409': { description: 'VERSION_CONFLICT：別の人が先に更新した。入力を保持し、読み直す前に控える。' } },
    },
  },
};
