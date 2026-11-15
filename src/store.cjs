const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROBLEM_ID = 'data-analysis';
const MAX_CODE = 1024 * 1024;
const MAX_NOTES = 256 * 1024;
const MAX_FILE = 8 * 1024 * 1024;

class RecordError extends Error {}

function validateDraft(draft) {
  if (!draft || typeof draft.code !== 'string' || typeof draft.notes !== 'string' ||
      draft.code.length > MAX_CODE || draft.notes.length > MAX_NOTES) {
    throw new RecordError('코드 또는 메모 형식이 잘못되었거나 크기 제한을 넘었습니다.');
  }
}

function parseRecord(raw) {
  try {
    const record = JSON.parse(raw);
    validateDraft(record);
    if (record.schemaVersion !== 1 || record.problemId !== PROBLEM_ID ||
        typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) {
      throw new Error('Unsupported record');
    }
    return record;
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
    this.sampleCode = sampleCode;
    this.loaded = false;
    this.baseline = null;
    this.saving = false;
  }

  async readRaw() {
    let stat;
    try {
      stat = await fs.lstat(this.filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.size > MAX_FILE) {
      throw new RecordError('저장 파일이 일반 파일이 아니거나 너무 큽니다. 파일을 보존하기 위해 저장을 중단했습니다.');
    }
    return fs.readFile(this.filePath, 'utf8');
  }

  async load() {
    try {
      const raw = await this.readRaw();
      const record = raw === null ? {
        code: this.sampleCode, notes: '', savedAt: null
      } : parseRecord(raw);
      this.baseline = raw;
      this.loaded = true;
      return { ok: true, record, filePath: this.filePath };
    } catch (error) {
      this.loaded = false;
      return { ok: false, message: errorMessage(error), filePath: this.filePath };
    }
  }

  async assertUnchanged() {
    const current = await this.readRaw();
    if (current !== this.baseline) {
      throw new RecordError('앱을 연 뒤 저장 파일이 변경되거나 삭제되었습니다. 덮어쓰지 않았습니다. 현재 편집 내용을 복사해 두고 앱을 다시 열어 주세요.');
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

  async save(draft) {
    if (!this.loaded) return { ok: false, message: '기존 기록을 안전하게 읽지 못해 저장할 수 없습니다. 저장 파일을 백업하고 확인한 뒤 앱을 다시 열어 주세요.' };
    if (this.saving) return { ok: false, message: '저장이 진행 중입니다. 잠시 후 다시 시도해 주세요.' };
    this.saving = true;
    let temporary;
    let backupTemporary;
    try {
      validateDraft(draft);
      await this.assertUnchanged();
      const record = {
        schemaVersion: 1, problemId: PROBLEM_ID,
        code: draft.code, notes: draft.notes, savedAt: new Date().toISOString()
      };
      const raw = `${JSON.stringify(record, null, 2)}\n`;
      temporary = await this.writeTemporary(this.filePath, raw);
      if (this.baseline !== null) {
        backupTemporary = await this.writeTemporary(this.backupPath, this.baseline);
      }
      await this.assertUnchanged();
      if (backupTemporary) {
        await fs.rename(backupTemporary, this.backupPath);
        backupTemporary = undefined;
      }
      await fs.rename(temporary, this.filePath);
      temporary = undefined;
      this.baseline = raw;
      // Linux: persist the rename as well as the file contents before reporting success.
      const directory = await fs.open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return { ok: true, savedAt: record.savedAt };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      if (backupTemporary) await fs.unlink(backupTemporary).catch(() => {});
      this.saving = false;
    }
  }
}

module.exports = { StudyStore, MAX_CODE, MAX_NOTES };
