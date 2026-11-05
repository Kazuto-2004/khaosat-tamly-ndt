/* Mã hóa dữ liệu, xuất CSV, codebook, SPSS syntax */

const ExportUtil = (function () {
  const MULTI_EXPAND = {
    A8: 7,
    B2: 6,
    C6: 8,
    D2: 6,
    D5: 5,
    G1: 8,
    G3: 6,
    G5: 6,
  };

  const LIKERT_VARS = [
    "B1_1", "B1_2", "B1_3", "B1_4", "B1_5", "B1_6", "B1_7",
    "TL1", "TL2", "TL3", "TL4", "TL5", "TL6", "TL7", "TL8", "TL9", "TL10", "TL11", "TL12", "TL13", "TL14", "TL15",
    "TC1", "TC2", "TC3", "TC4", "TC5", "TC6", "TC7", "TC8", "TC9",
    "HT1", "HT2", "HT3", "HT4", "HT5", "HT6", "ATT1", "HT7", "HT8", "HT9", "HT10", "HT11",
    "MS1", "MS2", "MS3", "MS4",
    "FSIS1", "FSIS2", "FSIS3", "FSIS4",
    "SI1", "SI2", "SI3", "SI4",
    "DB1", "DB2", "DB3", "DB4", "DB5",
    "D4",
    "VM1", "VM2", "VM3", "VM4", "VM5", "VM6", "VM7", "VM8", "VM9", "VM10",
    "KT1", "KT2", "KT3", "KT4", "KT5", "KT6",
    "TD1", "TD2", "TD3", "TD4", "TD5",
    "NEO1", "NEO2", "NEO3",
    "SS1", "SS2", "SS3", "SS4", "SS5",
  ];

  for (let i = 1; i <= 21; i++) LIKERT_VARS.push("GP" + i);

  function columnOrder() {
    const cols = [
      "form_code", "display_name", "seq_num", "source", "respondent_id", "server_time", "start_time", "end_time", "duration_sec",
      "consent", "S0",
      "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    ];
    for (let i = 1; i <= 7; i++) cols.push("A8_" + i);
    cols.push("A9", "A10", "A11", "A12", "skip_B");
    for (let i = 1; i <= 7; i++) cols.push("B1_" + i);
    for (let i = 1; i <= 6; i++) cols.push("B2_" + i);
    for (let i = 1; i <= 15; i++) cols.push("TL" + i);
    for (let i = 1; i <= 9; i++) cols.push("TC" + i);
    for (let i = 1; i <= 6; i++) cols.push("HT" + i);
    cols.push("ATT1");
    for (let i = 7; i <= 11; i++) cols.push("HT" + i);
    for (let i = 1; i <= 4; i++) cols.push("MS" + i);
    for (let i = 1; i <= 4; i++) cols.push("FSIS" + i);
    for (let i = 1; i <= 4; i++) cols.push("SI" + i);
    cols.push("skip_C5");
    for (let i = 1; i <= 5; i++) cols.push("DB" + i);
    for (let i = 1; i <= 8; i++) cols.push("C6_" + i);
    cols.push("D1");
    for (let i = 1; i <= 6; i++) cols.push("D2_" + i);
    cols.push("skip_D", "D3", "D4");
    for (let i = 1; i <= 5; i++) cols.push("D5_" + i);
    cols.push("D6");
    for (let i = 1; i <= 10; i++) cols.push("VM" + i);
    cols.push("E2", "F1");
    for (let i = 1; i <= 6; i++) cols.push("KT" + i);
    for (let i = 1; i <= 5; i++) cols.push("TD" + i);
    for (let i = 1; i <= 8; i++) cols.push("G1_" + i);
    cols.push("G2", "NEO1", "NEO2", "NEO3");
    for (let i = 1; i <= 6; i++) cols.push("G3_" + i);
    for (let i = 1; i <= 5; i++) cols.push("SS" + i);
    for (let i = 1; i <= 6; i++) cols.push("G5_" + i);
    cols.push("G5_other");
    for (let i = 1; i <= 21; i++) cols.push("GP" + i);
    cols.push("I1", "I2", "I3", "I4");
    cols.push(
      "attention_fail", "straightline_max", "straightline_flag", "speeder",
      "honeypot_flag", "flag_inconsistent", "valid", "edited", "deleted", "delete_reason",
      "device", "screen_w", "page_times"
    );
    return cols;
  }

  function cleanText(s) {
    return String(s == null ? "" : s)
      .replace(/[\r\n]+/g, " ")
      .replace(/,/g, " ")
      .trim();
  }

  function encodeRow(record) {
    const answers = record.answers || {};
    const quality = record.quality || {};
    const row = {};

    columnOrder().forEach((c) => {
      row[c] = "";
    });

    row.form_code = record.form_code || "";
    row.display_name = record.display_name || "";
    row.seq_num = record.seq_num != null ? record.seq_num : record.seq != null ? record.seq : "";
    row.source = record.source || "online";
    row.respondent_id = record.respondent_id || record.client_uuid || "";
    row.server_time = record.server_time || "";
    row.start_time = record.start_time || "";
    row.end_time = record.end_time || "";
    row.duration_sec = record.duration_sec != null ? record.duration_sec : "";
    row.consent = answers.consent === 1 ? 1 : 0;
    row.S0 = answers.S0 != null ? answers.S0 : "";
    if (record.valid != null && quality.valid == null) quality.valid = Number(record.valid);
    if (record.flags && !record.quality) {
      String(record.flags)
        .split(";")
        .filter(Boolean)
        .forEach((f) => {
          if (f === "attention_fail") quality.attention_fail = 1;
          if (f === "speeder") quality.speeder = 1;
          if (f === "straightline") quality.straightline_flag = 1;
          if (f === "honeypot") quality.honeypot_flag = 1;
          if (f === "screened_out") quality.screened_out = 1;
        });
    }

    ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A9", "A10", "A11", "A12", "D1", "D3", "D4", "D6", "E2", "F1", "G2"].forEach((k) => {
      if (answers[k] !== undefined && answers[k] !== null && answers[k] !== "") row[k] = answers[k];
    });

    Object.keys(MULTI_EXPAND).forEach((qid) => {
      const n = MULTI_EXPAND[qid];
      const sel = Array.isArray(answers[qid]) ? answers[qid] : [];
      for (let i = 1; i <= n; i++) {
        const key = qid + "_" + i;
        if (qid === "C6" && quality.skip_C5 === 1 && (i === 5 || i === 6)) {
          row[key] = "";
        } else if (qid === "D2" && answers.A6 === 0 && i === 2) {
          row[key] = "";
        } else if (qid === "D5" && quality.skip_D === 1) {
          row[key] = i === 5 ? 1 : 0;
        } else if (
          (qid === "B2" && quality.skip_B === 1) ||
          (qid === "D5" && answers.D1 == null)
        ) {
          row[key] = quality.skip_B === 1 && qid === "B2" ? "" : row[key];
          if (qid === "B2" && quality.skip_B === 1) row[key] = "";
        } else {
          row[key] = sel.includes(i) ? 1 : 0;
        }
      }
    });

    if (quality.skip_B === 1) {
      for (let i = 1; i <= 7; i++) row["B1_" + i] = "";
      for (let i = 1; i <= 6; i++) row["B2_" + i] = "";
    } else {
      for (let i = 1; i <= 7; i++) {
        const k = "B1_" + i;
        row[k] = answers[k] != null ? answers[k] : "";
      }
    }

    LIKERT_VARS.forEach((k) => {
      if (row[k] !== undefined && String(row[k]) !== "" && k.indexOf("B1_") === 0) return;
      if (k.indexOf("DB") === 0 && quality.skip_C5 === 1) {
        row[k] = "";
        return;
      }
      if ((k === "D3" || k === "D4" || k === "D6") && quality.skip_D === 1) {
        row[k] = "";
        return;
      }
      if (k.indexOf("B1_") === 0 && quality.skip_B === 1) {
        row[k] = "";
        return;
      }
      if (answers[k] !== undefined && answers[k] !== null && answers[k] !== "") row[k] = answers[k];
    });

    row.skip_B = quality.skip_B != null ? quality.skip_B : "";
    row.skip_C5 = quality.skip_C5 != null ? quality.skip_C5 : "";
    row.skip_D = quality.skip_D != null ? quality.skip_D : "";
    row.G5_other = cleanText(answers.G5_other);
    row.I1 = cleanText(answers.I1);
    row.I2 = cleanText(answers.I2);
    row.I3 = cleanText(answers.I3);
    row.I4 = cleanText(answers.I4);

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

  function csvEscape(v) {
    const s = v == null ? "" : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(rows) {
    const cols = columnOrder();
    const lines = [cols.map(csvEscape).join(",")];
    rows.forEach((r) => {
      lines.push(cols.map((c) => csvEscape(r[c])).join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildCodebook() {
    const rows = [];
    function add(variable, label, type, values, section, condition) {
      rows.push({ variable, label, type, values, section, condition: condition || "" });
    }

    add("respondent_id", "Mã người trả lời (UUID)", "string", "", "meta", "");
    add("consent", "Đồng ý tham gia khảo sát", "single", "1=Đồng ý", "Mở đầu", "");
    add("S0", "Có tài khoản và đã giao dịch cổ phiếu TTCK VN", "single", "1=Có; 2=Không", "Mở đầu", "Biến kiểm soát chất lượng, không đưa vào mô hình");

    Object.keys(SURVEY.questions).forEach((qid) => {
      const q = SURVEY.questions[qid];
      if (q.type === "consent") return;
      const cond = q.showIf ? JSON.stringify(q.showIf) : "";
      if (q.type === "single" || q.type === "likert") {
        const values = (q.options || [])
          .map((o) => o.code + "=" + o.label)
          .join("; ") || "1-5 Likert";
        add(q.id, q.label, q.type, values, q.section, cond);
      } else if (q.type === "multi") {
        (q.options || []).forEach((o) => {
          add(q.id + "_" + o.code, q.label + " | " + o.label, "binary", "0=Không chọn; 1=Chọn", q.section, cond);
        });
        if (q.other) add(q.other.id, q.other.label || "Khác (text)", "text", "", q.section, cond);
      } else if (q.type === "likert_group") {
        Logic.getLikertItems(q).forEach((it) => {
          const note = it.attention ? "Biến kiểm soát chất lượng, không đưa vào mô hình" : cond;
          add(it.id, it.label, "likert", "1-5", q.section, note);
        });
      } else if (q.type === "text") {
        add(q.id, q.label, "text", "", q.section, "");
      }
    });

    [
      ["skip_B", "Bỏ qua Phần B", "binary", "0=Không; 1=Có", "meta"],
      ["skip_C5", "Bỏ qua C5", "binary", "0=Không; 1=Có", "meta"],
      ["skip_D", "Bỏ qua D3/D4/D6 (D1=1)", "binary", "0=Không; 1=Có", "meta"],
      ["attention_fail", "Trượt câu ATT1", "binary", "0=Không; 1=Có", "quality", "Biến kiểm soát chất lượng, không đưa vào mô hình"],
      ["straightline_max", "Số khối Likert straight-lining", "numeric", "", "quality"],
      ["straightline_flag", "Cờ straight-lining (>=2 khối)", "binary", "0=Không; 1=Có", "quality"],
      ["speeder", "Hoàn thành quá nhanh", "binary", "0=Không; 1=Có", "quality"],
      ["honeypot_flag", "Honeypot bị điền", "binary", "0=Không; 1=Có", "quality"],
      ["flag_inconsistent", "Mã quy tắc không nhất quán", "string", "R1;R2;...", "quality"],
      ["valid", "Phiếu hợp lệ phân tích", "binary", "0=Không; 1=Có", "quality"],
    ].forEach((r) => add(r[0], r[1], r[2], r[3], r[4], r[5] || ""));

    return rows;
  }

  function codebookCsv() {
    const rows = buildCodebook();
    const cols = ["variable", "label", "type", "values", "section", "condition"];
    const lines = [cols.map(csvEscape).join(",")];
    rows.forEach((r) => lines.push(cols.map((c) => csvEscape(r[c])).join(",")));
    return "\uFEFF" + lines.join("\r\n");
  }

  function spssSyntax() {
    const lines = ["* SPSS syntax – labels for MotNghinPhieuKhaoSat.", ""];
    lines.push("VARIABLE LABELS");
    const cb = buildCodebook();
    cb.forEach((r, idx) => {
      const end = idx === cb.length - 1 ? "." : "";
      lines.push(" " + r.variable + ' "' + r.label.replace(/"/g, "'") + '"' + (end || ""));
    });
    lines.push("");

    Object.keys(SURVEY.questions).forEach((qid) => {
      const q = SURVEY.questions[qid];
      if (q.type === "single" || q.type === "likert") {
        if (!q.options || !q.options.length) return;
        lines.push("VALUE LABELS " + q.id);
        q.options.forEach((o, i) => {
          const end = i === q.options.length - 1 ? "." : "";
          lines.push(" " + o.code + ' "' + o.label.replace(/"/g, "'") + '"' + (end || ""));
        });
        lines.push("");
      }
    });

    lines.push("MISSING VALUES");
    lines.push(" B1_1 TO B1_7 DB1 TO DB5 D3 D4 D6 () .");
    lines.push("");
    lines.push("EXECUTE.");
    return lines.join("\r\n");
  }

  return {
    columnOrder,
    encodeRow,
    toCsv,
    downloadText,
    codebookCsv,
    spssSyntax,
    MULTI_EXPAND,
  };
})();

if (typeof module !== "undefined") module.exports = { ExportUtil };
