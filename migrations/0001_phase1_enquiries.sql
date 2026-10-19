CREATE TABLE IF NOT EXISTS Leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  service TEXT NOT NULL,
  business_name TEXT,
  business_type TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON Leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON Leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON Leads(email);
