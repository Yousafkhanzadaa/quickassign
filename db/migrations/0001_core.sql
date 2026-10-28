-- QuickAssign core schema.
--
-- Security model (see docs/security-architecture.md):
--   * Every tenant-owned table has row-level security ENABLED and FORCED, keyed on
--     app.current_user_id(), which each service sets per transaction.
--   * Message bodies, files, solutions and course material are stored encrypted
--     (AES-256-GCM, per-tenant data key). Columns ending in _enc hold ciphertext.
--   * The gateway gets no table privileges in schema app: it can only call the
--     app.gw_* SECURITY DEFINER functions below.
--   * Jobs are enqueued only through SECURITY DEFINER functions that verify ownership.

CREATE SCHEMA app;
CREATE SCHEMA gateway;

CREATE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
CREATE TYPE app.wa_status       AS ENUM ('unlinked', 'pairing', 'linked', 'logged_out', 'temp_banned', 'error');
CREATE TYPE app.sender_role     AS ENUM ('unknown', 'instructor', 'ta', 'class_rep', 'student');
CREATE TYPE app.msg_kind        AS ENUM ('text', 'image', 'document', 'video', 'audio', 'other');
CREATE TYPE app.task_kind       AS ENUM ('assignment', 'project', 'lab', 'quiz', 'exam', 'announcement', 'other');
CREATE TYPE app.task_status     AS ENUM ('awaiting_confirmation', 'queued', 'solving', 'delivered',
                                         'skipped', 'failed', 'reminder_only', 'needs_content');
CREATE TYPE app.material_status AS ENUM ('uploaded', 'processing', 'ready', 'failed');

-- ---------------------------------------------------------------------------
-- Tenant tables (tenant = one student = one better-auth user id)
-- ---------------------------------------------------------------------------
CREATE TABLE app.profiles (
    user_id           text PRIMARY KEY,
    full_name         text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
    roll_number       text CHECK (length(roll_number) <= 64),
    university        text CHECK (length(university) <= 160),
    department        text CHECK (length(department) <= 160),
    program           text CHECK (length(program) <= 120),
    semester          text CHECK (length(semester) <= 40),
    timezone          text NOT NULL DEFAULT 'Asia/Karachi',
    auto_solve        boolean NOT NULL DEFAULT false,
    age_confirmed_at  timestamptz NOT NULL,
    terms_version     text NOT NULL,
    terms_accepted_at timestamptz NOT NULL,
    wa_risk_ack_at    timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant content data key, wrapped (encrypted) with the application KEK.
CREATE TABLE app.tenant_keys (
    user_id     text PRIMARY KEY,
    kek_id      text NOT NULL,
    wrapped_dek bytea NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.user_counters (
    user_id  text PRIMARY KEY,
    task_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE app.wa_links (
    user_id           text PRIMARY KEY,
    status            app.wa_status NOT NULL DEFAULT 'unlinked',
    device_label      text,
    phone_hint        text,          -- masked, e.g. +92•••••••67
    linked_at         timestamptz,
    last_connected_at timestamptz,
    last_error        text,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.courses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text NOT NULL,
    name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    code       text CHECK (length(code) <= 40),
    instructor text CHECK (length(instructor) <= 120),
    notes      text CHECK (length(notes) <= 4000),   -- notation / format preferences
    auto_solve boolean,                               -- NULL = use profile default
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_user_idx ON app.courses (user_id);

CREATE TABLE app.wa_groups (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             text NOT NULL,
    group_jid           text NOT NULL CHECK (group_jid LIKE '%@g.us'),
    name                text,
    is_announcement     boolean NOT NULL DEFAULT false,
    is_community_parent boolean NOT NULL DEFAULT false,
    parent_jid          text,
    participant_count   integer,
    monitored           boolean NOT NULL DEFAULT false,
    course_id           uuid REFERENCES app.courses (id) ON DELETE SET NULL,
    left_at             timestamptz,
    last_seen_at        timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, group_jid)
);

-- Senders are identified only by a keyed per-tenant hash (no phone numbers stored).
CREATE TABLE app.group_senders (
    user_id          text NOT NULL,
    group_jid        text NOT NULL,
    sender_hash      text NOT NULL,
    display_name_enc bytea,
    is_admin         boolean NOT NULL DEFAULT false,
    role             app.sender_role NOT NULL DEFAULT 'unknown',
    message_count    integer NOT NULL DEFAULT 0,
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_jid, sender_hash)
);

CREATE TABLE app.inbound_messages (
    id                  uuid PRIMARY KEY,
    user_id             text NOT NULL,
    group_jid           text NOT NULL,
    wa_message_id       text NOT NULL,
    sender_hash         text NOT NULL,
    sender_is_admin     boolean NOT NULL DEFAULT false,
    sent_at             timestamptz NOT NULL,
    kind                app.msg_kind NOT NULL,
    body_enc            bytea,
    quoted_wa_message_id text,
    media_desc_enc      bytea,          -- serialized WhatsApp media descriptor, for lazy download
    media_mime          text,
    media_size          bigint,
    media_filename_enc  bytea,
    is_backfill         boolean NOT NULL DEFAULT false,
    edited_at           timestamptz,
    revoked_at          timestamptz,
    prefilter_score     real,
    processed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, group_jid, wa_message_id)
);
CREATE INDEX inbound_messages_window_idx ON app.inbound_messages (user_id, group_jid, sent_at);

CREATE TABLE app.self_commands (
    id                   uuid PRIMARY KEY,
    user_id              text NOT NULL,
    wa_message_id        text NOT NULL,
    text_enc             bytea NOT NULL,
    quoted_wa_message_id text,
    processed_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, wa_message_id)
);

CREATE TABLE app.tasks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             text NOT NULL,
    short_no            integer NOT NULL,
    group_jid           text,
    course_id           uuid REFERENCES app.courses (id) ON DELETE SET NULL,
    kind                app.task_kind NOT NULL,
    status              app.task_status NOT NULL,
    title               text NOT NULL CHECK (length(title) <= 200),
    summary_enc         bytea,
    deliverables_enc    bytea,
    deadline_at         timestamptz,
    deadline_confidence real,
    content_location    text,
    confidence          real,
    source_message_ids  uuid[] NOT NULL DEFAULT '{}',
    last_error          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, short_no)
);
CREATE INDEX tasks_user_group_idx ON app.tasks (user_id, group_jid, created_at DESC);

-- Encrypted file storage (materials, attachments, rendered solutions).
CREATE TABLE app.blobs (
    id         uuid PRIMARY KEY,
    user_id    text NOT NULL,
    purpose    text NOT NULL CHECK (purpose IN ('material', 'attachment', 'solution_pdf', 'solution_docx')),
    mime       text NOT NULL,
    size       bigint NOT NULL CHECK (size >= 0),
    data_enc   bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);
CREATE INDEX blobs_user_idx ON app.blobs (user_id);

CREATE TABLE app.attachments (
    message_id uuid PRIMARY KEY REFERENCES app.inbound_messages (id) ON DELETE CASCADE,
    user_id    text NOT NULL,
    blob_id    uuid NOT NULL REFERENCES app.blobs (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.solutions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       text NOT NULL,
    task_id       uuid NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
    version       integer NOT NULL,
    model         text NOT NULL,
    markdown_enc  bytea NOT NULL,
    pdf_blob_id   uuid REFERENCES app.blobs (id) ON DELETE SET NULL,
    docx_blob_id  uuid REFERENCES app.blobs (id) ON DELETE SET NULL,
    warnings      text[] NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_id, version)
);

CREATE TABLE app.materials (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      text NOT NULL,
    course_id    uuid NOT NULL REFERENCES app.courses (id) ON DELETE CASCADE,
    filename_enc bytea NOT NULL,
    mime         text NOT NULL,
    size         bigint NOT NULL,
    blob_id      uuid NOT NULL REFERENCES app.blobs (id) ON DELETE CASCADE,
    status       app.material_status NOT NULL DEFAULT 'uploaded',
    page_count   integer,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materials_course_idx ON app.materials (user_id, course_id);

CREATE TABLE app.material_chunks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     text NOT NULL,
    course_id   uuid NOT NULL REFERENCES app.courses (id) ON DELETE CASCADE,
    material_id uuid NOT NULL REFERENCES app.materials (id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    page_from   integer,
    page_to     integer,
    content_enc bytea NOT NULL,
    embedding   vector(1536) NOT NULL
);
-- Per-course corpora are small, so exact search over this index beats an ANN index
-- that would apply the tenant filter after the scan.
CREATE INDEX material_chunks_course_idx ON app.material_chunks (user_id, course_id);

-- Messages we sent to the student's own chat (used to recognise quoted replies).
CREATE TABLE app.outbound_messages (
    user_id       text NOT NULL,
    wa_message_id text NOT NULL,
    kind          text NOT NULL,
    task_id       uuid REFERENCES app.tasks (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, wa_message_id)
);

CREATE TABLE app.credit_ledger (
    id         bigserial PRIMARY KEY,
    user_id    text NOT NULL,
    delta      integer NOT NULL,
    reason     text NOT NULL,
    ref        text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, reason, ref)
);

CREATE TABLE app.usage_events (
    id                  bigserial PRIMARY KEY,
    user_id             text NOT NULL,
    kind                text NOT NULL,
    model               text NOT NULL,
    input_tokens        integer NOT NULL DEFAULT 0,
    cached_input_tokens integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cost_usd            numeric(12, 6) NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Never put message content or phone numbers in details.
CREATE TABLE app.audit_log (
    id         bigserial PRIMARY KEY,
    user_id    text,
    actor      text NOT NULL CHECK (actor IN ('user', 'system', 'gateway', 'worker', 'admin')),
    action     text NOT NULL,
    details    jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON app.audit_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security on every tenant table
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'profiles', 'tenant_keys', 'user_counters', 'wa_links', 'courses', 'wa_groups',
        'group_senders', 'inbound_messages', 'self_commands', 'tasks', 'blobs', 'attachments',
        'solutions', 'materials', 'material_chunks', 'outbound_messages', 'credit_ledger',
        'usage_events', 'audit_log'
    ] LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON app.%I USING (user_id = app.current_user_id()) '
            'WITH CHECK (user_id = app.current_user_id())', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Gateway-private schema (WhatsApp session registry). No other role can read it.
-- ---------------------------------------------------------------------------
CREATE TABLE gateway.sessions (
    user_id     text PRIMARY KEY,
    store_file  text NOT NULL UNIQUE,   -- random name; holds the encrypted whatsmeow store
    kek_id      text NOT NULL,
    wrapped_dek bytea NOT NULL,         -- store key, wrapped with the GATEWAY KEK
    status      text NOT NULL CHECK (status IN ('pairing', 'linked')),
    lease_owner text,
    lease_until timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Gateway API: SECURITY DEFINER functions. Each one scopes itself to one tenant.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.gw_set_link_status(
    p_user_id text, p_status app.wa_status, p_device_label text, p_phone_hint text, p_error text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    INSERT INTO app.wa_links AS l (user_id, status, device_label, phone_hint, linked_at, last_connected_at, last_error, updated_at)
    VALUES (p_user_id, p_status, p_device_label, p_phone_hint,
            CASE WHEN p_status = 'linked' THEN now() END,
            CASE WHEN p_status = 'linked' THEN now() END,
            left(p_error, 300), now())
    ON CONFLICT (user_id) DO UPDATE SET
        status            = excluded.status,
        device_label      = coalesce(excluded.device_label, l.device_label),
        phone_hint        = coalesce(excluded.phone_hint, l.phone_hint),
        linked_at         = CASE WHEN excluded.status = 'linked' AND l.status <> 'linked' THEN now()
                                 WHEN excluded.status IN ('unlinked', 'logged_out') THEN NULL
                                 ELSE l.linked_at END,
        last_connected_at = CASE WHEN excluded.status = 'linked' THEN now() ELSE l.last_connected_at END,
        last_error        = excluded.last_error,
        updated_at        = now();
    INSERT INTO app.audit_log (user_id, actor, action, details)
    VALUES (p_user_id, 'gateway', 'wa_status', jsonb_build_object('status', p_status));
END $$;

CREATE FUNCTION app.gw_get_content_key(p_user_id text)
RETURNS TABLE (kek_id text, wrapped_dek bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    RETURN QUERY SELECT k.kek_id, k.wrapped_dek FROM app.tenant_keys k WHERE k.user_id = p_user_id;
END $$;

CREATE FUNCTION app.gw_put_content_key(p_user_id text, p_kek_id text, p_wrapped_dek bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    INSERT INTO app.tenant_keys (user_id, kek_id, wrapped_dek)
    VALUES (p_user_id, p_kek_id, p_wrapped_dek)
    ON CONFLICT (user_id) DO NOTHING;
END $$;

CREATE FUNCTION app.gw_upsert_groups(p_user_id text, p_groups jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    n integer;
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    INSERT INTO app.wa_groups AS w (user_id, group_jid, name, is_announcement, is_community_parent,
                                    parent_jid, participant_count, left_at, last_seen_at, updated_at)
    SELECT p_user_id, g->>'jid', left(g->>'name', 200),
           coalesce((g->>'is_announcement')::boolean, false),
           coalesce((g->>'is_parent')::boolean, false),
           nullif(g->>'parent_jid', ''),
           (g->>'participants')::integer, NULL, now(), now()
    FROM jsonb_array_elements(p_groups) AS g
    WHERE g->>'jid' LIKE '%@g.us'
    ON CONFLICT (user_id, group_jid) DO UPDATE SET
        name                = excluded.name,
        is_announcement     = excluded.is_announcement,
        is_community_parent = excluded.is_community_parent,
        parent_jid          = excluded.parent_jid,
        participant_count   = excluded.participant_count,
        left_at             = NULL,
        last_seen_at        = now(),
        updated_at          = now();
    GET DIAGNOSTICS n = ROW_COUNT;

    UPDATE app.wa_groups SET monitored = false, left_at = now(), updated_at = now()
    WHERE user_id = p_user_id AND left_at IS NULL
      AND group_jid NOT IN (SELECT g->>'jid' FROM jsonb_array_elements(p_groups) AS g);
    RETURN n;
END $$;

CREATE FUNCTION app.gw_list_monitored(p_user_id text)
RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    RETURN QUERY SELECT w.group_jid FROM app.wa_groups w
                 WHERE w.user_id = p_user_id AND w.monitored AND w.left_at IS NULL;
END $$;

CREATE FUNCTION app.gw_ingest_message(
    p_id uuid, p_user_id text, p_group_jid text, p_wa_message_id text,
    p_sender_hash text, p_sender_is_admin boolean, p_sender_name_enc bytea,
    p_sent_at timestamptz, p_kind app.msg_kind, p_body_enc bytea, p_quoted text,
    p_media_desc_enc bytea, p_media_mime text, p_media_size bigint, p_media_filename_enc bytea,
    p_is_edit boolean, p_is_backfill boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);

    -- Defence in depth: only accept messages for groups the student chose to monitor.
    IF NOT EXISTS (SELECT 1 FROM app.wa_groups
                   WHERE user_id = p_user_id AND group_jid = p_group_jid AND monitored AND left_at IS NULL) THEN
        RETURN NULL;
    END IF;

    IF p_is_edit THEN
        UPDATE app.inbound_messages
        SET body_enc = p_body_enc, edited_at = now(), processed_at = NULL
        WHERE user_id = p_user_id AND group_jid = p_group_jid AND wa_message_id = p_wa_message_id
        RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO app.inbound_messages (id, user_id, group_jid, wa_message_id, sender_hash, sender_is_admin,
                                          sent_at, kind, body_enc, quoted_wa_message_id, media_desc_enc,
                                          media_mime, media_size, media_filename_enc, is_backfill,
                                          edited_at)
        VALUES (p_id, p_user_id, p_group_jid, p_wa_message_id, p_sender_hash, p_sender_is_admin,
                p_sent_at, p_kind, p_body_enc, p_quoted, p_media_desc_enc,
                p_media_mime, p_media_size, p_media_filename_enc, p_is_backfill,
                CASE WHEN p_is_edit THEN now() END)
        ON CONFLICT (user_id, group_jid, wa_message_id) DO NOTHING
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RETURN NULL; -- duplicate delivery
        END IF;
    END IF;

    INSERT INTO app.group_senders AS s (user_id, group_jid, sender_hash, display_name_enc, is_admin,
                                        message_count, last_seen_at)
    VALUES (p_user_id, p_group_jid, p_sender_hash, p_sender_name_enc, p_sender_is_admin, 1, now())
    ON CONFLICT (user_id, group_jid, sender_hash) DO UPDATE SET
        display_name_enc = coalesce(excluded.display_name_enc, s.display_name_enc),
        is_admin         = excluded.is_admin,
        message_count    = s.message_count + 1,
        last_seen_at     = now();

    PERFORM graphile_worker.add_job(
        'inbound_message',
        json_build_object('user_id', p_user_id, 'message_id', v_id),
        max_attempts := 5);
    RETURN v_id;
END $$;

CREATE FUNCTION app.gw_mark_revoked(p_user_id text, p_group_jid text, p_wa_message_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    UPDATE app.inbound_messages SET revoked_at = now(), body_enc = NULL, media_desc_enc = NULL
    WHERE user_id = p_user_id AND group_jid = p_group_jid AND wa_message_id = p_wa_message_id;
END $$;

CREATE FUNCTION app.gw_ingest_command(
    p_id uuid, p_user_id text, p_wa_message_id text, p_text_enc bytea, p_quoted text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    INSERT INTO app.self_commands (id, user_id, wa_message_id, text_enc, quoted_wa_message_id)
    VALUES (p_id, p_user_id, p_wa_message_id, p_text_enc, p_quoted)
    ON CONFLICT (user_id, wa_message_id) DO NOTHING;
    IF FOUND THEN
        PERFORM graphile_worker.add_job(
            'self_command', json_build_object('user_id', p_user_id, 'command_id', p_id),
            max_attempts := 3);
    END IF;
END $$;

CREATE FUNCTION app.gw_get_media_descriptor(p_user_id text, p_message_id uuid)
RETURNS TABLE (kind app.msg_kind, media_desc_enc bytea, media_mime text, media_size bigint,
               group_jid text, wa_message_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.user_id', p_user_id, true);
    RETURN QUERY SELECT m.kind, m.media_desc_enc, m.media_mime, m.media_size, m.group_jid, m.wa_message_id
                 FROM app.inbound_messages m
                 WHERE m.user_id = p_user_id AND m.id = p_message_id AND m.revoked_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Web/worker API: enqueue jobs only for rows the caller owns.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.enqueue_solve(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user   text := app.current_user_id();
    v_kind   app.task_kind;
    v_status app.task_status;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    SELECT t.kind, t.status INTO v_kind, v_status
    FROM app.tasks t WHERE t.id = p_task_id AND t.user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'task not found';
    END IF;
    IF v_kind IN ('quiz', 'exam', 'announcement') THEN
        RAISE EXCEPTION 'this task type is never solved';
    END IF;
    IF v_status IN ('queued', 'solving') THEN
        RETURN;
    END IF;
    UPDATE app.tasks SET status = 'queued', last_error = NULL, updated_at = now() WHERE id = p_task_id;
    PERFORM graphile_worker.add_job(
        'solve_task', json_build_object('user_id', v_user, 'task_id', p_task_id),
        job_key := 'solve:' || p_task_id::text, max_attempts := 2);
END $$;

CREATE FUNCTION app.enqueue_material_ingest(p_material_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    UPDATE app.materials SET status = 'processing' WHERE id = p_material_id AND user_id = v_user;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'material not found';
    END IF;
    PERFORM graphile_worker.add_job(
        'ingest_material', json_build_object('user_id', v_user, 'material_id', p_material_id),
        job_key := 'ingest:' || p_material_id::text, max_attempts := 3);
END $$;

CREATE FUNCTION app.enqueue_account_purge()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    PERFORM graphile_worker.add_job(
        'purge_account', json_build_object('user_id', v_user),
        job_key := 'purge:' || v_user, max_attempts := 10);
END $$;

CREATE FUNCTION app.grant_signup_credits(p_amount integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    IF p_amount < 0 OR p_amount > 20 THEN
        RAISE EXCEPTION 'invalid signup credit amount';
    END IF;
    INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
    VALUES (v_user, p_amount, 'signup', 'signup')
    ON CONFLICT (user_id, reason, ref) DO NOTHING;
END $$;

CREATE FUNCTION app.skip_task(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    UPDATE app.tasks SET status = 'skipped', updated_at = now()
    WHERE id = p_task_id AND user_id = v_user AND status IN ('awaiting_confirmation', 'needs_content', 'failed');
END $$;

-- ---------------------------------------------------------------------------
-- Retention: runs as qa_maint (BYPASSRLS) but only through this function.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.purge_expired()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    n_msgs integer;
    n_blobs integer;
    n_cmds integer;
BEGIN
    DELETE FROM app.inbound_messages WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS n_msgs = ROW_COUNT;
    DELETE FROM app.blobs WHERE expires_at IS NOT NULL AND expires_at < now();
    GET DIAGNOSTICS n_blobs = ROW_COUNT;
    DELETE FROM app.self_commands WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS n_cmds = ROW_COUNT;
    RETURN jsonb_build_object('messages', n_msgs, 'blobs', n_blobs, 'commands', n_cmds);
END $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO qa_web, qa_worker, qa_gateway, qa_maint;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO qa_web, qa_worker, qa_gateway, qa_maint;

-- Gateway: functions only.
GRANT EXECUTE ON FUNCTION
    app.gw_set_link_status(text, app.wa_status, text, text, text),
    app.gw_get_content_key(text),
    app.gw_put_content_key(text, text, bytea),
    app.gw_upsert_groups(text, jsonb),
    app.gw_list_monitored(text),
    app.gw_ingest_message(uuid, text, text, text, text, boolean, bytea, timestamptz, app.msg_kind, bytea,
                          text, bytea, text, bigint, bytea, boolean, boolean),
    app.gw_mark_revoked(text, text, text),
    app.gw_ingest_command(uuid, text, text, bytea, text),
    app.gw_get_media_descriptor(text, uuid)
TO qa_gateway;
GRANT USAGE ON SCHEMA gateway TO qa_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway.sessions TO qa_gateway;

-- Web: what the dashboard needs, nothing more.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.profiles, app.courses, app.materials TO qa_web;
GRANT SELECT, INSERT ON app.tenant_keys TO qa_web;
GRANT SELECT ON app.wa_links, app.tasks, app.solutions, app.credit_ledger, app.usage_events,
                app.inbound_messages, app.attachments TO qa_web;
GRANT SELECT, UPDATE (monitored, course_id, updated_at) ON app.wa_groups TO qa_web;
GRANT SELECT, UPDATE (role) ON app.group_senders TO qa_web;
GRANT UPDATE (course_id, updated_at) ON app.tasks TO qa_web;
GRANT SELECT, INSERT, DELETE ON app.blobs TO qa_web;
GRANT SELECT, INSERT ON app.audit_log TO qa_web;
GRANT EXECUTE ON FUNCTION app.enqueue_solve(uuid), app.enqueue_material_ingest(uuid),
                          app.enqueue_account_purge(), app.grant_signup_credits(integer),
                          app.skip_task(uuid) TO qa_web;

-- Worker: full DML on tenant tables (RLS still applies), append-only audit.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO qa_worker;
REVOKE UPDATE, DELETE ON app.audit_log, app.credit_ledger FROM qa_worker;
GRANT EXECUTE ON FUNCTION app.enqueue_solve(uuid), app.purge_expired() TO qa_worker;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO qa_web, qa_worker;

-- Maintenance role owns the purge function so it can bypass RLS for retention only.
GRANT SELECT, DELETE ON app.inbound_messages, app.blobs, app.self_commands TO qa_maint;
GRANT CREATE ON SCHEMA app TO qa_maint;
ALTER FUNCTION app.purge_expired() OWNER TO qa_maint;
