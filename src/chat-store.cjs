const fs = require('node:fs/promises');
const path = require('node:path');
const { StudyStore } = require('./store.cjs');
const { errors } = require('./codex-provider.cjs');
const MAX_CHAT_FILE = 8 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function validate(entry) {
  if (!entry || !uuid(entry.id) || !(entry.problemId === 'data-analysis' || uuid(entry.problemId)) ||
      typeof entry.question !== 'string' || !entry.question.trim() || entry.question.length > 4000 ||
      typeof entry.answer !== 'string' || Buffer.byteLength(entry.answer) > 48 * 1024 ||
      !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(entry.status) ||
      (entry.error !== null && !Object.hasOwn(errors, entry.error)) ||
      typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
      !Number.isInteger(entry.historyCount) || entry.historyCount < 0 || entry.historyCount > 6 ||
      !Number.isInteger(entry.omittedHistory) || entry.omittedHistory < 0 ||
      (entry.status === 'completed' && !entry.answer.trim())) throw new Error('invalid');
}

// Separate file: chat writes never overwrite a stale snapshot of code, notes or ideas.
// Reuse only the existing well-tested filesystem primitives, not study-record serialization.
class ChatStore extends StudyStore {
  constructor(directory) {
    super(directory, '');
    this.filePath = path.join(directory, 'ai-chat.json');
    this.backupPath = `${this.filePath}.bak`;
    this.entries = [];
  }
  async load() {
    if (this.loaded) return;
    const raw = await this.readRaw();
    if (raw !== null) {
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > 1000) throw new Error('invalid');
      const ids = new Set();
      for (const entry of parsed.entries) { validate(entry); if (ids.has(entry.id)) throw new Error('duplicate'); ids.add(entry.id); }
      // A new process cannot continue an old child. Keep the question, never restore an endless spinner.
      this.entries = parsed.entries.map(entry => entry.status === 'running' ? { ...entry, status: 'interrupted' } : entry);
    }
    this.baseline = raw;
    this.loaded = true;
  }
  async put(entry) {
    if (!this.loaded || this.saving) throw new Error('unavailable');
    validate(entry);
    this.saving = true;
    let temporary, backup;
    try {
      const entries = structuredClone(this.entries);
      const index = entries.findIndex(item => item.id === entry.id);
      if (index >= 0 && (entries[index].problemId !== entry.problemId || entries[index].question !== entry.question)) throw new Error('identity');
      if (index >= 0) entries[index] = structuredClone(entry); else entries.push(structuredClone(entry));
      if (entries.length > 1000 || entries.filter(item => item.problemId === entry.problemId).length > 200) throw new Error('limit');
      const raw = Buffer.from(JSON.stringify({ schemaVersion: 1, entries }, null, 2) + '\n');
      if (raw.length > MAX_CHAT_FILE) throw new Error('limit');
      await this.assertUnchanged();
      temporary = await this.writeTemporary(this.filePath, raw);
      if (this.baseline !== null) backup = await this.writeTemporary(this.backupPath, this.baseline);
      await this.assertUnchanged();
      if (backup) { await fs.rename(backup, this.backupPath); backup = null; }
      await fs.rename(temporary, this.filePath); temporary = null;
      this.baseline = raw; this.entries = entries;
      await this.syncDirectory();
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      if (backup) await fs.unlink(backup).catch(() => {});
      this.saving = false;
    }
  }
}
module.exports = { ChatStore, uuid };
