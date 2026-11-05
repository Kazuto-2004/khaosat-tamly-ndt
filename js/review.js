/* Xuất danh sách rà soát (.xlsx) – cấu hình REVIEW_RULES */
const Review = (function () {
  const NAVY = "1E3A5F";
  const YELLOW = "FFF2CC";
  const GRAY = "666666";

  const FLAG_DESC = {
    R1: "dưới 25 tuổi nhưng ≥10 năm kinh nghiệm",
    R2: "dưới 25 tuổi nhưng 5–<10 năm kinh nghiệm",
    R3: "kiến thức tài chính thấp nhưng đầu tư là công việc chính",
    R4: "danh mục <100 triệu nhưng dùng margin mức cao",
    R5: "B2 'Chưa thay đổi nhiều' nhưng ≥5 mục B1 khác mức 3",
    R6: "không chọn MXH/diễn đàn/KOL làm nguồn nhưng F1 = rất thường xuyên",
    R7: "F1 = không dùng MXH nhưng khối KT trung bình ≥4",
    R8: "C6 chọn 'Không có hành vi nào' nhưng khối HT trung bình ≥4",
    R9: "chiến lược dài hạn (A4=3) nhưng thường đầu tư penny (A5=3)",
  };

  const B1_IDS = ["B1_1", "B1_2", "B1_3", "B1_4", "B1_5", "B1_6", "B1_7"];
  const DB_IDS = ["DB1", "DB2", "DB3", "DB4", "DB5"];

  function answersOf(rec) {
    return rec && rec.answers ? rec.answers : rec || {};
  }
  function arr(v) {
    if (Array.isArray(v)) return v.map(Number);
    if (v == null || v === "") return [];
    return [Number(v)];
  }
  function has(v) {
    return v !== undefined && v !== null && v !== "";
  }
  function seqOf(rec) {
    const n = rec.seq != null ? rec.seq : rec.seq_num;
    return Number(n) || 0;
  }
  function codeOf(rec) {
    return rec.form_code || "";
  }
  function optLabel(qid, code) {
    const q = SURVEY.questions[qid];
    if (!q || !q.options) return String(code);
    const o = q.options.find((x) => Number(x.code) === Number(code));
    return o ? o.label : String(code);
  }
  /** Dạng "1-Đã từng…" */
  function fmtCode(qid, code, shortMap) {
    if (!has(code)) return "";
    const c = Number(code);
    const lab = (shortMap && shortMap[c]) || optLabel(qid, c);
    return c + "-" + lab;
  }
  function fmtMulti(qid, codes, shortMap) {
    return arr(codes)
      .map((c) => fmtCode(qid, c, shortMap))
      .filter(Boolean)
      .join("; ");
  }
  function yesNo(sel, code) {
    return arr(sel).includes(Number(code)) ? "Có" : "Không";
  }
  function emptyDBs(a) {
    return DB_IDS.filter((id) => !has(a[id]));
  }
  function anyDBAnswered(a) {
    return DB_IDS.some((id) => has(a[id]));
  }
  function dbSummary(a) {
    const empty = emptyDBs(a);
    if (empty.length === DB_IDS.length) return "Trống";
    if (!empty.length) {
      return DB_IDS.map((id) => id + "=" + a[id]).join("; ");
    }
    return "Trống: " + empty.join(", ");
  }
  function b1ChangedCount(a) {
    return B1_IDS.filter((id) => typeof a[id] === "number" && a[id] !== 3).length;
  }
  function b1AnsweredCount(a) {
    return B1_IDS.filter((id) => has(a[id])).length;
  }
  function flagList(rec) {
    const raw = String(rec.flags || rec.flag_inconsistent || "");
    return raw
      .split(/[;|,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  function truncate(s, n) {
    s = String(s || "").trim();
    if (s.length <= n) return s;
    return s.slice(0, n) + "…";
  }
  function shortB2(code) {
    const map = {
      1: "Kinh nghiệm thua lỗ/chu kỳ",
      2: "Nâng cao kiến thức",
      3: "Thông tin chính thống",
      4: "Đổi chiến lược dài hạn",
      5: "Cộng đồng chất lượng",
      6: "Chưa thay đổi nhiều",
    };
    return map[Number(code)] || optLabel("B2", code);
  }

  const A6_SHORT = {
    0: "Chưa từng dùng margin",
    1: "Đã từng dùng, nay không dùng",
    2: "Thỉnh thoảng (<30%)",
    3: "Thường xuyên (30–70%)",
    4: "Mức cao (>70%)",
  };

  /* —— Quy tắc —— */
  const REVIEW_RULES = [
    {
      id: "Y1",
      title: "A6 ≥ 1 (đã từng/đang dùng margin) nhưng DB1–DB5 thiếu",
      note: "Người đã từng/đang dùng margin nhưng bỏ trống một hoặc nhiều mục Likert đòn bẩy (DB1–DB5).",
      match(rec) {
        const a = answersOf(rec);
        return [1, 2, 3, 4].includes(Number(a.A6)) && emptyDBs(a).length > 0;
      },
      headers: [
        "Mã phiếu",
        "A6",
        "C6_5 Tăng margin (Có/Không)",
        "C6_6 Bị call margin (Có/Không)",
        "D2_2 Tăng margin khi TT tăng (Có/Không)",
        "DB1–DB5",
        "Đối chiếu phiếu gốc (điền)",
      ],
      row(rec) {
        const a = answersOf(rec);
        return [
          codeOf(rec),
          fmtCode("A6", a.A6, A6_SHORT),
          yesNo(a.C6, 5),
          yesNo(a.C6, 6),
          yesNo(a.D2, 2),
          dbSummary(a),
          "",
        ];
      },
    },
    {
      id: "Y1b",
      title: "A6 = 0 (chưa từng dùng margin) nhưng có hành vi margin",
      note: "Khai báo chưa từng dùng margin nhưng C6/D2/DB vẫn thể hiện hành vi liên quan margin.",
      match(rec) {
        const a = answersOf(rec);
        if (Number(a.A6) !== 0) return false;
        const c6 = arr(a.C6);
        const d2 = arr(a.D2);
        return c6.includes(5) || c6.includes(6) || d2.includes(2) || anyDBAnswered(a);
      },
      headers: ["Mã phiếu", "A6", "C6_5", "C6_6", "D2_2", "DB1–DB5", "Đối chiếu phiếu gốc (điền)"],
      row(rec) {
        const a = answersOf(rec);
        return [
          codeOf(rec),
          fmtCode("A6", a.A6, A6_SHORT),
          yesNo(a.C6, 5),
          yesNo(a.C6, 6),
          yesNo(a.D2, 2),
          dbSummary(a),
          "",
        ];
      },
    },
    {
      id: "Y2",
      title: "D1 = 1 (chưa từng trải qua danh mục giảm mạnh) nhưng có D3/D4/D6 hoặc D5 khác 'Không áp dụng'",
      note: "Khai báo chưa trải qua giảm mạnh nhưng vẫn có câu trả lời ở khối hậu quả sụp đổ.",
      match(rec) {
        const a = answersOf(rec);
        if (Number(a.D1) !== 1) return false;
        if (has(a.D3) || has(a.D4) || has(a.D6)) return true;
        const d5 = arr(a.D5);
        return d5.length > 0 && d5.some((c) => c !== 5);
      },
      headers: ["Mã phiếu", "D1", "D3", "D4", "D5", "D6", "Mâu thuẫn kèm theo", "Đối chiếu phiếu gốc (điền)"],
      row(rec) {
        const a = answersOf(rec);
        const extras = [];
        const c6 = arr(a.C6);
        if (c6.includes(2)) extras.push("C6_2: bán tháo hoảng loạn khi TT giảm mạnh");
        if (c6.includes(6)) extras.push("C6_6: bị call margin");
        return [
          codeOf(rec),
          fmtCode("D1", a.D1),
          has(a.D3) ? fmtCode("D3", a.D3) : "",
          has(a.D4) ? String(a.D4) : "",
          fmtMulti("D5", a.D5),
          has(a.D6) ? fmtCode("D6", a.D6) : "",
          extras.join("; "),
          "",
        ];
      },
    },
    {
      id: "Y2b",
      title: "D1 = 1 nhưng C6 cho thấy đã trải qua giảm mạnh",
      note: "D1 = chưa từng giảm mạnh nhưng C6 có bán tháo hoảng loạn hoặc bị call margin.",
      match(rec) {
        const a = answersOf(rec);
        if (Number(a.D1) !== 1) return false;
        const c6 = arr(a.C6);
        return c6.includes(2) || c6.includes(6);
      },
      headers: ["Mã phiếu", "D1", "C6_2", "C6_6", "I2 (trích 120 ký tự đầu)", "Đối chiếu phiếu gốc (điền)"],
      row(rec) {
        const a = answersOf(rec);
        return [
          codeOf(rec),
          fmtCode("D1", a.D1),
          yesNo(a.C6, 2),
          yesNo(a.C6, 6),
          truncate(a.I2, 120),
          "",
        ];
      },
    },
    {
      id: "Y3",
      title: "B2 có 'Chưa thay đổi nhiều' (mã 6) kèm nguyên nhân khác",
      note: "Đáp án độc quyền B2=6 đi kèm ít nhất một nguyên nhân 1–5.",
      match(rec) {
        const b2 = arr(answersOf(rec).B2);
        return b2.includes(6) && b2.some((c) => c >= 1 && c <= 5);
      },
      headers: [
        "Mã phiếu",
        "A2",
        "B2_6",
        "Nguyên nhân chọn kèm (nhãn rút gọn)",
        "Số mục B1 khác mức 3",
        "B1.1",
        "B1.2",
        "B1.3",
        "B1.4",
        "B1.5",
        "B1.6",
        "B1.7",
        "Đối chiếu phiếu gốc (điền)",
      ],
      row(rec) {
        const a = answersOf(rec);
        const b2 = arr(a.B2);
        const others = b2.filter((c) => c !== 6).map(shortB2).join("; ");
        return [
          codeOf(rec),
          fmtCode("A2", a.A2),
          b2.includes(6) ? "Có" : "Không",
          others,
          b1ChangedCount(a),
          ...B1_IDS.map((id) => (has(a[id]) ? a[id] : "")),
          "",
        ];
      },
    },
    {
      id: "Y3b",
      title: "B2 = 'Chưa thay đổi nhiều' nhưng phần lớn B1 khác mức 3",
      note: "Chọn B2 mã 6 nhưng ≥5 mục B1 khác mức 3 (Không thay đổi).",
      match(rec) {
        const a = answersOf(rec);
        return arr(a.B2).includes(6) && b1ChangedCount(a) >= 5;
      },
      headers: [
        "Mã phiếu",
        "A2",
        "B2_6",
        "Nguyên nhân chọn kèm (nhãn rút gọn)",
        "Số mục B1 khác mức 3",
        "B1.1",
        "B1.2",
        "B1.3",
        "B1.4",
        "B1.5",
        "B1.6",
        "B1.7",
        "Đối chiếu phiếu gốc (điền)",
      ],
      row(rec) {
        const a = answersOf(rec);
        const b2 = arr(a.B2);
        const others = b2.filter((c) => c !== 6).map(shortB2).join("; ");
        return [
          codeOf(rec),
          fmtCode("A2", a.A2),
          b2.includes(6) ? "Có" : "Không",
          others,
          b1ChangedCount(a),
          ...B1_IDS.map((id) => (has(a[id]) ? a[id] : "")),
          "",
        ];
      },
    },
    {
      id: "Y4",
      title: "Phần B có dữ liệu nhưng A2 < 3 năm",
      note: "A2 dưới 3 năm (mã 1 hoặc 2) nhưng vẫn có trả lời B1 hoặc B2 (lẽ ra bỏ qua phần B).",
      match(rec) {
        const a = answersOf(rec);
        if (![1, 2].includes(Number(a.A2))) return false;
        return b1AnsweredCount(a) > 0 || arr(a.B2).length > 0;
      },
      headers: ["Mã phiếu", "A2", "Số mục B1 có trả lời", "B2", "Đối chiếu phiếu gốc (điền)"],
      row(rec) {
        const a = answersOf(rec);
        return [codeOf(rec), fmtCode("A2", a.A2), b1AnsweredCount(a), fmtMulti("B2", a.B2), ""];
      },
    },
    {
      id: "Y5",
      title: "Chọn quá số đáp án cho phép",
      note: "Vượt maxSelect: A8≤2, B2≤2, D2≤2, G1≤3, G3≤2, G5≤2.",
      match(rec) {
        return overLimitHits(answersOf(rec)).length > 0;
      },
      headers: ["Mã phiếu", "Câu vi phạm", "Số mục đã chọn", "Giới hạn", "Đối chiếu phiếu gốc (điền)"],
      rows(rec) {
        return overLimitHits(answersOf(rec)).map((h) => [codeOf(rec), h.qid, h.n, h.max, ""]);
      },
    },
    {
      id: "Y6",
      title: "Đáp án độc quyền đi kèm đáp án khác",
      note: "C6 có 8 kèm mã khác; D5 có 5 kèm mã khác; hoặc D5 vừa nhóm Có (1,2) vừa Không (3,4).",
      match(rec) {
        return exclusiveHits(answersOf(rec)).length > 0;
      },
      headers: ["Mã phiếu", "Câu", "Đáp án đã chọn", "Đối chiếu phiếu gốc (điền)"],
      rows(rec) {
        return exclusiveHits(answersOf(rec)).map((h) => [codeOf(rec), h.qid, h.labels, ""]);
      },
    },
    {
      id: "Y7",
      title: "Mâu thuẫn nhất quán đã bị gắn cờ khi nhập (R1–R9)",
      note: "Phiếu có flags chứa các mã R1…R9 từ kiểm tra nhất quán lúc nhập.",
      match(rec) {
        return flagList(rec).some((f) => /^R[1-9]$/.test(f));
      },
      headers: ["Mã phiếu", "Mã cờ", "Diễn giải", "Người nhập", "Đối chiếu phiếu gốc (điền)"],
      rows(rec) {
        return flagList(rec)
          .filter((f) => /^R[1-9]$/.test(f))
          .map((f) => [codeOf(rec), f, FLAG_DESC[f] || "", rec.entered_by || "", ""]);
      },
    },
  ];

  function overLimitHits(a) {
    const checks = [
      ["A8", 2],
      ["B2", 2],
      ["D2", 2],
      ["G1", 3],
      ["G3", 2],
      ["G5", 2],
    ];
    const out = [];
    checks.forEach(([qid, max]) => {
      const n = arr(a[qid]).length;
      if (n > max) out.push({ qid, n, max });
    });
    return out;
  }

  function exclusiveHits(a) {
    const out = [];
    const c6 = arr(a.C6);
    if (c6.includes(8) && c6.some((c) => c !== 8)) {
      out.push({ qid: "C6", labels: fmtMulti("C6", c6) });
    }
    const d5 = arr(a.D5);
    if (d5.includes(5) && d5.some((c) => c !== 5)) {
      out.push({ qid: "D5", labels: fmtMulti("D5", d5) });
    }
    const hasYes = d5.some((c) => c === 1 || c === 2);
    const hasNo = d5.some((c) => c === 3 || c === 4);
    if (hasYes && hasNo) {
      out.push({ qid: "D5", labels: fmtMulti("D5", d5) + " [Có + Không]" });
    }
    return out;
  }

  function collectViolations(records, rule) {
    const matched = records.filter((r) => rule.match(r)).sort((a, b) => seqOf(a) - seqOf(b));
    const rows = [];
    matched.forEach((rec) => {
      if (typeof rule.rows === "function") {
        rule.rows(rec).forEach((row) => rows.push(row));
      } else {
        rows.push(rule.row(rec));
      }
    });
    return { matched, rows, count: matched.length };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function fileStamp(d) {
    d = d || new Date();
    return pad2(d.getDate()) + "-" + pad2(d.getMonth() + 1) + "-" + d.getFullYear();
  }
  function timeStamp(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + " " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function tryStyle(cell, style) {
    try {
      cell.s = style;
    } catch (e) {
      /* community build may ignore */
    }
  }

  function setCell(ws, addr, value, style) {
    const cell = { v: value == null ? "" : value, t: typeof value === "number" ? "n" : "s" };
    if (style) tryStyle(cell, style);
    ws[addr] = cell;
  }

  function colLetter(i) {
    let n = i;
    let s = "";
    while (n >= 0) {
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  function sheetFromRule(XLSX, rule, result) {
    const ws = {};
    const headers = rule.headers;
    const lastCol = colLetter(headers.length - 1);
    setCell(ws, "A1", rule.title, { font: { bold: true, sz: 12 } });
    setCell(ws, "A2", rule.note, { font: { italic: true, color: { rgb: GRAY }, sz: 10 } });

    const headStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
      fill: { patternType: "solid", fgColor: { rgb: NAVY } },
      alignment: { wrapText: true, horizontal: "center", vertical: "center" },
    };
    headers.forEach((h, i) => {
      setCell(ws, colLetter(i) + "4", h, headStyle);
    });

    const yellowStyle = { fill: { patternType: "solid", fgColor: { rgb: YELLOW } } };
    let r = 5;
    if (!result.rows.length) {
      setCell(ws, "A5", "Không có phiếu vi phạm");
      r = 5;
    } else {
      result.rows.forEach((row) => {
        row.forEach((val, i) => {
          const isLast = i === headers.length - 1;
          setCell(ws, colLetter(i) + r, val, isLast ? yellowStyle : undefined);
        });
        r++;
      });
      r = 4 + result.rows.length;
    }

    ws["!ref"] = "A1:" + lastCol + Math.max(r, 5);
    ws["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
    ws["!autofilter"] = { ref: "A4:" + lastCol + Math.max(r, 5) };
    ws["!cols"] = headers.map((h, i) => {
      if (i === headers.length - 1) return { wch: 28 };
      if (String(h).length > 24) return { wch: 22 };
      return { wch: Math.min(28, Math.max(12, String(h).length + 2)) };
    });
    return ws;
  }

  function buildWorkbook(records) {
    if (typeof XLSX === "undefined") throw new Error("Thư viện SheetJS (XLSX) chưa sẵn sàng");
    const active = (records || []).filter((r) => !r.deleted && Number(r.deleted) !== 1);
    const wb = XLSX.utils.book_new();
    const now = new Date();
    const ruleResults = REVIEW_RULES.map((rule) => {
      const res = collectViolations(active, rule);
      return { rule, res, sheetName: rule.id + "_" + res.count };
    });

    /* Tong_hop */
    const sum = {};
    setCell(sum, "A1", "Danh sách phiếu cần rà soát – " + active.length + " phiếu", {
      font: { bold: true, sz: 14 },
    });
    const sumHead = ["Ý", "Tiêu chí lọc", "Sheet", "Số phiếu"];
    const headStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: NAVY } },
    };
    sumHead.forEach((h, i) => setCell(sum, colLetter(i) + "2", h, headStyle));
    ruleResults.forEach((rr, idx) => {
      const row = idx + 3;
      setCell(sum, "A" + row, rr.rule.id);
      setCell(sum, "B" + row, rr.rule.title);
      setCell(sum, "C" + row, rr.sheetName);
      setCell(sum, "D" + row, rr.res.count);
    });
    const noteRow = 3 + ruleResults.length;
    setCell(
      sum,
      "A" + noteRow,
      "Nguồn: dữ liệu app khảo sát, xuất lúc " + timeStamp(now) + ". Cột vàng ở mỗi sheet để ghi kết quả đối chiếu phiếu gốc.",
      { font: { italic: true, sz: 10 } }
    );
    sum["!ref"] = "A1:D" + noteRow;
    sum["!cols"] = [{ wch: 8 }, { wch: 70 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, sum, "Tong_hop");

    ruleResults.forEach((rr) => {
      const ws = sheetFromRule(XLSX, rr.rule, rr.res);
      let name = rr.sheetName;
      if (name.length > 31) name = name.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });

    return wb;
  }

  function downloadWorkbook(wb, filename) {
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (typeof saveAs === "function") saveAs(blob, filename);
    else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  async function exportReviewXlsx() {
    const all = await Api.api("exportAll", {});
    const rows = Array.isArray(all) ? all : all.rows || [];
    const wb = buildWorkbook(rows);
    downloadWorkbook(wb, "Danh_sach_ra_soat_" + fileStamp() + ".xlsx");
    return wb;
  }

  /* —— Self-test (console) —— */
  function fake(partial) {
    return Object.assign(
      {
        form_code: "PKG-TEST",
        seq: 1,
        deleted: 0,
        entered_by: "tester",
        answers: {},
        flags: "",
      },
      partial,
      { answers: Object.assign({}, (partial && partial.answers) || {}) }
    );
  }

  function selfTest() {
    const cases = [];
    function assert(name, cond) {
      cases.push({ name, ok: !!cond });
      if (!cond) console.error("FAIL", name);
    }

    const y1 = REVIEW_RULES.find((r) => r.id === "Y1");
    assert(
      "Y1 hit",
      y1.match(fake({ answers: { A6: 1, DB1: 3, DB2: "", DB3: 2, DB4: 1, DB5: 4 } }))
    );
    assert("Y1 miss filled", !y1.match(fake({ answers: { A6: 1, DB1: 1, DB2: 2, DB3: 3, DB4: 4, DB5: 5 } })));
    assert("Y1 miss A6=0", !y1.match(fake({ answers: { A6: 0, DB1: "" } })));

    const y1b = REVIEW_RULES.find((r) => r.id === "Y1b");
    assert("Y1b C6_5", y1b.match(fake({ answers: { A6: 0, C6: [5] } })));
    assert("Y1b D2_2", y1b.match(fake({ answers: { A6: 0, D2: [2] } })));
    assert("Y1b DB", y1b.match(fake({ answers: { A6: 0, DB1: 4 } })));
    assert("Y1b miss", !y1b.match(fake({ answers: { A6: 0, C6: [1], D2: [1] } })));

    const y2 = REVIEW_RULES.find((r) => r.id === "Y2");
    assert("Y2 D3", y2.match(fake({ answers: { D1: 1, D3: 2 } })));
    assert("Y2 D5 other", y2.match(fake({ answers: { D1: 1, D5: [1] } })));
    assert("Y2 miss only D5=5", !y2.match(fake({ answers: { D1: 1, D5: [5] } })));

    const y2b = REVIEW_RULES.find((r) => r.id === "Y2b");
    assert("Y2b C6_2", y2b.match(fake({ answers: { D1: 1, C6: [2] } })));
    assert("Y2b miss", !y2b.match(fake({ answers: { D1: 1, C6: [1] } })));

    const y3 = REVIEW_RULES.find((r) => r.id === "Y3");
    assert("Y3 hit", y3.match(fake({ answers: { B2: [6, 1] } })));
    assert("Y3 miss only 6", !y3.match(fake({ answers: { B2: [6] } })));

    const y3b = REVIEW_RULES.find((r) => r.id === "Y3b");
    assert(
      "Y3b hit",
      y3b.match(
        fake({
          answers: { B2: [6], B1_1: 1, B1_2: 2, B1_3: 4, B1_4: 5, B1_5: 1, B1_6: 3, B1_7: 3 },
        })
      )
    );
    assert(
      "Y3b miss <5",
      !y3b.match(fake({ answers: { B2: [6], B1_1: 1, B1_2: 3, B1_3: 3, B1_4: 3, B1_5: 3, B1_6: 3, B1_7: 3 } }))
    );

    const y4 = REVIEW_RULES.find((r) => r.id === "Y4");
    assert("Y4 hit", y4.match(fake({ answers: { A2: 1, B2: [1] } })));
    assert("Y4 miss A2=3", !y4.match(fake({ answers: { A2: 3, B2: [1] } })));

    const y5 = REVIEW_RULES.find((r) => r.id === "Y5");
    assert("Y5 A8", y5.match(fake({ answers: { A8: [1, 2, 3] } })));
    assert("Y5 miss", !y5.match(fake({ answers: { A8: [1, 2] } })));

    const y6 = REVIEW_RULES.find((r) => r.id === "Y6");
    assert("Y6 C6", y6.match(fake({ answers: { C6: [8, 1] } })));
    assert("Y6 D5 mix", y6.match(fake({ answers: { D5: [1, 3] } })));
    assert("Y6 miss", !y6.match(fake({ answers: { C6: [8] } })));

    const y7 = REVIEW_RULES.find((r) => r.id === "Y7");
    assert("Y7 hit", y7.match(fake({ flags: "R1;speeder" })));
    assert("Y7 miss", !y7.match(fake({ flags: "speeder" })));

    const sample = [
      fake({ form_code: "PKG-0001", seq: 1, answers: { A6: 2, DB1: 1 }, flags: "" }),
      fake({ form_code: "PKG-0002", seq: 2, answers: { A6: 1 }, flags: "R1" }),
    ];
    sample[1].answers.DB1 = undefined;
    const wb = buildWorkbook(sample);
    assert("workbook sheets", wb.SheetNames.length === 1 + REVIEW_RULES.length);
    assert("has Tong_hop", wb.SheetNames[0] === "Tong_hop");

    const passed = cases.filter((c) => c.ok).length;
    console.log("Review.selfTest: " + passed + "/" + cases.length + " passed");
    return { passed, total: cases.length, cases };
  }

  return {
    REVIEW_RULES,
    exportReviewXlsx,
    buildWorkbook,
    selfTest,
    collectViolations,
  };
})();
window.Review = Review;
