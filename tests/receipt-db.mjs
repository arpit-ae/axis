import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0001_phase1_enquiries", "0002_payment_notifications", "0004_receipts"]) {
    db.exec(readFileSync(new URL("../migrations/" + file + ".sql", import.meta.url), "utf8"));
  }
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        first() { return stmt.get(...args) || null; },
        all() { return { results: stmt.all(...args) }; },
        run() { return { meta: stmt.run(...args) }; }
      };
    },
    batch(statements) {
      db.exec("BEGIN");
      try { const result = statements.map(s => s.run()); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  };
}
