-- Files a student attaches to a task themselves (e.g. an assignment that lives on the
-- university portal rather than in the WhatsApp group), plus manual task creation for
-- students who haven't linked WhatsApp.

CREATE TABLE app.task_files (
    id           uuid PRIMARY KEY,
    user_id      text NOT NULL,
    task_id      uuid NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
    blob_id      uuid NOT NULL REFERENCES app.blobs (id) ON DELETE CASCADE,
    filename_enc bytea NOT NULL,
    mime         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_files_task_idx ON app.task_files (user_id, task_id);

ALTER TABLE app.task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.task_files
    USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

GRANT SELECT, INSERT, DELETE ON app.task_files TO qa_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_files TO qa_worker;

CREATE FUNCTION app.create_manual_task(
    p_id uuid, p_title text, p_course_id uuid, p_deadline timestamptz, p_summary_enc bytea
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
    v_no   integer;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    IF length(trim(p_title)) = 0 THEN
        RAISE EXCEPTION 'title required';
    END IF;
    IF p_course_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM app.courses WHERE id = p_course_id AND user_id = v_user) THEN
        RAISE EXCEPTION 'course not found';
    END IF;
    INSERT INTO app.user_counters AS c (user_id, task_seq) VALUES (v_user, 1)
    ON CONFLICT (user_id) DO UPDATE SET task_seq = c.task_seq + 1
    RETURNING task_seq INTO v_no;
    INSERT INTO app.tasks (id, user_id, short_no, course_id, kind, status, title, summary_enc,
                           deadline_at, content_location, confidence)
    VALUES (p_id, v_user, v_no, p_course_id, 'assignment', 'awaiting_confirmation', left(trim(p_title), 200),
            p_summary_enc, p_deadline, 'manual', 1);
    INSERT INTO app.audit_log (user_id, actor, action, details)
    VALUES (v_user, 'user', 'task_created_manually', jsonb_build_object('task_no', v_no));
    RETURN v_no;
END $$;
REVOKE ALL ON FUNCTION app.create_manual_task(uuid, text, uuid, timestamptz, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_manual_task(uuid, text, uuid, timestamptz, bytea) TO qa_web;
