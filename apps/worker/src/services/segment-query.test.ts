import { describe, expect, it } from 'vitest';
import { buildSegmentQuery, type SegmentCondition } from './segment-query.js';

describe('シナリオ購読で絞る', () => {
  it('シナリオを選ばなければ、どれか1つでも購読している人', () => {
    const condition: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'scenario_subscribed', value: '' }],
    };
    const { sql, bindings } = buildSegmentQuery(condition);
    expect(sql).toContain('FROM friend_scenarios fs');
    expect(sql).toContain("fs.status IN ('active','delivering')");
    expect(sql).not.toContain('fs.scenario_id = ?');
    expect(bindings).toEqual([]);
  });

  it('シナリオを選べば、そのシナリオを購読している人だけ', () => {
    const condition: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'scenario_subscribed', value: 'scenario-1' }],
    };
    const { sql, bindings } = buildSegmentQuery(condition);
    expect(sql).toContain('fs.scenario_id = ?');
    expect(bindings).toEqual(['scenario-1']);
  });

  it('止まっている人・配信し終わった人は入らない', () => {
    const { sql } = buildSegmentQuery({
      operator: 'AND',
      rules: [{ type: 'scenario_subscribed', value: '' }],
    });
    expect(sql).not.toContain("'paused'");
    expect(sql).not.toContain("'completed'");
  });

  it('ブロック中を外す条件と重ねられる', () => {
    const { sql, bindings } = buildSegmentQuery({
      operator: 'AND',
      rules: [
        { type: 'is_following', value: true },
        { type: 'scenario_subscribed', value: 'scenario-1' },
      ],
    });
    expect(sql).toContain('f.is_following = ?');
    expect(sql).toContain(' AND ');
    expect(bindings).toEqual([1, 'scenario-1']);
  });

  it('文字列以外は受け付けない', () => {
    expect(() =>
      buildSegmentQuery({
        operator: 'AND',
        rules: [{ type: 'scenario_subscribed', value: true }],
      }),
    ).toThrow(/scenario_subscribed/);
  });
});

describe('詳細条件で絞る', () => {
  it('行動スコアの範囲を配信確定時の現在値で絞る', () => {
    const { sql, bindings } = buildSegmentQuery({
      operator: 'AND',
      rules: [{ type: 'score_range', value: { min: 30, max: 69 } }],
    });
    expect(sql).toContain('f.score >= ?');
    expect(sql).toContain('f.score <= ?');
    expect(bindings).toEqual([30, 69]);
  });

  it('空または逆転した行動スコア範囲を拒否する', () => {
    expect(() => buildSegmentQuery({
      operator: 'AND', rules: [{ type: 'score_range', value: { min: null, max: null } }],
    })).toThrow(/score_range/);
    expect(() => buildSegmentQuery({
      operator: 'AND', rules: [{ type: 'score_range', value: { min: 70, max: 30 } }],
    })).toThrow(/min <= max/);
  });

  it('友だち情報欄の一致を条件にできる', () => {
    const { sql, bindings } = buildSegmentQuery({
      operator: 'AND',
      rules: [{ type: 'metadata_equals', value: { key: 'gender', value: 'female' } }],
    });
    expect(sql).toContain('json_extract(f.metadata, ?) = ?');
    expect(bindings).toEqual(['$.gender', 'female']);
  });

  it('条件が空なら全員。絞り込みを外した状態と同じ', () => {
    const { sql, bindings } = buildSegmentQuery({ operator: 'AND', rules: [] });
    expect(sql).toContain('WHERE 1=1');
    expect(bindings).toEqual([]);
  });
});
