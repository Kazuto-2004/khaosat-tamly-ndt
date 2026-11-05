/* Xuất phiếu ra Word (.docx) dựa trên đúng khuôn phiếu gốc: template/phieu_mau.docx
 * Ô được chọn: ☐ → ☒, tô nền xanh nhạt cả dòng đáp án (hoặc ô mức Likert được chọn).
 * Cần JSZip (đã nạp từ cdnjs) và FileSaver (saveAs).
 */
const WordExport = (function () {
  const TEMPLATE_URL = "template/phieu_mau.docx";
  const SEL_FILL = "D9E2F3";   // nền ô được chọn
  const SEL_COLOR = "1F3864";  // màu dấu ☒
  let templateBuf = null;

  /* ---------- Thứ tự 674 ô ☐ trong khuôn, khớp đúng phiếu gốc ---------- */
  function buildBoxMap() {
    const map = [];
    const single = (id, n, start = 1) => { for (let i = 0; i < n; i++) map.push({ id, code: start + i, multi: false }); };
    const multi = (id, n) => { for (let i = 0; i < n; i++) map.push({ id, code: 1 + i, multi: true }); };
    const likert = (id) => single(id, 5);
    const range = (prefix, from, to) => { for (let i = from; i <= to; i++) likert(prefix + i); };

    // Phần A
    single("A1", 4); single("A2", 5); single("A3", 5); single("A4", 4); single("A5", 4);
    single("A6", 5, 0); single("A7", 4); multi("A8", 7); single("A9", 3); single("A10", 3);
    single("A11", 4); single("A12", 2);
    // Phần B
    range("B1_", 1, 7); multi("B2", 6);
    // Phần C
    range("TL", 1, 15); range("TC", 1, 9); range("HT", 1, 11);
    range("MS", 1, 4); range("FSIS", 1, 4); range("SI", 1, 4); range("DB", 1, 5);
    multi("C6", 8);
    // Phần D
    single("D1", 4); multi("D2", 6); single("D3", 6); likert("D4"); multi("D5", 5); single("D6", 5);
    // Phần E
    range("VM", 1, 10); single("E2", 5);
    // Phần F
    single("F1", 4); range("KT", 1, 6); range("TD", 1, 5);
    // Phần G
    multi("G1", 8); likert("G2"); range("NEO", 1, 3); multi("G3", 6); range("SS", 1, 5); multi("G5", 6);
    // Phần H
    range("GP", 1, 21);
    return map;
  }
  const BOX_MAP = buildBoxMap();

  /* ---------- Tiện ích ---------- */
  const pad = (n, w) => String(n).padStart(w, "0");

  function displayName(rec) {
    if (rec.display_name) return rec.display_name;
    const n = rec.seq != null ? rec.seq : rec.seq_num || 0;
    return "Phiếu số " + (String(n).length <= 3 ? pad(n, 3) : String(n));
  }

  function fmtDate(v) {
    if (!v) return "";
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : s;
  }

  function fmtDateTime(v) {
    if (!v) return "";
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? m[4] + ":" + m[5] + " ngày " + m[3] + "/" + m[2] + "/" + m[1] : String(v);
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Văn bản nhiều dòng → các run có xuống dòng */
  function multiline(t) {
    return esc(t).split(/\r?\n/).join('</w:t><w:br/><w:t xml:space="preserve">');
  }

  function isSelected(answers, box) {
    const v = answers[box.id];
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.map(Number).indexOf(box.code) !== -1;
    if (typeof v === "string" && v.indexOf(";") !== -1) return v.split(";").map(Number).indexOf(box.code) !== -1;
    return Number(v) === box.code;
  }

  /* Đặt màu nền cho <w:tc> chứa vị trí pos (thay shd sẵn có hoặc chèn mới) */
  function shadeCell(xml, pos) {
    const a = Math.max(xml.lastIndexOf("<w:tc>", pos), xml.lastIndexOf("<w:tc ", pos));
    if (a < 0) return xml;
    const prA = xml.indexOf("<w:tcPr>", a);
    const prB = xml.indexOf("</w:tcPr>", a);
    const firstP = xml.indexOf("<w:p", a);
    if (prA < 0 || prB < 0 || prA > firstP) return xml;
    let pr = xml.slice(prA, prB);
    const shd = '<w:shd w:val="clear" w:color="auto" w:fill="' + SEL_FILL + '"/>';
    if (/<w:shd [^>]*\/>/.test(pr)) {
      pr = pr.replace(/<w:shd [^>]*\/>/, shd);
    } else {
      const before = pr.search(/<w:(noWrap|tcMar|textDirection|tcFitText|vAlign|hideMark)[ >\/]/);
      pr = before >= 0 ? pr.slice(0, before) + shd + pr.slice(before) : pr + shd;
    }
    return xml.slice(0, prA) + pr + xml.slice(prB);
  }

  /* Tô màu chính dấu ☒ (đổi màu run chứa ô) */
  function colorRun(xml, pos) {
    const a = Math.max(xml.lastIndexOf("<w:r>", pos), xml.lastIndexOf("<w:r ", pos));
    const prA = xml.indexOf("<w:rPr>", a);
    const prB = xml.indexOf("</w:rPr>", a);
    if (a < 0 || prA < 0 || prB < 0 || prB > pos) return xml;
    let pr = xml.slice(prA, prB);
    const color = '<w:color w:val="' + SEL_COLOR + '"/>';
    pr = /<w:color [^>]*\/>/.test(pr) ? pr.replace(/<w:color [^>]*\/>/, color) : pr;
    return xml.slice(0, prA) + pr + xml.slice(prB);
  }

  function fillXml(xml, rec) {
    const ans = rec.answers || {};

    // 1) Ô chọn – xử lý từ cuối lên để vị trí phía trước không bị lệch
    const boxes = [];
    for (let i = xml.indexOf("☐"); i !== -1; i = xml.indexOf("☐", i + 1)) boxes.push(i);
    if (boxes.length !== BOX_MAP.length) {
      throw new Error("Khuôn phiếu không khớp (" + boxes.length + "/" + BOX_MAP.length + " ô)");
    }
    for (let n = boxes.length - 1; n >= 0; n--) {
      const box = BOX_MAP[n];
      if (!isSelected(ans, box)) continue;
      const pos = boxes[n];
      xml = xml.slice(0, pos) + "☒" + xml.slice(pos + 1);

      // dòng đáp án (1 ô/dòng) → tô cả dòng; dòng Likert (5 ô) → tô đúng ô được chọn
      const trA = Math.max(xml.lastIndexOf("<w:tr>", pos), xml.lastIndexOf("<w:tr ", pos));
      const trB = xml.indexOf("</w:tr>", pos);
      const rowText = trA >= 0 && trB > 0 ? xml.slice(trA, trB) : "";
      const boxesInRow = (rowText.match(/[☐☒]/g) || []).length;

      xml = colorRun(xml, pos);
      if (boxesInRow === 1) {
        // tô mọi ô trong dòng, từ cuối lên
        const cells = [];
        const tB = xml.indexOf("</w:tr>", pos);
        const re = /<w:tc[ >]/g;
        re.lastIndex = trA;
        for (let m = re.exec(xml); m && m.index < tB; m = re.exec(xml)) cells.push(m.index + 6);
        for (let k = cells.length - 1; k >= 0; k--) xml = shadeCell(xml, cells[k]);
      } else {
        xml = shadeCell(xml, pos);
      }
    }

    // 2) Dòng thông tin phiếu
    const info = [
      displayName(rec),
      rec.form_code ? "Mã " + rec.form_code : "",
      rec.paper_date ? "Ngày thu phiếu: " + fmtDate(rec.paper_date) : "",
      rec.entered_by ? "Người nhập: " + rec.entered_by : "",
    ].filter(Boolean).join(" – ");
    xml = xml.replace("{{INFO}}", esc(info));

    // 3) G5 – Khác
    const g5o = String(ans.G5_other || "").trim();
    xml = xml.replace("{{G5_OTHER}}", g5o ? esc(g5o) : "____________________");

    // 4) Câu hỏi mở
    const DOTS = "................................................................................................................................................";
    ["I1", "I2", "I3", "I4"].forEach((q) => {
      const t = String(ans[q] || "").trim();
      xml = xml.replace("{{" + q + "}}", t ? multiline(t) : DOTS);
      [2, 3].forEach((l) => {
        const ph = "{{" + q + "_L" + l + "}}";
        if (t) {
          // xóa cả đoạn chứa dòng chấm thừa
          const p = xml.indexOf(ph);
          if (p !== -1) {
            const a = Math.max(xml.lastIndexOf("<w:p ", p), xml.lastIndexOf("<w:p>", p));
            const b = xml.indexOf("</w:p>", p) + 6;
            xml = xml.slice(0, a) + xml.slice(b);
          }
        } else {
          xml = xml.replace(ph, DOTS);
        }
      });
    });
    return xml;
  }

  /* ---------- Đọc khuôn ---------- */
  async function loadTemplate() {
    if (templateBuf) return templateBuf;
    const res = await fetch(TEMPLATE_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error("Không tải được khuôn phiếu (" + TEMPLATE_URL + ")");
    templateBuf = await res.arrayBuffer();
    return templateBuf;
  }

  async function filledZip(rec) {
    if (!window.JSZip) throw new Error("JSZip chưa sẵn sàng");
    const zip = await JSZip.loadAsync(await loadTemplate());
    const xml = await zip.file("word/document.xml").async("string");
    zip.file("word/document.xml", fillXml(xml, rec));
    return zip;
  }

  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  async function buildBlob(rec) {
    const zip = await filledZip(rec);
    return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
  }

  /* Gộp nhiều phiếu vào 1 file Word, mỗi phiếu sang trang mới */
  async function buildMergedBlob(recs, onProgress, signal) {
    if (!window.JSZip) throw new Error("JSZip chưa sẵn sàng");
    const base = await JSZip.loadAsync(await loadTemplate());
    const tplXml = await base.file("word/document.xml").async("string");
    const bodyStart = tplXml.indexOf("<w:body>") + 8;
    const sectAt = tplXml.lastIndexOf("<w:sectPr");
    const head = tplXml.slice(0, bodyStart);
    const tail = tplXml.slice(sectAt);
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const parts = [];
    for (let i = 0; i < recs.length; i++) {
      if (signal && signal.aborted) throw new Error("Đã hủy");
      const filled = fillXml(tplXml, recs[i]);
      parts.push(filled.slice(filled.indexOf("<w:body>") + 8, filled.lastIndexOf("<w:sectPr")));
      if (onProgress) onProgress(i + 1, recs.length);
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0)); // nhường luồng cho thanh tiến độ
    }
    base.file("word/document.xml", head + parts.join(pageBreak) + tail);
    return base.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
  }

  function dateStamp(v) {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + "-" + m[2] + "-" + m[1];
    const d = new Date();
    return pad(d.getDate(), 2) + "-" + pad(d.getMonth() + 1, 2) + "-" + d.getFullYear();
  }

  function ascii(t) {
    return String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  }

  function fileName(rec) {
    return ascii(displayName(rec)).replace(/\s+/g, "_") + "_" + (rec.form_code || "PKS") + "_" + dateStamp(rec.server_time) + ".docx";
  }

  function rangeName(recs, ext) {
    const first = displayName(recs[0]).replace(/\D/g, "") || "001";
    const last = displayName(recs[recs.length - 1]).replace(/\D/g, "") || first;
    return "Phieu_so_" + first + "-" + last + "_" + dateStamp() + ext;
  }

  async function downloadOne(rec) {
    saveAs(await buildBlob(rec), fileName(rec));
  }

  async function downloadMany(recs, onProgress, signal) {
    if (!recs.length) throw new Error("Không có phiếu nào để tải");
    const zip = new JSZip();
    for (let i = 0; i < recs.length; i++) {
      if (signal && signal.aborted) throw new Error("Đã hủy");
      zip.file(fileName(recs[i]), await buildBlob(recs[i]));
      if (onProgress) onProgress(i + 1, recs.length);
    }
    saveAs(await zip.generateAsync({ type: "blob" }), rangeName(recs, ".zip"));
  }

  async function downloadMerged(recs, onProgress, signal) {
    if (!recs.length) throw new Error("Không có phiếu nào để tải");
    saveAs(await buildMergedBlob(recs, onProgress, signal), rangeName(recs, ".docx"));
  }

  return { downloadOne, downloadMany, downloadMerged, displayName, fileName, buildBlob, buildMergedBlob, fillXml, BOX_MAP };
})();
if (typeof window !== "undefined") window.WordExport = WordExport;
if (typeof module !== "undefined") module.exports = WordExport;
