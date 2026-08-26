import { describe, expect, it } from 'vitest';

import { validateInboxSavedViewConditions } from '../src/saved-searches.js';

const valid = {
  version: 1,
  query: '  予約  ',
  channels: ['line', 'email'],
  statuses: ['unread', 'on_hold'],
  assignees: ['me'],
  unread: 'mine',
  messageTypes: ['text'],
  receivedFrom: null,
  receivedTo: null,
  sort: 'waiting_desc',
};

describe('受信箱の保存検索条件', () => {
  it('版付きの受信箱条件だけを正規化して受け付ける', () => {
    const result = validateInboxSavedViewConditions(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.query).toBe('予約');
      expect(result.value.statuses).toEqual(['unread', 'on_hold']);
    }
  });

  it('友だち検索条件や未知の状態を受け付けない', () => {
    expect(validateInboxSavedViewConditions({ all: [{ kind: 'tag', op: 'eq' }] }).ok).toBe(false);
    expect(validateInboxSavedViewConditions({
      ...valid,
      statuses: ['waiting'],
    }).ok).toBe(false);
    expect(validateInboxSavedViewConditions({
      ...valid,
      channels: [],
    }).ok).toBe(false);
  });
});
