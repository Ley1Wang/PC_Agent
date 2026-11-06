import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "pc-agent.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,status TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,id);`);
  const get = (id) => {
    const row = db.prepare("SELECT id,title,model,created_at AS createdAt,updated_at AS updatedAt FROM conversations WHERE id=?").get(id);
    if (!row) return null;
    row.messages = db.prepare("SELECT role,content,status,metadata,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY id").all(id)
      .map(({ metadata, ...message }) => ({ ...message, metadata: JSON.parse(metadata) }));
    return row;
  };
  return {
    setting(key, fallback) { const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key); return row ? JSON.parse(row.value) : fallback; },
    setSetting(key, value) { db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    list(query = "") {
      const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      return db.prepare(`SELECT id,title,model,updated_at AS updatedAt FROM conversations
        WHERE title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM messages WHERE conversation_id=conversations.id AND content LIKE ? ESCAPE '\\')
        ORDER BY updated_at DESC,rowid DESC LIMIT 100`).all(search, search);
    },
    get,
    create(model, text) {
      const now = new Date().toISOString(); const id = randomUUID();
      const title = text.trim().replace(/\s+/g, " ").slice(0, 40);
      db.prepare("INSERT INTO conversations VALUES(?,?,?,?,?)").run(id, title, model, now, now);
      return get(id);
    },
    add(id, role, content, status = "complete", metadata = {}) {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO messages(conversation_id,role,content,status,metadata,created_at) VALUES(?,?,?,?,?,?)")
        .run(id, role, content, status, JSON.stringify(metadata), now);
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now, id);
    },
    remove(id) { return db.prepare("DELETE FROM conversations WHERE id=?").run(id).changes > 0; },
    close() { db.close(); },
  };
}
