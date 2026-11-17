-- Real email delivery: record who each notification went to and why it failed.
-- 'skipped' = email isn't set up yet, so nothing was sent (previously these showed as "sent").
ALTER TABLE notification_logs ADD COLUMN recipient TEXT;
ALTER TABLE notification_logs ADD COLUMN error TEXT;
ALTER TABLE notification_logs DROP CONSTRAINT notification_logs_status_check;
ALTER TABLE notification_logs ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN ('sent', 'pending', 'failed', 'skipped'));

-- The old code logged emails as "sent" without sending anything. Mark them honestly.
UPDATE notification_logs SET status = 'skipped', error = 'Recorded before email was connected; never sent.'
WHERE channel = 'email';
