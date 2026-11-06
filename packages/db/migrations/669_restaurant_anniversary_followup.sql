-- B-324 approved. Add an editable, initially stopped anniversary step to the common scenario.
INSERT OR IGNORE INTO scenario_steps(id,scenario_id,step_order,message_type,message_content,is_draft)
SELECT 'restaurant-followup:'||t.store_id||':anniversary_before',t.scenario_id,
 COALESCE((SELECT MAX(step_order)+1 FROM scenario_steps WHERE scenario_id=t.scenario_id),0),
 'text','もうすぐ記念日ですね。ご来店をお待ちしています。',0 FROM rt_store_followup_templates t;
INSERT OR IGNORE INTO rt_store_followup_step_bindings(store_id,trigger,step_id,offset_minutes,enabled)
SELECT store_id,'anniversary_before','restaurant-followup:'||store_id||':anniversary_before',-10080,0 FROM rt_store_followup_templates;
CREATE TRIGGER rt_followup_anniversary_created AFTER INSERT ON rt_store_followup_templates BEGIN INSERT OR IGNORE INTO scenario_steps(id,scenario_id,step_order,message_type,message_content,is_draft) VALUES('restaurant-followup:'||NEW.store_id||':anniversary_before',NEW.scenario_id, COALESCE((SELECT MAX(step_order)+1 FROM scenario_steps WHERE scenario_id=NEW.scenario_id),0), 'text','もうすぐ記念日ですね。ご来店をお待ちしています。',0); INSERT OR IGNORE INTO rt_store_followup_step_bindings(store_id,trigger,step_id,offset_minutes,enabled) VALUES(NEW.store_id,'anniversary_before','restaurant-followup:'||NEW.store_id||':anniversary_before',-10080,0); END;
