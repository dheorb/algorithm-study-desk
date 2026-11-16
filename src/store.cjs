const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROBLEM_ID = 'data-analysis';
const MAX_CODE = 1024 * 1024;
const MAX_NOTES = 256 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TITLE = 120;
const MAX_PROBLEMS = 1000;

class RecordError extends Error {}

function validateDraft(draft) {
  if (!draft || typeof draft.code !== 'string' || typeof draft.notes !== 'string' ||
      draft.code.length > MAX_CODE || draft.notes.length > MAX_NOTES) {
    throw new RecordError('코드 또는 메모 형식이 잘못되었거나 크기 제한을 넘었습니다.');
  }
}

function normalizeTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TITLE || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new RecordError('문제 제목은 공백만 있는 값이나 줄바꿈 없이 1~120자로 입력해 주세요.');
  }
  return title.trim();
}

function validId(id) {
  return id === PROBLEM_ID || (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
}

function validateLibrary(library) {
  if (!library || library.schemaVersion !== 2 || !Array.isArray(library.problems) ||
      library.problems.length < 1 || library.problems.length > MAX_PROBLEMS) throw new Error('Invalid library');
  const ids = new Set();
  const titles = new Set();
  for (const problem of library.problems) {
    validateDraft(problem);
    if (!validId(problem.id) || ids.has(problem.id) || normalizeTitle(problem.title) !== problem.title || titles.has(problem.title) ||
        !(problem.savedAt === null || (typeof problem.savedAt === 'string' && Number.isFinite(Date.parse(problem.savedAt))))) {
      throw new Error('Invalid problem');
    }
    ids.add(problem.id);
    titles.add(problem.title);
  }
}

function parseRecord(raw) {
  try {
    // Reject invalid UTF-8 rather than silently replacing bytes in an old record.
    const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (record.schemaVersion === 1) {
      validateDraft(record);
      if (record.problemId !== PROBLEM_ID || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) {
        throw new Error('Invalid legacy record');
      }
      return {
        library: { schemaVersion: 2, problems: [{ id: PROBLEM_ID, title: '데이터분석', code: record.code, notes: record.notes, savedAt: record.savedAt }] },
        legacy: true
      };
    }
    validateLibrary(record);
    return { library: record, legacy: false };
  } catch {
    throw new RecordError('저장 파일이 손상되었거나 지원하지 않는 형식입니다. 원본을 보존하기 위해 저장을 중단했습니다.');
  }
}

function errorMessage(error) {
  if (error instanceof RecordError) return error.message;
  const reasons = {
    EACCES: '저장 폴더에 접근할 권한이 없습니다.',
    EPERM: '저장 폴더에 접근할 권한이 없습니다.',
    ENOSPC: '디스크의 남은 공간이 부족합니다.',
    EROFS: '읽기 전용 디스크에는 저장할 수 없습니다.',
    ENOENT: '저장 폴더 또는 파일을 찾을 수 없습니다.',
    ENOTDIR: '저장 경로에 폴더가 아닌 파일이 있습니다.'
  };
  return reasons[error.code] || '파일을 읽거나 기록하는 중 오류가 발생했습니다.';
}

class StudyStore {
  constructor(directory, sampleCode) {
    this.directory = directory;
    this.filePath = path.join(directory, 'study-record.json');
    this.backupPath = `${this.filePath}.bak`;
    this.legacyBackupPath = path.join(directory, 'study-record.v1.json');
    this.sampleCode = sampleCode;
    this.library = null;
    this.legacy = false;
    this.loaded = false;
    this.baseline = null;
    this.saving = false;
  }

  async readRaw(filename = this.filePath) {
    let stat;
    try {
      stat = await fs.lstat(filename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.size > MAX_FILE) {
      throw new RecordError('저장 파일이 일반 파일이 아니거나 너무 큽니다. 파일을 보존하기 위해 저장을 중단했습니다.');
    }
    return fs.readFile(filename);
  }

  result() {
    return { library: structuredClone(this.library), filePath: this.filePath, legacyBackupPath: this.legacyBackupPath };
  }

  async load() {
    if (this.saving) return { ok: false, message: '저장이 진행 중입니다.' };
    if (this.loaded) return { ok: true, ...this.result() };
    try {
      const raw = await this.readRaw();
      const parsed = raw === null ? {
        library: { schemaVersion: 2, problems: [{ id: PROBLEM_ID, title: '데이터분석', code: this.sampleCode, notes: '', savedAt: null }] },
        legacy: false
      } : parseRecord(raw);
      this.library = parsed.library;
      this.legacy = parsed.legacy;
      this.baseline = raw;
      this.loaded = true;
      return { ok: true, ...this.result() };
    } catch (error) {
      return { ok: false, message: errorMessage(error), filePath: this.filePath };
    }
  }

  async assertUnchanged() {
    const current = await this.readRaw();
    if (!(current === null && this.baseline === null) && !(current && this.baseline && current.equals(this.baseline))) {
      throw new RecordError('앱을 연 뒤 저장 파일이 변경되거나 삭제되었습니다. 덮어쓰지 않았습니다. 현재 편집 내용을 복사해 두고 앱을 다시 열어 주세요.');
    }
  }

  async syncDirectory() {
    const directory = await fs.open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }

  async preserveLegacy() {
    const temporary = await this.writeTemporary(this.legacyBackupPath, this.baseline);
    try {
      try {
        // Publish an already flushed file exclusively; never replace a recovery copy.
        await fs.link(temporary, this.legacyBackupPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await this.readRaw(this.legacyBackupPath);
        if (!existing || !existing.equals(this.baseline)) {
          throw new RecordError('다른 내용의 v1 복구 사본이 이미 있습니다. 원본과 study-record.v1.json을 따로 보존하고 확인해 주세요.');
        }
      }
      await this.syncDirectory();
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async writeTemporary(target, content) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      return temporary;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  save(draft) {
    return this.commit((library) => {
      validateDraft(draft);
      const problem = library.problems.find((item) => item.id === draft.id);
      if (!problem) throw new RecordError('저장할 문제를 찾을 수 없습니다.');
      problem.code = draft.code;
      problem.notes = draft.notes;
      problem.savedAt = new Date().toISOString();
      return problem.id;
    });
  }

  create(title) {
    return this.commit((library) => {
      const normalized = normalizeTitle(title);
      if (library.problems.some((problem) => problem.title === normalized)) {
        throw new RecordError('같은 제목의 문제가 있습니다. 다른 제목을 입력해 주세요.');
      }
      if (library.problems.length >= MAX_PROBLEMS) throw new RecordError('문제는 최대 1,000개까지 보관할 수 있습니다.');
      const id = randomUUID();
      library.problems.push({ id, title: normalized, code: '', notes: '', savedAt: null });
      return id;
    });
  }

  async commit(change) {
    if (!this.loaded) return { ok: false, message: '기존 기록을 안전하게 읽지 못해 저장할 수 없습니다. 저장 파일을 백업하고 확인한 뒤 앱을 다시 열어 주세요.' };
    if (this.saving) return { ok: false, message: '저장이 진행 중입니다. 잠시 후 다시 시도해 주세요.' };
    this.saving = true;
    let temporary;
    let backupTemporary;
    let committed = false;
    try {
      // Copy and capture the exact target and values before the first await.
      const candidate = structuredClone(this.library);
      const problemId = change(candidate);
      const raw = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
      if (raw.length > MAX_FILE) throw new RecordError('전체 기록이 8 MiB를 넘습니다. 코드나 메모의 크기를 줄여 주세요.');
      await this.assertUnchanged();
      temporary = await this.writeTemporary(this.filePath, raw);
      if (this.legacy) await this.preserveLegacy();
      if (this.baseline !== null) backupTemporary = await this.writeTemporary(this.backupPath, this.baseline);
      await this.assertUnchanged();
      if (backupTemporary) {
        await fs.rename(backupTemporary, this.backupPath);
        backupTemporary = undefined;
      }
      await fs.rename(temporary, this.filePath);
      temporary = undefined;
      this.baseline = raw;
      this.library = candidate;
      this.legacy = false;
      committed = true;
      await this.syncDirectory();
      return { ok: true, problemId, ...this.result() };
    } catch (error) {
      // A failed fsync after rename is uncertain durability, not a rolled-back write.
      // Return the new library so a created item stays visible and cannot be duplicated.
      return { ok: false, message: errorMessage(error), ...(committed ? this.result() : {}) };
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      if (backupTemporary) await fs.unlink(backupTemporary).catch(() => {});
      this.saving = false;
    }
  }
}

module.exports = { StudyStore, MAX_CODE, MAX_NOTES, MAX_TITLE, MAX_FILE };
