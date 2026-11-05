/**
 * Backend Google Apps Script – phiếu khảo sát + quản trị
 *
 * Deploy → Web app → Execute as: Me → Who has access: Anyone
 * Đặt ADMIN_KEY bên dưới; không để mã này trên client.
 */

/* Đặt mã thật trong Apps Script đã triển khai — KHÔNG commit mã vào Git */
var ADMIN_KEY = "DOI_MA_NAY_TREN_APPS_SCRIPT";
var SHEET_RESPONSES = "responses";
var SHEET_AUDIT = "audit_log";
var SHEET_META = "meta";

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var raw = (e && e.postData && e.postData.contents) || "{}";
    var data = JSON.parse(raw);
    var action = data.action || (data.form_code && data.edit_reason ? "update" : "create");

    if (action === "auth") return json_(auth_(data));
    if (action === "list") return json_(requireKey_(data) && list_(data));
    if (action === "get") return json_(requireKey_(data) && get_(data));
    if (action === "update") return json_(requireKey_(data) && update_(data));
    if (action === "softDelete") return json_(requireKey_(data) && softDelete_(data));
    if (action === "restore") return json_(requireKey_(data) && restore_(data));
    if (action === "export") return json_(requireKey_(data) && export_(data));
    if (action === "create" || !data.action) return json_(create_(data));
    return json_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  e = e || { parameter: {} };
  if ((e.parameter.key || "") !== ADMIN_KEY) {
    return json_({ ok: false, error: "Unauthorized" });
  }
  return json_(list_({ page: 1, pageSize: 1, filters: {} }));
}

function auth_(data) {
  if ((data.key || "") !== ADMIN_KEY) return { ok: false, error: "Mã quản trị không đúng" };
  return { ok: true };
}

function requireKey_(data) {
  if ((data.key || "") !== ADMIN_KEY) throw new Error("Unauthorized");
  return true;
}

function create_(data) {
  if (!data.respondent_id) return { ok: false, error: "Thiếu respondent_id" };
  var sheet = getSheet_(SHEET_RESPONSES);
  var headers = getHeaders_();
  ensureHeader_(sheet, headers);

  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, colIndex_(headers, "respondent_id"), last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(data.respondent_id)) {
        return { ok: false, error: "Trùng respondent_id" };
      }
    }
  }

  var source = data.source === "paper" ? "paper" : "online";
  var form_code = nextFormCode_(source);
  data.form_code = form_code;
  data.server_time = new Date().toISOString();
  data.edited = 0;
  data.deleted = 0;
  data.delete_reason = "";
  data.source = source;

  var encoded = encodeRowApps_(data);
  var row = headers.map(function (h) {
    var v = encoded[h];
    return v === undefined || v === null ? "" : v;
  });
  sheet.appendRow(row);

  // Lưu JSON gốc để get/update chính xác
  savePayload_(form_code, data);

  return { ok: true, form_code: form_code };
}

function list_(data) {
  var all = loadAllPayloads_();
  var f = data.filters || {};
  var rows = all.slice();

  if (!f.includeDeleted && f.status !== "deleted") rows = rows.filter(function (r) { return !r.deleted; });
  if (f.status === "deleted") rows = rows.filter(function (r) { return !!r.deleted; });
  if (f.status === "valid") rows = rows.filter(function (r) { return !r.deleted && r.quality && r.quality.valid === 1; });
  if (f.status === "flagged") {
    rows = rows.filter(function (r) {
      if (r.deleted) return false;
      var q = r.quality || {};
      return q.valid !== 1 || q.attention_fail === 1 || q.speeder === 1 || q.straightline_flag === 1 || !!r.flag_inconsistent;
    });
  }
  if (f.source) rows = rows.filter(function (r) { return r.source === f.source; });
  if (f.A1) rows = rows.filter(function (r) { return String((r.answers || {}).A1) === String(f.A1); });
  if (f.A2) rows = rows.filter(function (r) { return String((r.answers || {}).A2) === String(f.A2); });
  if (f.A11) rows = rows.filter(function (r) { return String((r.answers || {}).A11) === String(f.A11); });
  if (f.q) {
    var q = String(f.q).toLowerCase();
    rows = rows.filter(function (r) { return String(r.form_code || "").toLowerCase().indexOf(q) >= 0; });
  }
  if (f.from) rows = rows.filter(function (r) { return String(r.server_time || "") >= f.from; });
  if (f.to) rows = rows.filter(function (r) { return String(r.server_time || "").slice(0, 10) <= f.to; });

  var sortKey = data.sortKey || "server_time";
  var sortDir = data.sortDir === "asc" ? 1 : -1;
  rows.sort(function (a, b) {
    var av = a[sortKey] || "";
    var bv = b[sortKey] || "";
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });

  var active = all.filter(function (r) { return !r.deleted; });
  var valid = active.filter(function (r) { return r.quality && r.quality.valid === 1; }).length;
  var flagged = active.filter(function (r) {
    var q = r.quality || {};
    return q.valid !== 1 || q.attention_fail === 1 || q.speeder === 1 || q.straightline_flag === 1 || !!r.flag_inconsistent;
  }).length;
  var today = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
  var todayCount = active.filter(function (r) { return String(r.server_time || "").slice(0, 10) === today; }).length;

  var pageSize = data.pageSize || 20;
  var page = Math.max(1, data.page || 1);
  var start = (page - 1) * pageSize;

  return {
    ok: true,
    total: rows.length,
    page: page,
    pageSize: pageSize,
    rows: rows.slice(start, start + pageSize),
    stats: { totalAll: active.length, valid: valid, flagged: flagged, today: todayCount },
  };
}

function get_(data) {
  var rec = findPayload_(data.form_code);
  if (!rec) return { ok: false, error: "Không tìm thấy phiếu" };
  return { ok: true, row: rec };
}

function update_(data) {
  var old = findPayload_(data.form_code);
  if (!old) return { ok: false, error: "Không tìm thấy phiếu" };
  var payload = data.payload || {};
  var changes = diffAnswers_(old.answers || {}, payload.answers || {});
  var updated = Object.assign({}, old, payload, {
    form_code: old.form_code,
    source: old.source,
    server_time: old.server_time,
    edited: 1,
    deleted: old.deleted || 0,
    delete_reason: old.delete_reason || "",
  });
  savePayload_(old.form_code, updated);
  rewriteFlatRow_(updated);
  appendAudit_({
    time: new Date().toISOString(),
    form_code: old.form_code,
    action: "update",
    reason: data.edit_reason || payload.edit_reason || "",
    changes: changes,
  });
  return { ok: true, form_code: old.form_code };
}

function softDelete_(data) {
  var old = findPayload_(data.form_code);
  if (!old) return { ok: false, error: "Không tìm thấy" };
  old.deleted = 1;
  old.delete_reason = data.reason || "";
  savePayload_(old.form_code, old);
  rewriteFlatRow_(old);
  appendAudit_({
    time: new Date().toISOString(),
    form_code: data.form_code,
    action: "softDelete",
    reason: data.reason || "",
    changes: "",
  });
  return { ok: true };
}

function restore_(data) {
  var old = findPayload_(data.form_code);
  if (!old) return { ok: false, error: "Không tìm thấy" };
  old.deleted = 0;
  old.delete_reason = "";
  savePayload_(old.form_code, old);
  rewriteFlatRow_(old);
  appendAudit_({
    time: new Date().toISOString(),
    form_code: data.form_code,
    action: "restore",
    reason: "",
    changes: "",
  });
  return { ok: true };
}

function export_(data) {
  return { ok: true, rows: loadAllPayloads_(), audit: loadAudit_() };
}

function nextFormCode_(source) {
  var meta = getSheet_(SHEET_META);
  if (meta.getLastRow() === 0) meta.appendRow(["key", "value"]);
  var key = source === "paper" ? "seq_paper" : "seq_online";
  var prefix = source === "paper" ? "PKG-" : "PKS-";
  var values = meta.getDataRange().getValues();
  var rowIdx = -1;
  var seq = 0;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      rowIdx = i + 1;
      seq = Number(values[i][1] || 0);
      break;
    }
  }
  seq += 1;
  if (rowIdx > 0) meta.getRange(rowIdx, 2).setValue(seq);
  else meta.appendRow([key, seq]);
  return prefix + ("0000" + seq).slice(-4);
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

function colIndex_(headers, name) {
  var i = headers.indexOf(name);
  return i >= 0 ? i + 1 : 1;
}

function payloadSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("payloads");
  if (!sh) {
    sh = ss.insertSheet("payloads");
    sh.appendRow(["form_code", "json"]);
  }
  return sh;
}

function savePayload_(form_code, data) {
  var sh = payloadSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(form_code)) {
      sh.getRange(i + 1, 2).setValue(JSON.stringify(data));
      return;
    }
  }
  sh.appendRow([form_code, JSON.stringify(data)]);
}

function findPayload_(form_code) {
  var sh = payloadSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(form_code)) {
      return JSON.parse(values[i][1]);
    }
  }
  return null;
}

function loadAllPayloads_() {
  var sh = payloadSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][1]) continue;
    try {
      out.push(JSON.parse(values[i][1]));
    } catch (e) {}
  }
  return out;
}

function rewriteFlatRow_(rec) {
  var sheet = getSheet_(SHEET_RESPONSES);
  var headers = getHeaders_();
  ensureHeader_(sheet, headers);
  var encoded = encodeRowApps_(rec);
  var last = sheet.getLastRow();
  var codeCol = colIndex_(headers, "form_code");
  if (last < 2) {
    sheet.appendRow(headers.map(function (h) { return encoded[h] == null ? "" : encoded[h]; }));
    return;
  }
  var codes = sheet.getRange(2, codeCol, last - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) {
    if (String(codes[i][0]) === String(rec.form_code)) {
      var row = headers.map(function (h) { return encoded[h] == null ? "" : encoded[h]; });
      sheet.getRange(i + 2, 1, 1, headers.length).setValues([row]);
      return;
    }
  }
  sheet.appendRow(headers.map(function (h) { return encoded[h] == null ? "" : encoded[h]; }));
}

function appendAudit_(row) {
  var sh = getSheet_(SHEET_AUDIT);
  if (sh.getLastRow() === 0) sh.appendRow(["time", "form_code", "action", "reason", "changes"]);
  sh.appendRow([row.time, row.form_code, row.action, row.reason, row.changes]);
}

function loadAudit_() {
  var sh = getSheet_(SHEET_AUDIT);
  if (sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    out.push({
      time: values[i][0],
      form_code: values[i][1],
      action: values[i][2],
      reason: values[i][3],
      changes: values[i][4],
    });
  }
  return out.reverse();
}

function diffAnswers_(a, b) {
  var keys = {};
  Object.keys(a).forEach(function (k) { keys[k] = 1; });
  Object.keys(b).forEach(function (k) { keys[k] = 1; });
  var parts = [];
  Object.keys(keys).forEach(function (k) {
    var ov = JSON.stringify(a[k] == null ? "" : a[k]);
    var nv = JSON.stringify(b[k] == null ? "" : b[k]);
    if (ov !== nv) parts.push(k + ": " + ov + " → " + nv);
  });
  return parts.join(" | ");
}

function getHeaders_() {
  return [
    "form_code", "source", "respondent_id", "server_time", "start_time", "end_time", "duration_sec",
    "consent", "S0",
    "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    "A8_1", "A8_2", "A8_3", "A8_4", "A8_5", "A8_6", "A8_7",
    "A9", "A10", "A11", "A12", "skip_B",
    "B1_1", "B1_2", "B1_3", "B1_4", "B1_5", "B1_6", "B1_7",
    "B2_1", "B2_2", "B2_3", "B2_4", "B2_5", "B2_6",
    "TL1", "TL2", "TL3", "TL4", "TL5", "TL6", "TL7", "TL8", "TL9", "TL10", "TL11", "TL12", "TL13", "TL14", "TL15",
    "TC1", "TC2", "TC3", "TC4", "TC5", "TC6", "TC7", "TC8", "TC9",
    "HT1", "HT2", "HT3", "HT4", "HT5", "HT6", "ATT1", "HT7", "HT8", "HT9", "HT10", "HT11",
    "MS1", "MS2", "MS3", "MS4",
    "FSIS1", "FSIS2", "FSIS3", "FSIS4",
    "SI1", "SI2", "SI3", "SI4",
    "skip_C5", "DB1", "DB2", "DB3", "DB4", "DB5",
    "C6_1", "C6_2", "C6_3", "C6_4", "C6_5", "C6_6", "C6_7", "C6_8",
    "D1", "D2_1", "D2_2", "D2_3", "D2_4", "D2_5", "D2_6",
    "skip_D", "D3", "D4", "D5_1", "D5_2", "D5_3", "D5_4", "D5_5", "D6",
    "VM1", "VM2", "VM3", "VM4", "VM5", "VM6", "VM7", "VM8", "VM9", "VM10",
    "E2", "F1",
    "KT1", "KT2", "KT3", "KT4", "KT5", "KT6",
    "TD1", "TD2", "TD3", "TD4", "TD5",
    "G1_1", "G1_2", "G1_3", "G1_4", "G1_5", "G1_6", "G1_7", "G1_8",
    "G2", "NEO1", "NEO2", "NEO3",
    "G3_1", "G3_2", "G3_3", "G3_4", "G3_5", "G3_6",
    "SS1", "SS2", "SS3", "SS4", "SS5",
    "G5_1", "G5_2", "G5_3", "G5_4", "G5_5", "G5_6", "G5_other",
    "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10",
    "GP11", "GP12", "GP13", "GP14", "GP15", "GP16", "GP17", "GP18", "GP19", "GP20", "GP21",
    "I1", "I2", "I3", "I4",
    "attention_fail", "straightline_max", "straightline_flag", "speeder",
    "honeypot_flag", "flag_inconsistent", "valid", "edited", "deleted", "delete_reason",
    "device", "screen_w", "page_times"
  ];
}

function encodeRowApps_(record) {
  var answers = record.answers || {};
  var quality = record.quality || {};
  var row = {};
  getHeaders_().forEach(function (c) { row[c] = ""; });
  row.form_code = record.form_code || "";
  row.source = record.source || "online";
  row.respondent_id = record.respondent_id || "";
  row.server_time = record.server_time || "";
  row.start_time = record.start_time || "";
  row.end_time = record.end_time || "";
  row.duration_sec = record.duration_sec != null ? record.duration_sec : "";
  row.consent = answers.consent === 1 ? 1 : 0;
  row.S0 = answers.S0 != null ? answers.S0 : "";
  ["A1","A2","A3","A4","A5","A6","A7","A9","A10","A11","A12","D1","D3","D4","D6","E2","F1","G2"].forEach(function (k) {
    if (answers[k] !== undefined && answers[k] !== null && answers[k] !== "") row[k] = answers[k];
  });
  expandMulti_(row, answers, "A8", 7);
  expandMulti_(row, answers, "B2", 6);
  expandMulti_(row, answers, "C6", 8);
  expandMulti_(row, answers, "D2", 6);
  expandMulti_(row, answers, "D5", 5);
  expandMulti_(row, answers, "G1", 8);
  expandMulti_(row, answers, "G3", 6);
  expandMulti_(row, answers, "G5", 6);
  if (quality.skip_B === 1) {
    for (var i = 1; i <= 7; i++) row["B1_" + i] = "";
    for (var j = 1; j <= 6; j++) row["B2_" + j] = "";
  } else {
    for (var b = 1; b <= 7; b++) row["B1_" + b] = answers["B1_" + b] != null ? answers["B1_" + b] : "";
  }
  Object.keys(answers).forEach(function (k) {
    if (row.hasOwnProperty(k) && answers[k] !== undefined && answers[k] !== null && answers[k] !== "" && typeof answers[k] !== "object") {
      row[k] = answers[k];
    }
  });
  if (quality.skip_C5 === 1) for (var d = 1; d <= 5; d++) row["DB" + d] = "";
  if (quality.skip_D === 1) {
    row.D3 = ""; row.D4 = ""; row.D6 = "";
    for (var x = 1; x <= 5; x++) row["D5_" + x] = x === 5 ? 1 : 0;
  }
  row.skip_B = quality.skip_B != null ? quality.skip_B : "";
  row.skip_C5 = quality.skip_C5 != null ? quality.skip_C5 : "";
  row.skip_D = quality.skip_D != null ? quality.skip_D : "";
  row.G5_other = clean_(answers.G5_other);
  row.I1 = clean_(answers.I1); row.I2 = clean_(answers.I2); row.I3 = clean_(answers.I3); row.I4 = clean_(answers.I4);
  row.attention_fail = quality.attention_fail != null ? quality.attention_fail : "";
  row.straightline_max = quality.straightline_max != null ? quality.straightline_max : "";
  row.straightline_flag = quality.straightline_flag != null ? quality.straightline_flag : "";
  row.speeder = quality.speeder != null ? quality.speeder : "";
  row.honeypot_flag = quality.honeypot_flag != null ? quality.honeypot_flag : "";
  row.flag_inconsistent = record.flag_inconsistent || "";
  row.valid = quality.valid != null ? quality.valid : "";
  row.edited = record.edited ? 1 : 0;
  row.deleted = record.deleted ? 1 : 0;
  row.delete_reason = record.delete_reason || "";
  row.device = record.device || "";
  row.screen_w = record.screen_w != null ? record.screen_w : "";
  row.page_times = typeof record.page_times === "string" ? record.page_times : JSON.stringify(record.page_times || {});
  return row;
}

function expandMulti_(row, answers, qid, n) {
  var sel = answers[qid];
  if (!Array.isArray(sel)) sel = [];
  for (var i = 1; i <= n; i++) row[qid + "_" + i] = sel.indexOf(i) >= 0 ? 1 : 0;
}

function clean_(s) {
  return String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/,/g, " ").trim();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
