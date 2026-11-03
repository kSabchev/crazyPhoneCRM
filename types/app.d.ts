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
  role: Role;
  /** The shop of a shop account (staff, shop manager); null for admins. */
  store_id: number | null;
  created_at: string;
}

/** admin: every shop; shop_manager: one shop, with Справки and deleting orders; staff: one shop. */
export type Role = 'admin' | 'shop_manager' | 'staff';

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
/** Where a provider reads its settings: .env, or a shop's own (sms.js smsEnv). */
export type SmsEnv = Record<string, string | undefined>;

export interface SmsProvider {
  /** Its settings, or a falsy value when this provider isn't set up. */
  config(env?: SmsEnv): unknown;
  send(phone: string, text: string, env?: SmsEnv): Promise<{ gatewayId: string | null; state: SmsState }>;
  state(gatewayId: string, env?: SmsEnv): Promise<{ state: SmsState | null; error: string | null } | null>;
  serviceStatus(env?: SmsEnv): Promise<ServiceStatus>;
}

// ---- Shops (lib/stores.js) ----

/** A shop: its details from system.db, with its own database and order queries. */
export interface Store {
  id: number;
  name: string;
  /** Shown before the shop's order numbers (e.g. "Л"); '' for none. */
  prefix: string;
  /** The shop's SMS settings: { mode: 'env' | 'own' | 'off', ...its own keys } (sms.js). */
  sms: Record<string, any>;
  db: import('better-sqlite3').Database;
  tickets: ReturnType<typeof import('../lib/tickets-repo').ticketsRepo>;
}

// ---- Order events (lib/ticket-events.js) ----

/** Where the change happened: at least the shop's database. */
export type EventStore = Pick<Store, 'db'> & Partial<Store>;

export interface TicketEventMap {
  created: [{ store: EventStore; after: Ticket; user: string }];
  updated: [{ store: EventStore; before: Ticket; after: Ticket; user: string; at?: string }];
  deleted: [{ store: EventStore; before: Ticket; user: string }];
  sms: [{ store: EventStore; ticket: Ticket; phone: string; ok: boolean; user: string }];
  smsStates: [{ store: EventStore; count: number }];
}

// ---- Backups (lib/backup-log.js) ----

export interface BackupRun {
  startedAt: string;          // ISO
  finishedAt: string | null;  // ISO
  ok: boolean;
  file: string | null;
  /** The backup of system.db (accounts, shops) made in the same run. */
  systemFile?: string | null;
  /** The other shops' backups (shop-<id>_<time>.db) made in the same run. */
  shopFiles?: string[];
  sizeBytes: number | null;
  nas: 'ok' | 'failed' | 'off';
  error: string | null;
}

// ---- What the app keeps in the login session and on the request ----

declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
    /** Admins: the shop they've picked (lib/auth.js). */
    storeId: number;
    /** Admins: working on all shops at once (lib/auth.js). */
    allShops: boolean;
  }
}

declare global {
  /** The browser's global object; only checked in shared files that also run there (public/statuses.js). */
  var self: typeof globalThis | undefined;
  namespace Express {
    interface Request {
      /** The logged-in user, set by requireAuth / requireAdmin (lib/auth.js). */
      user?: { id: number; username: string; role: Role; store_id: number | null };
      /** The shop this request works on, set with req.user (lib/auth.js). */
      store?: Store;
      /** Admins' all-shops view (lib/auth.js, lib/ticket-target.js). */
      allShops?: boolean;
    }
  }
}
