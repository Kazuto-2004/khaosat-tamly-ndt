/**
 * Backend Google Apps Script – App khảo sát Tâm lý NĐT & Rủi ro sụp đổ giá CP
 * Lưu phiếu vào Google Sheets, dùng chung cho nhiều người nhập.
 *
 * Cách dùng:
 * 1. Đổi ADMIN_KEY bên dưới thành mật khẩu riêng.
 * 2. Lưu (Ctrl+S) → chọn hàm "setup" → Chạy → cấp quyền.
 * 3. Triển khai → Tùy chọn triển khai mới → Ứng dụng web
 *    (Thực thi với tư cách: Tôi · Người có quyền truy cập: Bất kỳ ai).
 */

const ADMIN_KEY = 'DOI_MAT_KHAU_NAY';   // ← ĐỔI THÀNH MẬT KHẨU RIÊNG
const TZ = 'Asia/Ho_Chi_Minh';

const SHEET_RESPONSES = 'responses';
const SHEET_AUDIT = 'audit_log';
const SHEET_META = 'meta';

// Cột hệ thống (cố định, luôn đứng đầu). Cột câu trả lời được thêm tự động phía sau.
const SYS_COLS = [
  'seq', 'form_code', 'display_name', 'source', 'entered_by', 'paper_date',
  'server_time', 'updated_at', 'updated_by', 'edited', 'deleted', 'delete_reason',
  'client_uuid', 'start_time', 'end_time', 'duration_sec', 'valid', 'flags',
  'survey_version', 'answers_json'
];
const AUDIT_COLS = ['time', 'form_code', 'action', 'variable', 'old_value', 'new_value', 'reason', 'by'];

// Các biến hiện trong bảng danh sách (Khối 2)
const LIST_ANSWER_FIELDS = ['A1', 'A2', 'A11'];

/* ========================= THIẾT LẬP ========================= */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_RESPONSES, SYS_COLS);
  ensureSheet_(ss, SHEET_AUDIT, AUDIT_COLS);
  const meta = ensureSheet_(ss, SHEET_META, ['key', 'value']);
  if (meta.getLastRow() < 2) meta.appendRow(['last_seq', 0]);
  const def = ss.getSheetByName('Trang tính1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 3 && def.getLastRow() === 0) ss.deleteSheet(def);
  Logger.log('Đã thiết lập xong 3 sheet: responses, audit_log, meta');
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

/* ========================= ĐỊNH TUYẾN ========================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  return handle_(p.action || 'ping', p);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON' });
  }
  return handle_(body.action, body);
}

function handle_(action, p) {
  try {
    if (action === 'ping') return json_({ ok: true, data: { time: now_() } });
    if (action === 'createPublic') return json_({ ok: true, data: create_(p, 'online') });

    if (String(p.key || '') !== ADMIN_KEY) return json_({ ok: false, error: 'UNAUTHORIZED' });

    switch (action) {
      case 'create':     return json_({ ok: true, data: create_(p, p.source || 'paper') });
      case 'list':       return json_({ ok: true, data: list_(p) });
      case 'get':        return json_({ ok: true, data: get_(p.form_code) });
      case 'update':     return json_({ ok: true, data: update_(p) });
      case 'softDelete': return json_({ ok: true, data: setDeleted_(p, 1) });
      case 'restore':    return json_({ ok: true, data: setDeleted_(p, 0) });
      case 'stats':      return json_({ ok: true, data: stats_() });
      case 'exportAll':  return json_({ ok: true, data: exportAll_() });
      case 'audit':      return json_({ ok: true, data: readAll_(SHEET_AUDIT).rows });
      default:           return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ========================= NGHIỆP VỤ ========================= */

/**
 * p = {
 *   answers: { A1: 2, A8: [1,3], TL1: 4, G5_other: "…", ... },
 *   entered_by, paper_date, client_uuid, start_time, end_time, duration_sec,
 *   valid (0/1), flags ("R1;speeder"), survey_version
 * }
 */
function create_(p, source) {
  if (!p.answers || typeof p.answers !== 'object') throw new Error('MISSING_ANSWERS');
  if (!p.client_uuid) throw new Error('MISSING_CLIENT_UUID');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(SHEET_RESPONSES);
    const data = readAll_(SHEET_RESPONSES);

    // Chống trùng: cùng client_uuid → trả lại phiếu đã có
    const dup = data.rows.find(r => r.client_uuid === p.client_uuid);
    if (dup) return { duplicate: true, form_code: dup.form_code, display_name: dup.display_name, seq: dup.seq };

    const seq = nextSeq_();
    const prefix = source === 'online' ? 'PKS-' : 'PKG-';
    const rec = {
      seq: seq,
      form_code: prefix + pad_(seq, 4),
      display_name: 'Phiếu số ' + pad_(seq, 3),
      source: source,
      entered_by: source === 'online' ? '' : String(p.entered_by || ''),
      paper_date: String(p.paper_date || ''),
      server_time: now_(),
      updated_at: '',
      updated_by: '',
      edited: 0,
      deleted: 0,
      delete_reason: '',
      client_uuid: String(p.client_uuid),
      start_time: String(p.start_time || ''),
      end_time: String(p.end_time || ''),
      duration_sec: p.duration_sec === undefined ? '' : Number(p.duration_sec),
      valid: p.valid === undefined ? '' : Number(p.valid),
      flags: String(p.flags || ''),
      survey_version: String(p.survey_version || ''),
      answers_json: JSON.stringify(p.answers)
    };

    const headers = ensureAnswerColumns_(sh, Object.keys(p.answers));
    sh.appendRow(headers.map(h => cellValue_(h in rec ? rec[h] : p.answers[h])));
    return { duplicate: false, form_code: rec.form_code, display_name: rec.display_name, seq: seq, server_time: rec.server_time };
  } finally {
    lock.releaseLock();
  }
}

function list_(p) {
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(p.pageSize) || 20));
  const q = String(p.q || '').trim().toLowerCase();
  const status = p.status || 'all';            // all | valid | flagged | deleted
  const sortDir = p.sortDir === 'asc' ? 1 : -1; // mặc định mới nhất ở đầu

  let rows = readAll_(SHEET_RESPONSES).rows;

  rows = rows.filter(r => {
    const del = Number(r.deleted) === 1;
    if (status === 'deleted') { if (!del) return false; }
    else if (del) return false;
    if (status === 'valid' && Number(r.valid) !== 1) return false;
    if (status === 'flagged' && !isFlagged_(r)) return false;
    if (p.source && r.source !== p.source) return false;
    if (p.enteredBy && r.entered_by !== p.enteredBy) return false;
    if (p.from && String(r.server_time).slice(0, 10) < p.from) return false;
    if (p.to && String(r.server_time).slice(0, 10) > p.to) return false;
    if (q && (String(r.display_name).toLowerCase() + ' ' + String(r.form_code).toLowerCase()).indexOf(q) === -1) return false;
    return true;
  });

  rows.sort((a, b) => (Number(a.seq) - Number(b.seq)) * sortDir);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map(summary_);

  return { items: items, total: total, page: page, pageSize: pageSize, pageCount: pageCount, lastUpdated: now_() };
}

function get_(formCode) {
  const r = findRow_(formCode);
  if (!r) throw new Error('NOT_FOUND');
  const out = {};
  SYS_COLS.forEach(c => { if (c !== 'answers_json') out[c] = r.obj[c]; });
  out.answers = parseAnswers_(r.obj.answers_json);
  return out;
}

/**
 * p = { form_code, answers, reason, by, expected_updated_at }
 * expected_updated_at: giá trị updated_at client đang giữ; khác server → báo CONFLICT.
 */
function update_(p) {
  if (!p.reason) throw new Error('MISSING_REASON');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const r = findRow_(p.form_code);
    if (!r) throw new Error('NOT_FOUND');
    if (p.expected_updated_at !== undefined && String(p.expected_updated_at) !== String(r.obj.updated_at || '')) {
      return { conflict: true, updated_at: r.obj.updated_at, updated_by: r.obj.updated_by };
    }

    const sh = sheet_(SHEET_RESPONSES);
    const oldAns = parseAnswers_(r.obj.answers_json);
    const newAns = p.answers || {};
    const keys = uniq_(Object.keys(oldAns).concat(Object.keys(newAns)));
    const t = now_();
    const by = String(p.by || '');

    const audit = [];
    keys.forEach(k => {
      const o = cellValue_(oldAns[k]);
      const n = cellValue_(newAns[k]);
      if (String(o) !== String(n)) audit.push([t, p.form_code, 'update', k, o, n, p.reason, by]);
    });
    if (!audit.length) return { changed: 0, updated_at: r.obj.updated_at };

    const headers = ensureAnswerColumns_(sh, Object.keys(newAns));
    const merged = Object.assign({}, r.obj, { updated_at: t, updated_by: by, edited: 1, answers_json: JSON.stringify(newAns) });
    if (p.valid !== undefined) merged.valid = Number(p.valid);
    if (p.flags !== undefined) merged.flags = String(p.flags);
    if (p.paper_date !== undefined) merged.paper_date = String(p.paper_date);

    const rowVals = headers.map(h => cellValue_(SYS_COLS.indexOf(h) >= 0 ? merged[h] : newAns[h]));
    sh.getRange(r.rowIndex, 1, 1, rowVals.length).setValues([rowVals]);

    const ash = sheet_(SHEET_AUDIT);
    ash.getRange(ash.getLastRow() + 1, 1, audit.length, AUDIT_COLS.length).setValues(audit);
    return { changed: audit.length, updated_at: t };
  } finally {
    lock.releaseLock();
  }
}

function setDeleted_(p, flag) {
  if (flag === 1 && !p.reason) throw new Error('MISSING_REASON');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const r = findRow_(p.form_code);
    if (!r) throw new Error('NOT_FOUND');
    const sh = sheet_(SHEET_RESPONSES);
    const headers = headers_(sh);
    const t = now_();
    setCell_(sh, r.rowIndex, headers, 'deleted', flag);
    setCell_(sh, r.rowIndex, headers, 'delete_reason', flag ? String(p.reason) : '');
    setCell_(sh, r.rowIndex, headers, 'updated_at', t);
    setCell_(sh, r.rowIndex, headers, 'updated_by', String(p.by || ''));
    sheet_(SHEET_AUDIT).appendRow([t, p.form_code, flag ? 'delete' : 'restore', '', '', '', String(p.reason || ''), String(p.by || '')]);
    return { form_code: p.form_code, deleted: flag, updated_at: t };
  } finally {
    lock.releaseLock();
  }
}

function stats_() {
  const rows = readAll_(SHEET_RESPONSES).rows;
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const active = rows.filter(r => Number(r.deleted) !== 1);
  const byEditor = {};
  active.forEach(r => {
    const k = r.entered_by || (r.source === 'online' ? 'Online' : 'Không rõ');
    byEditor[k] = (byEditor[k] || 0) + 1;
  });
  return {
    total: active.length,
    valid: active.filter(r => Number(r.valid) === 1).length,
    flagged: active.filter(isFlagged_).length,
    today: active.filter(r => String(r.server_time).slice(0, 10) === today).length,
    deleted: rows.length - active.length,
    byEditor: byEditor,
    lastSeq: currentSeq_(),
    lastUpdated: now_()
  };
}

function exportAll_() {
  return readAll_(SHEET_RESPONSES).rows.map(r => {
    const out = {};
    SYS_COLS.forEach(c => { if (c !== 'answers_json') out[c] = r[c]; });
    out.answers = parseAnswers_(r.answers_json);
    return out;
  });
}

/* ========================= TIỆN ÍCH ========================= */

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Chưa có sheet "' + name + '". Hãy chạy hàm setup trước.');
  return sh;
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  return lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
}

function ensureAnswerColumns_(sh, keys) {
  const headers = headers_(sh);
  const missing = keys.filter(k => headers.indexOf(k) === -1 && SYS_COLS.indexOf(k) === -1);
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    return headers.concat(missing);
  }
  return headers;
}

function readAll_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(String);
  const rows = values.map(v => {
    const o = {};
    headers.forEach((h, i) => { o[h] = v[i] instanceof Date ? Utilities.formatDate(v[i], TZ, "yyyy-MM-dd'T'HH:mm:ss") : v[i]; });
    return o;
  });
  return { headers: headers, rows: rows };
}

function findRow_(formCode) {
  if (!formCode) return null;
  const data = readAll_(SHEET_RESPONSES);
  const idx = data.rows.findIndex(r => r.form_code === formCode);
  return idx === -1 ? null : { rowIndex: idx + 2, obj: data.rows[idx] };
}

function setCell_(sh, row, headers, col, val) {
  const c = headers.indexOf(col);
  if (c >= 0) sh.getRange(row, c + 1).setValue(val);
}

function summary_(r) {
  const o = {
    seq: r.seq, form_code: r.form_code, display_name: r.display_name, source: r.source,
    entered_by: r.entered_by, paper_date: r.paper_date, server_time: r.server_time,
    updated_at: r.updated_at, duration_sec: r.duration_sec, valid: r.valid, flags: r.flags,
    edited: r.edited, deleted: r.deleted, delete_reason: r.delete_reason
  };
  LIST_ANSWER_FIELDS.forEach(f => { o[f] = r[f]; });
  return o;
}

function nextSeq_() {
  const meta = sheet_(SHEET_META);
  const cell = meta.getRange(2, 2);
  const next = (Number(cell.getValue()) || 0) + 1;
  cell.setValue(next);
  return next;
}

function currentSeq_() {
  return Number(sheet_(SHEET_META).getRange(2, 2).getValue()) || 0;
}

function parseAnswers_(s) {
  try { return JSON.parse(s || '{}'); } catch (e) { return {}; }
}

function cellValue_(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(';');      // câu chọn nhiều: "1;3"
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function isFlagged_(r) { return (r.valid !== '' && Number(r.valid) === 0) || String(r.flags || '') !== ''; }
function uniq_(arr) { return arr.filter((x, i) => arr.indexOf(x) === i); }
function pad_(n, w) { return String(n).padStart(w, '0'); }
function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
