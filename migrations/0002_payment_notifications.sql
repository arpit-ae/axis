-- Run after 0001_phase1_enquiries.sql. Idempotent payment-email dedupe table.
CREATE TABLE IF NOT EXISTS PaymentNotifications (
  order_id TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  purpose TEXT,
  amount REAL NOT NULL,
  customer_sent_at TEXT,
  admin_sent_at TEXT,
  processing_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
