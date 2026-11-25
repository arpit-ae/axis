ALTER TABLE Leads ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX idx_leads_request ON Leads(request_id);

CREATE TABLE CheckoutOrders (
  order_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  checkout TEXT NOT NULL,
  receipt_token TEXT NOT NULL,
  payment_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ReceiptMail (
  mail_key TEXT PRIMARY KEY,
  reference TEXT NOT NULL,
  recipient_role TEXT NOT NULL CHECK(recipient_role IN ('owner','customer','both')),
  message TEXT,
  sent_at TEXT,
  first_attempt INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_receipt_reference ON ReceiptMail(reference);
CREATE INDEX idx_receipt_due ON ReceiptMail(next_attempt) WHERE sent_at IS NULL AND blocked=0;
