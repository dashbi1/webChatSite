-- ============================================================
-- Anti-Abuse Phase 3 Fix Pack: dedup / decay seed
-- ============================================================
-- 给 12 条风控规则的 params 合并去重/衰减配置：
--   dedup_mode:          'none' | 'once' | 'decay'
--   dedup_window_hours:  窗口长度（null = 永久）
--   decay_factor:        衰减系数（仅 decay 用，默认 0.5）
--
-- 用 params || '...'::jsonb 保留已有的 threshold / max_accounts 等阈值参数
--
-- ROLLBACK（把 dedup_* 字段删除）：
--   UPDATE risk_rules SET params = params - 'dedup_mode' - 'dedup_window_hours' - 'decay_factor';
-- ============================================================

BEGIN;

-- once 模式
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":24}'::jsonb
  WHERE code='REGISTER_QUICK_POST';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":24}'::jsonb
  WHERE code='DEVICE_MULTI_ACCOUNT';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":1}'::jsonb
  WHERE code='IP_CIDR24_BURST';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":720}'::jsonb
  WHERE code='ASN_DATACENTER';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":null}'::jsonb
  WHERE code='COLD_EMAIL_DOMAIN';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":24}'::jsonb
  WHERE code='DEFAULT_PROFILE';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":720}'::jsonb
  WHERE code='EMULATOR_OR_ROOT';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":1}'::jsonb
  WHERE code='NO_FINGERPRINT';
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":24}'::jsonb
  WHERE code='ISOLATED_ISLAND';

-- decay 模式
UPDATE risk_rules SET params = params || '{"dedup_mode":"decay","dedup_window_hours":1,"decay_factor":0.5}'::jsonb
  WHERE code='NEW_ACCOUNT_BURST';
UPDATE risk_rules SET params = params || '{"dedup_mode":"decay","dedup_window_hours":24,"decay_factor":0.5}'::jsonb
  WHERE code='SIMHASH_SIMILAR';
UPDATE risk_rules SET params = params || '{"dedup_mode":"decay","dedup_window_hours":1,"decay_factor":0.5}'::jsonb
  WHERE code='APK_SIGNATURE_FAIL';

COMMIT;
