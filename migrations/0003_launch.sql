-- Launch essentials: remember WHICH terms a trade customer accepted (their own URL or the built-in
-- template version), so a later change of terms is traceable. The time is in terms_accepted_at.
ALTER TABLE partners ADD COLUMN terms_version TEXT;
