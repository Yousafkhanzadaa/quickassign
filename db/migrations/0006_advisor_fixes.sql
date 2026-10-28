-- Hardening and performance fixes from Supabase's database advisors.

-- 1. Pin search_path on the two plain (SECURITY INVOKER) helper functions. They run with
--    the caller's own rights, so this is defence in depth (Supabase lint 0011).
ALTER FUNCTION app.current_user_id() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION app.credit_balance() SET search_path = pg_catalog, pg_temp;

-- 2. Evaluate the tenant id once per statement instead of once per row. Wrapping the call
--    in a sub-select lets Postgres compute it once (Supabase's recommended RLS form).
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT tablename FROM pg_policies
        WHERE schemaname = 'app' AND policyname = 'tenant_isolation' AND cmd = 'ALL'
    LOOP
        EXECUTE format(
            'ALTER POLICY tenant_isolation ON app.%I USING (user_id = (SELECT app.current_user_id())) '
            'WITH CHECK (user_id = (SELECT app.current_user_id()))', r.tablename);
    END LOOP;
END $$;

-- 3. app.payments: the tenant policy is for the application roles; the billing functions
--    (owned by qa_owner) have their own policy. One permissive policy per role (lint 0006).
ALTER POLICY tenant_isolation ON app.payments TO qa_web, qa_worker;

-- 4. Index foreign keys so deleting a referenced row (account purge, removing a course or
--    file) and joins stay fast as data grows. Nullable columns get partial indexes.
CREATE INDEX attachments_blob_idx         ON app.attachments (blob_id) WHERE blob_id IS NOT NULL;
CREATE INDEX credit_grants_plan_idx       ON app.credit_grants (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX material_chunks_course_fk    ON app.material_chunks (course_id);
CREATE INDEX material_chunks_material_fk  ON app.material_chunks (material_id);
CREATE INDEX materials_blob_idx           ON app.materials (blob_id) WHERE blob_id IS NOT NULL;
CREATE INDEX materials_course_fk          ON app.materials (course_id);
CREATE INDEX outbound_messages_task_idx   ON app.outbound_messages (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX payments_plan_idx            ON app.payments (plan_id);
CREATE INDEX solutions_docx_blob_idx      ON app.solutions (docx_blob_id) WHERE docx_blob_id IS NOT NULL;
CREATE INDEX solutions_pdf_blob_idx       ON app.solutions (pdf_blob_id) WHERE pdf_blob_id IS NOT NULL;
CREATE INDEX task_files_blob_idx          ON app.task_files (blob_id);
CREATE INDEX task_files_task_fk           ON app.task_files (task_id);
CREATE INDEX tasks_course_idx             ON app.tasks (course_id) WHERE course_id IS NOT NULL;
CREATE INDEX tasks_credit_grant_idx       ON app.tasks (credit_grant_id) WHERE credit_grant_id IS NOT NULL;
CREATE INDEX wa_groups_course_idx         ON app.wa_groups (course_id) WHERE course_id IS NOT NULL;
