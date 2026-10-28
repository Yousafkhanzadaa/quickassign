// Kysely typings for schema "app" (see db/migrations). Columns ending in _enc are
// AES-256-GCM ciphertext produced by seal.ts.
import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Int8 = ColumnType<string, never, never>;

export type WaStatus = "unlinked" | "pairing" | "linked" | "logged_out" | "temp_banned" | "error";
export type SenderRole = "unknown" | "instructor" | "ta" | "class_rep" | "student";
export type MsgKind = "text" | "image" | "document" | "video" | "audio" | "other";
export type TaskKind = "assignment" | "project" | "lab" | "quiz" | "exam" | "announcement" | "other";
export type TaskStatus =
  | "awaiting_confirmation"
  | "queued"
  | "solving"
  | "delivered"
  | "skipped"
  | "failed"
  | "reminder_only"
  | "needs_content";
export type MaterialStatus = "uploaded" | "processing" | "ready" | "failed";
export type BlobPurpose = "material" | "attachment" | "solution_pdf" | "solution_docx";
export type PaymentStatus = "created" | "pending" | "paid" | "failed" | "expired" | "refunded";

export interface ProfilesTable {
  user_id: string;
  full_name: string;
  roll_number: string | null;
  university: string | null;
  department: string | null;
  program: string | null;
  semester: string | null;
  timezone: Generated<string>;
  auto_solve: Generated<boolean>;
  age_confirmed_at: Timestamp;
  terms_version: string;
  terms_accepted_at: Timestamp;
  wa_risk_ack_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantKeysTable {
  user_id: string;
  kek_id: string;
  wrapped_dek: Buffer;
  created_at: Timestamp;
}

export interface UserCountersTable {
  user_id: string;
  task_seq: Generated<number>;
}

export interface WaLinksTable {
  user_id: string;
  status: WaStatus;
  device_label: string | null;
  phone_hint: string | null;
  linked_at: NullableTimestamp;
  last_connected_at: NullableTimestamp;
  last_error: string | null;
  updated_at: Timestamp;
}

export interface CoursesTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  code: string | null;
  instructor: string | null;
  notes: string | null;
  auto_solve: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WaGroupsTable {
  id: Generated<string>;
  user_id: string;
  group_jid: string;
  name: string | null;
  is_announcement: Generated<boolean>;
  is_community_parent: Generated<boolean>;
  parent_jid: string | null;
  participant_count: number | null;
  monitored: Generated<boolean>;
  course_id: string | null;
  left_at: NullableTimestamp;
  last_seen_at: NullableTimestamp;
  updated_at: Timestamp;
}

export interface GroupSendersTable {
  user_id: string;
  group_jid: string;
  sender_hash: string;
  display_name_enc: Buffer | null;
  is_admin: Generated<boolean>;
  role: Generated<SenderRole>;
  message_count: Generated<number>;
  last_seen_at: Timestamp;
}

export interface InboundMessagesTable {
  id: string;
  user_id: string;
  group_jid: string;
  wa_message_id: string;
  sender_hash: string;
  sender_is_admin: Generated<boolean>;
  sent_at: Timestamp;
  kind: MsgKind;
  body_enc: Buffer | null;
  quoted_wa_message_id: string | null;
  media_desc_enc: Buffer | null;
  media_mime: string | null;
  media_size: ColumnType<string | null, never, never>;
  media_filename_enc: Buffer | null;
  is_backfill: Generated<boolean>;
  edited_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  prefilter_score: number | null;
  processed_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface SelfCommandsTable {
  id: string;
  user_id: string;
  wa_message_id: string;
  text_enc: Buffer;
  quoted_wa_message_id: string | null;
  processed_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface TasksTable {
  id: Generated<string>;
  user_id: string;
  short_no: number;
  group_jid: string | null;
  course_id: string | null;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  summary_enc: Buffer | null;
  deliverables_enc: Buffer | null;
  deadline_at: NullableTimestamp;
  deadline_confidence: number | null;
  content_location: string | null;
  confidence: number | null;
  source_message_ids: Generated<string[]>;
  last_error: string | null;
  credit_grant_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface BlobsTable {
  id: string;
  user_id: string;
  purpose: BlobPurpose;
  mime: string;
  size: number;
  data_enc: Buffer;
  created_at: Timestamp;
  expires_at: NullableTimestamp;
}

export interface AttachmentsTable {
  message_id: string;
  user_id: string;
  blob_id: string;
  created_at: Timestamp;
}

export interface TaskFilesTable {
  id: string;
  user_id: string;
  task_id: string;
  blob_id: string;
  filename_enc: Buffer;
  mime: string;
  created_at: Timestamp;
}

export interface SolutionsTable {
  id: Generated<string>;
  user_id: string;
  task_id: string;
  version: number;
  model: string;
  markdown_enc: Buffer;
  pdf_blob_id: string | null;
  docx_blob_id: string | null;
  warnings: Generated<string[]>;
  created_at: Timestamp;
}

export interface MaterialsTable {
  id: Generated<string>;
  user_id: string;
  course_id: string;
  filename_enc: Buffer;
  mime: string;
  size: number;
  blob_id: string;
  status: Generated<MaterialStatus>;
  page_count: number | null;
  error: string | null;
  created_at: Timestamp;
}

export interface MaterialChunksTable {
  id: Generated<string>;
  user_id: string;
  course_id: string;
  material_id: string;
  chunk_index: number;
  page_from: number | null;
  page_to: number | null;
  content_enc: Buffer;
  embedding: string; // pgvector literal, e.g. "[0.1,0.2,...]"
}

export interface OutboundMessagesTable {
  user_id: string;
  wa_message_id: string;
  kind: string;
  task_id: string | null;
  created_at: Timestamp;
}

export interface CreditLedgerTable {
  id: Int8;
  user_id: string;
  delta: number;
  reason: string;
  ref: string | null;
  created_at: Timestamp;
}

export interface UsageEventsTable {
  id: Int8;
  user_id: string;
  kind: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: ColumnType<string, number | string, number | string>;
  created_at: Timestamp;
}

export interface AuditLogTable {
  id: Int8;
  user_id: string | null;
  actor: "user" | "system" | "gateway" | "worker" | "admin";
  action: string;
  details: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: Timestamp;
}

export interface PlansTable {
  id: string;
  name: string;
  price_paisa: number;
  currency: string;
  solves: number;
  period_days: number;
  active: boolean;
  sort_order: number;
}

export interface PaymentsTable {
  id: Generated<string>;
  user_id: string;
  plan_id: string;
  amount_paisa: number;
  currency: string;
  provider: "safepay" | "mock";
  provider_ref: string | null;
  status: PaymentStatus;
  failure_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  paid_at: NullableTimestamp;
  expires_at: Timestamp;
}

export interface CreditGrantsTable {
  id: Generated<string>;
  user_id: string;
  source: "signup" | "plan" | "admin";
  plan_id: string | null;
  payment_id: string | null;
  quantity: number;
  used: Generated<number>;
  expires_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface DB {
  "app.profiles": ProfilesTable;
  "app.tenant_keys": TenantKeysTable;
  "app.user_counters": UserCountersTable;
  "app.wa_links": WaLinksTable;
  "app.courses": CoursesTable;
  "app.wa_groups": WaGroupsTable;
  "app.group_senders": GroupSendersTable;
  "app.inbound_messages": InboundMessagesTable;
  "app.self_commands": SelfCommandsTable;
  "app.tasks": TasksTable;
  "app.blobs": BlobsTable;
  "app.attachments": AttachmentsTable;
  "app.task_files": TaskFilesTable;
  "app.solutions": SolutionsTable;
  "app.materials": MaterialsTable;
  "app.material_chunks": MaterialChunksTable;
  "app.outbound_messages": OutboundMessagesTable;
  "app.credit_ledger": CreditLedgerTable;
  "app.usage_events": UsageEventsTable;
  "app.audit_log": AuditLogTable;
  "app.plans": PlansTable;
  "app.payments": PaymentsTable;
  "app.credit_grants": CreditGrantsTable;
}
