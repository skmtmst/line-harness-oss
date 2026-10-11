/** Deterministic synthetic records, including retained -> retained references. */
export function seedDeletionRecords(db, prefix = 'fixture', friendId = 'fixture-friend', count = 1) {
  const insert = (table, row) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  };
  db.exec(`INSERT OR IGNORE INTO tenants(id,name) VALUES ('fixture-tenant','Synthetic');
    INSERT OR IGNORE INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('fixture-account','Synthetic','fixture-channel','fake','fake','fixture-tenant');
    INSERT OR IGNORE INTO staff(id,name,display_name,line_account_id) VALUES ('fixture-staff','Synthetic','Synthetic','fixture-account');
    INSERT OR IGNORE INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('fixture-menu','fixture-account','Synthetic',30,1000);
    INSERT OR IGNORE INTO conversion_points(id,name,event_type) VALUES ('fixture-point','Synthetic','purchase');`);
  db.prepare('INSERT OR IGNORE INTO friends(id,line_user_id,line_account_id) VALUES (?,?,?)').run(friendId, `LINE-${friendId}`, 'fixture-account');
  const common = { line_account_id: 'fixture-account', organization_id: 'fixture-tenant' };
  for (let i = 0; i < count; i++) {
    const ownerId = count > 1 ? `${friendId}-${i}` : friendId;
    if (count > 1) db.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES (?,?,?)').run(ownerId, `LINE-${ownerId}`, 'fixture-account');
    const id = `${prefix}-${i}`, affiliate = `${id}-affiliate`, photo = `${id}-photo`, booking = `${id}-booking`, request = `${id}-request`;
    insert('affiliates', { id: affiliate, name: 'Synthetic', code: affiliate, friend_id: ownerId, tenant_id: 'fixture-tenant', line_account_id: 'fixture-account' });
    insert('conversion_events', { id: `${id}-conversion`, conversion_point_id: 'fixture-point', friend_id: ownerId, affiliate_id: affiliate });
    insert('affiliate_reward_entries', { id: `${id}-entry`, ...common, affiliate_id: affiliate, conversion_event_id: `${id}-conversion`, entry_type: 'credit', amount_minor: 1000, status: 'settled', idempotency_key: id });
    insert('affiliate_adjustments', { id: `${id}-adjustment`, ...common, affiliate_id: affiliate, source_entry_id: `${id}-entry`, amount_minor: -100, reason_type: 'manual', reason: 'Synthetic', actor_id: 'fixture-staff', idempotency_key: id });
    insert('affiliate_settlements', { id: `${id}-settlement`, ...common, affiliate_id: affiliate, period_from: '2026-10-01T00:00:00Z', period_to: '2026-11-01T00:00:00Z', total_amount_minor: 900, state: 'closed', closed_by: 'fixture-staff', idempotency_key: id });
    insert('affiliate_settlement_lines', { id: `${id}-line`, settlement_id: `${id}-settlement`, affiliate_id: affiliate, entry_id: `${id}-entry`, amount_minor: 1000 });
    insert('affiliate_settlement_lines', { id: `${id}-adjustment-line`, settlement_id: `${id}-settlement`, affiliate_id: affiliate, adjustment_id: `${id}-adjustment`, amount_minor: -100 });
    insert('affiliate_payout_batches', { id: `${id}-batch`, ...common, settlement_id: `${id}-settlement`, total_amount_minor: 900, line_count: 2, state: 'created', created_by: 'fixture-staff' });
    insert('affiliate_payout_batch_lines', { id: `${id}-payout`, batch_id: `${id}-batch`, settlement_line_id: `${id}-line`, affiliate_id: affiliate, amount_minor: 900, bank_code: '0001', bank_name: 'Synthetic', branch_code: '001', branch_name: 'Synthetic', account_type: 'ordinary', account_number_encrypted: 'fake', account_last4: '0000', account_holder_name: 'Synthetic' });
    insert('affiliate_payout_results', { id: `${id}-result`, batch_id: `${id}-batch`, affiliate_id: affiliate, settlement_line_id: `${id}-line`, paid_amount_minor: 900, result: 'paid', imported_by: 'fixture-staff' });
    insert('affiliate_statements', { id: `${id}-statement`, ...common, affiliate_id: affiliate, settlement_id: `${id}-settlement`, total_amount_minor: 900, status: 'generated', pdf_object_key: `${id}.pdf`, generated_by: 'fixture-staff' });
    insert('bookings', { id: booking, line_account_id: 'fixture-account', friend_id: ownerId, staff_id: 'fixture-staff', menu_id: 'fixture-menu', starts_at: '2026-10-10T01:00:00Z', ends_at: '2026-10-10T01:30:00Z', block_ends_at: '2026-10-10T01:30:00Z', status: 'confirmed', price_at_booking: 1000, requested_at: '2026-10-01T00:00:00Z' });
    insert('booking_audit_logs', { id: `${id}-audit`, booking_id: booking, line_account_id: 'fixture-account', action: 'created', actor_type: 'system', occurred_at: '2026-10-10T01:00:00Z' });
    insert('booking_payments', { id: `${id}-payment`, booking_id: booking, line_account_id: 'fixture-account', amount: 1000, status: 'paid', provider: 'onsite', idempotency_key: id, paid_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z' });
    insert('mileage_adjustment_approval_requests', { id: request, line_account_id: 'fixture-account', friend_id: ownerId, direction: 'increase', amount: 100, reason_category: 'manual', reason: 'Synthetic', idempotency_key: id, requested_by_staff_id: 'fixture-staff', requested_by_staff_name: 'Synthetic' });
    insert('mileage_adjustment_approval_events', { id: `${id}-event`, request_id: request, actor_staff_id: 'fixture-staff', action: 'requested' });
    insert('nen_pet_profiles', { id: `${id}-pet`, friend_id: ownerId, name: 'Synthetic', created_at: 'now', updated_at: 'now' });
    insert('nen_photo_submissions', { id: photo, friend_id: ownerId, pet_id: `${id}-pet`, line_account_id: 'fixture-account', r2_key: `${id}.png`, image_url: 'https://example.test/synthetic', content_type: 'image/png', created_at: 'now', updated_at: 'now' });
    insert('nen_photo_assessment_runs', { id: `${id}-assessment`, photo_id: photo, line_account_id: 'fixture-account', requested_version: 1, requested_by: 'fixture-staff', idempotency_key: id, request_fingerprint: id, created_at: 'now' });
    insert('nen_photo_original_download_audit', { id: `${id}-download`, photo_id: photo, line_account_id: 'fixture-account', requested_by: 'fixture-staff', event: 'downloaded', created_at: 'now' });
    insert('nen_photo_original_download_grants', { token_hash: `${id}-grant`, photo_id: photo, line_account_id: 'fixture-account', requested_version: 1, requested_by: 'fixture-staff', idempotency_key: id, request_fingerprint: id, expires_at: '2999-01-01', created_at: 'now' });
    insert('nen_photo_review_events', { id: `${id}-review`, photo_id: photo, line_account_id: 'fixture-account', from_status: 'pending', to_status: 'rejected', reviewed_by: 'fixture-staff', reviewed_by_name: 'Synthetic', created_at: 'now', updated_at: 'now' });
    insert('nen_photo_risk_assessments', { id: `${id}-risk`, photo_id: photo, line_account_id: 'fixture-account', flag: 'manual', assessed_at: 'now', created_at: 'now' });
  }
}
