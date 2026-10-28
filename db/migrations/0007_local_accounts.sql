-- Sign-in moves from Supabase Auth to local accounts: an email address and a password,
-- checked by the web app. Everything runs on the operator's own database.
--
--   * Passwords are hashed with scrypt in the web app; the database never sees them.
--   * A session is a random token in an HttpOnly cookie; the database keeps only its
--     SHA-256, so a copy of this table can't be used to sign in.
--   * Account ids are UUIDs, the tenant id everywhere else (app.current_user_id()).
--   * No application role can read these tables. The web app and the worker get only
--     the functions below, each granted to the one role that needs it.
CREATE SCHEMA qa_auth;
REVOKE ALL ON SCHEMA qa_auth FROM PUBLIC;

CREATE TABLE qa_auth.users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email               text NOT NULL UNIQUE
                        CHECK (email = lower(email) AND length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
    name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    password_hash       text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
    created_at          timestamptz NOT NULL DEFAULT now(),
    password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qa_auth.sessions (
    token_hash   bytea PRIMARY KEY CHECK (length(token_hash) = 32),
    user_id      uuid NOT NULL REFERENCES qa_auth.users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON qa_auth.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON qa_auth.sessions (expires_at);

-- No policies: only the owner (the functions below) can see rows, even if a grant slips in.
ALTER TABLE qa_auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_auth.sessions ENABLE ROW LEVEL SECURITY;

-- Creates an account. Returns NULL when the email address is already registered.
CREATE FUNCTION qa_auth.sign_up(p_email text, p_name text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO qa_auth.users (email, name, password_hash)
    VALUES (p_email, p_name, p_password_hash)
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- The stored hash for an email address, so the web app can check a password.
CREATE FUNCTION qa_auth.password_hash(p_email text)
RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u.id, u.password_hash FROM qa_auth.users u WHERE u.email = p_email;
$$;

-- Stores a new hash: a changed password, or a stronger hash of the same password.
CREATE FUNCTION qa_auth.set_password_hash(p_user_id uuid, p_password_hash text, p_changed boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE qa_auth.users
    SET password_hash = p_password_hash,
        password_changed_at = CASE WHEN p_changed THEN now() ELSE password_changed_at END
    WHERE id = p_user_id;
END $$;

-- Sessions last 30 days and are extended while in use (at most one write a day).
CREATE FUNCTION qa_auth.start_session(p_user_id uuid, p_token_hash bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    DELETE FROM qa_auth.sessions WHERE expires_at < now();
    INSERT INTO qa_auth.sessions (token_hash, user_id, expires_at)
    VALUES (p_token_hash, p_user_id, now() + interval '30 days');
END $$;

CREATE FUNCTION qa_auth.session_account(p_token_hash bytea)
RETURNS TABLE (user_id uuid, email text, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE qa_auth.sessions
    SET expires_at = now() + interval '30 days', last_seen_at = now()
    WHERE token_hash = p_token_hash AND expires_at > now() AND expires_at < now() + interval '29 days';
    RETURN QUERY
    SELECT u.id, u.email, u.name
    FROM qa_auth.sessions s JOIN qa_auth.users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash AND s.expires_at > now();
END $$;

CREATE FUNCTION qa_auth.end_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
    DELETE FROM qa_auth.sessions WHERE token_hash = p_token_hash;
$$;

-- Ends every session of the account that owns p_token_hash ("sign out of all devices",
-- or the other devices after a password change). The account comes from the token, so
-- the caller can only ever sign out itself.
CREATE FUNCTION qa_auth.end_all_sessions(p_token_hash bytea, p_keep_current boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user uuid;
    n integer;
BEGIN
    SELECT s.user_id INTO v_user FROM qa_auth.sessions s WHERE s.token_hash = p_token_hash AND s.expires_at > now();
    IF v_user IS NULL THEN
        RETURN 0;
    END IF;
    DELETE FROM qa_auth.sessions
    WHERE user_id = v_user AND NOT (p_keep_current AND token_hash = p_token_hash);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- Account deletion: the worker's purge job removes the account last (sessions cascade).
CREATE FUNCTION qa_auth.delete_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    DELETE FROM qa_auth.users WHERE id = p_user_id;
    RETURN FOUND;
END $$;

-- Operator only (scripts/reset-password.sh, as qa_owner): sets a new password for a
-- student who forgot theirs and signs them out everywhere. No application role may call it.
CREATE FUNCTION qa_auth.reset_password(p_email text, p_password_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user uuid;
BEGIN
    UPDATE qa_auth.users SET password_hash = p_password_hash, password_changed_at = now()
    WHERE email = lower(p_email)
    RETURNING id INTO v_user;
    IF v_user IS NULL THEN
        RETURN false;
    END IF;
    DELETE FROM qa_auth.sessions WHERE user_id = v_user;
    RETURN true;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qa_auth FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA qa_auth REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA qa_auth TO qa_web, qa_worker;
GRANT EXECUTE ON FUNCTION
    qa_auth.sign_up(text, text, text),
    qa_auth.password_hash(text),
    qa_auth.set_password_hash(uuid, text, boolean),
    qa_auth.start_session(uuid, bytea),
    qa_auth.session_account(bytea),
    qa_auth.end_session(bytea),
    qa_auth.end_all_sessions(bytea, boolean)
TO qa_web;
GRANT EXECUTE ON FUNCTION qa_auth.delete_user(uuid) TO qa_worker;
