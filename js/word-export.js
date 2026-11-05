/* Tạo file Word (.docx) cho phiếu khảo sát */
const WordExport = (function () {
  function checked(on) {
    return on ? "☒" : "☐";
  }

  function displayName(rec) {
    if (rec.display_name) return rec.display_name;
    const n = rec.seq_num != null ? rec.seq_num : rec.seq || 0;
    const pad = String(n).length <= 3 ? String(n).padStart(3, "0") : String(n);
    return "Phiếu số " + pad;
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + " ngày " + p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function optionLabel(qid, code) {
    const q = SURVEY.questions[qid];
    if (!q || !q.options) return String(code);
    const o = q.options.find((x) => x.code === code);
    return o ? o.label : String(code);
  }

  function buildChildren(rec) {
    const docx = window.docx;
    const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel } = docx;
    const a = rec.answers || {};
    const children = [];

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: SURVEY.meta.title, bold: true, size: 24, font: "Times New Roman" })],
      })
    );
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: displayName(rec) + " – Mã " + (rec.form_code || "") + " – Gửi lúc " + fmtTime(rec.server_time),
            bold: true,
            size: 22,
            font: "Times New Roman",
          }),
        ],
      })
    );

    SURVEY.pages.forEach((page) => {
      if (page.id === "intro") return;
      const visible = Logic.isPageVisible(page, a);
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: page.partLabel + " – " + page.title, bold: true, size: 24, font: "Times New Roman" })],
        })
      );
      if (!visible) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "(Không áp dụng – bỏ qua theo điều kiện của phiếu)",
                italics: true,
                size: 22,
                font: "Times New Roman",
              }),
            ],
          })
        );
        return;
      }

      page.questions.forEach((qid) => {
        const q = SURVEY.questions[qid];
        if (!q) return;
        if (q.type === "likert_group") {
          if (!Logic.isQuestionVisible(q, a)) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: q.label + " — (Không áp dụng – bỏ qua theo điều kiện của phiếu)", italics: true, size: 22, font: "Times New Roman" })],
              })
            );
            return;
          }
          children.push(
            new Paragraph({
              spacing: { before: 120 },
              children: [new TextRun({ text: q.label, bold: true, size: 22, font: "Times New Roman" })],
            })
          );
          const items = Logic.getLikertItems(q);
          const header = new TableRow({
            children: ["Mã", "Nội dung", "1", "2", "3", "4", "5"].map(
              (t) =>
                new TableCell({
                  width: { size: t === "Nội dung" ? 4500 : t === "Mã" ? 900 : 700, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, font: "Times New Roman" })] })],
                })
            ),
          });
          const rows = items.map((it) => {
            const val = a[it.id];
            return new TableRow({
              children: [it.display || it.id, it.label, 1, 2, 3, 4, 5].map((cell, idx) => {
                let text = String(cell);
                if (idx >= 2) text = checked(val === cell);
                return new TableCell({
                  width: { size: idx === 1 ? 4500 : idx === 0 ? 900 : 700, type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: text,
                          bold: idx >= 2 && val === cell,
                          size: 20,
                          font: "Times New Roman",
                        }),
                      ],
                    }),
                  ],
                });
              }),
            });
          });
          children.push(new Table({ rows: [header].concat(rows), width: { size: 9000, type: WidthType.DXA } }));
          return;
        }

        if (!Logic.isQuestionVisible(q, a) && !(qid === "D5" && a.D1 === 1)) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: q.label + " — (Không áp dụng – bỏ qua theo điều kiện của phiếu)", italics: true, size: 22, font: "Times New Roman" })],
            })
          );
          return;
        }

        children.push(
          new Paragraph({
            spacing: { before: 120 },
            children: [new TextRun({ text: (q.id || "") + ". " + q.label, bold: true, size: 22, font: "Times New Roman" })],
          })
        );

        if (q.type === "single" || q.type === "likert") {
          const opts = q.type === "likert" ? [1, 2, 3, 4, 5].map((c) => ({ code: c, label: String(c) })) : q.options || [];
          opts.forEach((o) => {
            const on = a[q.id] === o.code;
            children.push(
              new Paragraph({
                children: [new TextRun({ text: checked(on) + " " + o.label, bold: on, size: 22, font: "Times New Roman" })],
              })
            );
          });
        } else if (q.type === "multi") {
          const sel = Array.isArray(a[q.id]) ? a[q.id] : [];
          (q.options || []).forEach((o) => {
            if (o.showIf && !Logic.isOptionVisible(o, a)) return;
            const on = sel.includes(o.code);
            children.push(
              new Paragraph({
                children: [new TextRun({ text: checked(on) + " " + o.label, bold: on, size: 22, font: "Times New Roman" })],
              })
            );
          });
          if (q.other && sel.includes(q.other.code)) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: "Ghi rõ: " + (a[q.other.id] || ""), size: 22, font: "Times New Roman" })],
              })
            );
          }
        } else if (q.type === "text") {
          const t = (a[q.id] || "").trim();
          children.push(
            new Paragraph({
              children: [new TextRun({ text: t || "(Không trả lời)", italics: !t, size: 22, font: "Times New Roman" })],
            })
          );
        } else if (q.type === "consent") {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: checked(a.consent === 1) + " " + q.label, bold: a.consent === 1, size: 22, font: "Times New Roman" })],
            })
          );
        }
      });
    });

    return children;
  }

  async function buildBlob(rec) {
    const docx = window.docx;
    if (!docx) throw new Error("Thư viện docx chưa sẵn sàng");
    const { Document, Packer, Footer, Paragraph, TextRun, AlignmentType, PageNumber } = docx;
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }, // ~2cm
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Trang ", font: "Times New Roman", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: "Times New Roman", size: 18 })],
                }),
              ],
            }),
          },
          children: buildChildren(rec),
        },
      ],
    });
    return Packer.toBlob(doc);
  }

  function fileName(rec) {
    const d = new Date(rec.server_time || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    const date = p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear();
    const name = displayName(rec).replace(/\s+/g, "_");
    return name + "_" + (rec.form_code || "PKS") + "_" + date + ".docx";
  }

  async function downloadOne(rec) {
    const blob = await buildBlob(rec);
    saveAs(blob, fileName(rec));
  }

  async function downloadMany(recs, onProgress, signal) {
    if (!window.JSZip) throw new Error("JSZip chưa sẵn sàng");
    const zip = new JSZip();
    for (let i = 0; i < recs.length; i++) {
      if (signal && signal.aborted) throw new Error("Đã hủy");
      const blob = await buildBlob(recs[i]);
      zip.file(fileName(recs[i]), blob);
      if (onProgress) onProgress(i + 1, recs.length);
    }
    const out = await zip.generateAsync({ type: "blob" });
    const first = displayName(recs[0]).replace(/\D/g, "") || "001";
    const last = displayName(recs[recs.length - 1]).replace(/\D/g, "") || first;
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const date = p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear();
    saveAs(out, "Phieu_so_" + first + "-" + last + "_" + date + ".zip");
  }

  return { downloadOne, downloadMany, displayName, fileName, buildBlob };
})();
