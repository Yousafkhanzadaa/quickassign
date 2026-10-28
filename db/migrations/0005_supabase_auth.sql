-- Sign-in moved to Supabase Auth (Google). Students are identified by their Supabase
-- Auth user id (a UUID, verified from the session JWT); the app keeps no passwords,
-- sessions or 2FA secrets of its own.
--
-- Removes the tables of the previous self-hosted sign-in, where an older database has
-- them (fresh databases never had this schema).
DROP SCHEMA IF EXISTS identity CASCADE;
