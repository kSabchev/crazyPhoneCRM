// Shared types for the type checker (`npm run typecheck`). Declarations
// only — nothing here runs. Used from the .js files through JSDoc, e.g.
//   /** @param {import('../types/app').Ticket} t */

/** The built-in statuses (public/statuses.js). Shops can add their own. */
export type SystemStatus = 'за сервиз' | 'в сервиз' | 'чака клиент' | 'издаден' | 'отказан' | 'забравен';
export type Status = SystemStatus | (string & {});

/** An order's writable fields, with the database's names (lib/tickets-repo.js COLUMNS). */
export interface TicketFields {
  customer_name: string;
  phone_contact: string;
  date_received: string;          // YYYY-MM-DD
  date_returned: string | null;   // YYYY-MM-DD
  phone_model: string;
  status: Status;
  description: string;
  comment: string | null;
  repair_performed: string | null;
  loaner_phone: 'да' | 'не' | null;
  phone_password: string | null;
  pravim: 'circle' | 'tick' | 'cross';
  /** An amount, "Не" (no deposit) or free text from older orders. SQLite stores numbers as numbers. */
  kaparo: string | number | null;
  service_price: number | null;
  customer_price: number | null;
}

/** An order as stored (a row of the tickets table). */
export interface Ticket extends TicketFields {
  id: number;
  ticket_no: number;
  created_at: string;   // SQLite UTC "YYYY-MM-DD HH:MM:SS"
  updated_at: string;
}

/** A login account (the users table). */
export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'staff';
  created_at: string;
}

/** A change-history entry (the audit_log table); `changes` is JSON text. */
export interface AuditRow {
  id: number;
  ticket_id: number | null;
  ticket_no: number;
  action: 'created' | 'updated' | 'deleted' | 'sms';
  changes: string;
  performed_by: string;
  performed_at: string;
}

// ---- SMS (sms.js and its providers) ----

/** A sent SMS (the sms_messages table). */
export interface SmsMessage {
  id: number;
  ticket_id: number;
  ticket_no: number;
  phone: string;
  text: string;
  state: SmsState;
  gateway_id: string | null;
  error: string | null;
  sent_by: string;
  created_at: string;
  updated_at: string;
}

export type SmsState = 'Sending' | 'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed';

/** State of the SMS service / phone, for the header pill. */
export interface ServiceStatus {
  state: 'off' | 'cloud' | 'ready' | 'warning' | 'offline' | 'auth';
  details: Record<string, unknown> & { problems?: string[] };
}

/** One way of sending SMS (sms-demo.js, smsapi.js, gateway.js). */
export interface SmsProvider {
  /** Settings from .env, or a falsy value when this provider isn't set up. */
  config(): unknown;
  send(phone: string, text: string): Promise<{ gatewayId: string | null; state: SmsState }>;
  state(gatewayId: string): Promise<{ state: SmsState | null; error: string | null } | null>;
  serviceStatus(): Promise<ServiceStatus>;
}

// ---- Order events (lib/ticket-events.js) ----

export interface TicketEventMap {
  created: [{ after: Ticket; user: string }];
  updated: [{ before: Ticket; after: Ticket; user: string; at?: string }];
  deleted: [{ before: Ticket; user: string }];
  sms: [{ ticket: Ticket; phone: string; ok: boolean; user: string }];
  smsStates: [{ count: number }];
}

// ---- Backups (lib/backup-log.js) ----

export interface BackupRun {
  startedAt: string;          // ISO
  finishedAt: string | null;  // ISO
  ok: boolean;
  file: string | null;
  sizeBytes: number | null;
  nas: 'ok' | 'failed' | 'off';
  error: string | null;
}

// ---- What the app keeps in the login session and on the request ----

declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
  }
}

declare global {
  /** The browser's global object; only checked in shared files that also run there (public/statuses.js). */
  var self: typeof globalThis | undefined;
  namespace Express {
    interface Request {
      /** The logged-in user, set by requireAuth / requireAdmin (lib/auth.js). */
      user?: { id: number; username: string; role: 'admin' | 'staff' };
    }
  }
}
