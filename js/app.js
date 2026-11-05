/* Render phiếu, điều hướng, gửi phiếu – nối Google Apps Script */
const STEP_META = [
  { key: "A", label: "Thông tin", pageIds: ["intro", "A"] },
  { key: "B", label: "Thay đổi", pageIds: ["B"] },
  { key: "C", label: "Tâm lý", pageIds: ["C1", "C2", "C3", "C4", "C5"] },
  { key: "D", label: "Sụp đổ", pageIds: ["D"] },
  { key: "E", label: "Vĩ mô", pageIds: ["E"] },
  { key: "F", label: "MXH", pageIds: ["F"] },
  { key: "G", label: "Đánh giá", pageIds: ["G"] },
  { key: "H", label: "Giải pháp", pageIds: ["H"] },
  { key: "I", label: "Câu hỏi mở", pageIds: ["I"] },
];

const App = (function () {
  let answers = {};
  let pageIndex = 0;
  let startTime = null;
  let pageEnterAt = null;
  let pageTimes = {};
  let respondentId = null;
  let flagInconsistent = [];
  let screenedOut = false;
  let finished = false;
  let mode = "paper"; // paper | public | edit | view
  let editFormCode = null;
  let editReason = "";
  let paperCollectedAt = "";
  let expectedUpdatedAt = "";
  let clientUuid = null;
  let lastFormCode = null;
  let lastDisplayName = null;
  let viewingRec = null;
  let viewAll = false;
  let publicMode = false;
  let nextPreviewSeq = 1;
  let saving = false;
  let keepPaperDate = "";

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  function storageGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function storageSet(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function toast(msg, action) {
    const host = document.getElementById("toast-host");
    if (!host) return;
    const n = el("div", "toast");
    n.innerHTML = "<span>" + escapeHtml(msg) + "</span>";
    if (action) {
      const b = el("button", "toast-action", action.label);
      b.type = "button";
      b.addEventListener("click", () => {
        action.onClick();
        n.remove();
      });
      n.appendChild(b);
    }
    host.appendChild(n);
    setTimeout(() => n.remove(), action ? 10000 : 4000);
  }
  function vnIso(d) {
    const date = d instanceof Date ? d : new Date(d);
    return new Date(date.getTime() + 7 * 60000).toISOString().replace("Z", "+07:00");
  }
  function displayNameFromSeq(n) {
    const s = String(n);
    return "Phiếu số " + (s.length <= 3 ? s.padStart(3, "0") : s);
  }
  function isPublicMode() {
    return publicMode;
  }
  function isReadonly() {
    return mode === "view";
  }

  function pages() {
    return Logic.visiblePages(answers);
  }
  function currentPage() {
    return pages()[pageIndex];
  }

  function saveProgress() {
    /* không lưu bản nháp phiếu vào localStorage – chỉ hàng chờ offline */
  }

  function setAnswer(id, value) {
    if (isReadonly()) return;
    answers[id] = value;
    answers = Logic.clearDependentAnswers(answers);
    render();
  }
  function toggleMulti(qid, code) {
    if (isReadonly()) return;
    const q = SURVEY.questions[qid];
    let sel = Array.isArray(answers[qid]) ? answers[qid].slice() : [];
    const idx = sel.indexOf(code);
    if (idx >= 0) sel.splice(idx, 1);
    else sel.push(code);
    sel = Logic.applyMultiConstraints(qid, sel, answers);
    answers[qid] = sel;
    if (q.other && !sel.includes(q.other.code)) delete answers[q.other.id];
    answers = Logic.clearDependentAnswers(answers);
    saveProgress();
    render();
    if (q.other && sel.includes(q.other.code)) {
      const input = document.getElementById(q.other.id);
      if (input) input.focus();
    }
  }

  function showDialog(message, buttons) {
    return new Promise((resolve) => {
      const host = document.getElementById("modal-host");
      const overlay = el("div", "dialog-overlay");
      const box = el("div", "dialog");
      box.innerHTML = "<p>" + escapeHtml(message) + "</p>";
      const actions = el("div", "dialog-actions");
      (buttons || [
        { label: "Sửa lại", value: "fix", className: "btn outline" },
        { label: "Giữ nguyên", value: "keep", className: "btn primary" },
      ]).forEach((btn) => {
        const b = el("button", btn.className || "btn primary", btn.label);
        b.type = "button";
        b.addEventListener("click", () => {
          overlay.remove();
          resolve(btn.value);
        });
        actions.appendChild(b);
      });
      box.appendChild(actions);
      overlay.appendChild(box);
      host.appendChild(overlay);
    });
  }

  function showFormDialog(title, fields, confirmLabel) {
    return new Promise((resolve) => {
      const host = document.getElementById("modal-host");
      const overlay = el("div", "dialog-overlay");
      const box = el("div", "dialog");
      box.appendChild(el("h3", "", escapeHtml(title)));
      const form = el("div", "dialog-form");
      const refs = {};
      fields.forEach((f) => {
        const wrap = el("div", "field");
        const lab = el("label", "", escapeHtml(f.label));
        let input;
        if (f.type === "select") {
          input = document.createElement("select");
          (f.options || []).forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label;
            input.appendChild(opt);
          });
        } else if (f.type === "textarea") {
          input = document.createElement("textarea");
          input.rows = 3;
        } else {
          input = document.createElement("input");
          input.type = f.type || "text";
          if (f.value != null) input.value = f.value;
        }
        input.id = "f_" + f.id;
        refs[f.id] = input;
        wrap.appendChild(lab);
        wrap.appendChild(input);
        form.appendChild(wrap);
      });
      box.appendChild(form);
      const actions = el("div", "dialog-actions");
      const cancel = el("button", "btn outline", "Hủy");
      const ok = el("button", "btn primary", confirmLabel || "Xác nhận");
      cancel.type = "button";
      ok.type = "button";
      cancel.addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
      ok.addEventListener("click", () => {
        const out = {};
        for (const f of fields) {
          const v = (refs[f.id].value || "").trim();
          if (f.required && !v) {
            refs[f.id].focus();
            return;
          }
          out[f.id] = v;
        }
        overlay.remove();
        resolve(out);
      });
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(actions);
      overlay.appendChild(box);
      host.appendChild(overlay);
    });
  }

  function renderIntroExtras(root) {
    const box = el("div", "intro-card");
    box.innerHTML =
      "<h1>" +
      escapeHtml(SURVEY.meta.title) +
      "</h1>" +
      '<div class="info-pills">' +
      "<div class=\"info-pill\">⏱ 10–12 phút</div>" +
      "<div class=\"info-pill\">🔒 Ẩn danh, bảo mật</div>" +
      "<div class=\"info-pill\">🎓 Phục vụ NCKH</div>" +
      "</div>" +
      "<p class=\"page-lead\">" +
      escapeHtml(SURVEY.meta.purpose) +
      "</p>";
    root.appendChild(box);
  }

  function renderOtherInput(q) {
    const wrap = el("div", "other-wrap");
    const lab = el("label", "", escapeHtml(q.other.label || "Vui lòng ghi rõ"));
    lab.htmlFor = q.other.id;
    const input = document.createElement("input");
    input.type = "text";
    input.id = q.other.id;
    input.placeholder = q.other.placeholder || "Nhập nội dung…";
    input.value = answers[q.other.id] || "";
    input.disabled = isReadonly();
    input.addEventListener("input", () => {
      answers[q.other.id] = input.value;
      saveProgress();
    });
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function renderQuestion(q, root) {
    if (!Logic.isQuestionVisible(q, answers)) return;
    const wrap = el("section", "q-block");
    wrap.id = "q-" + q.id;

    if (q.type === "consent") {
      const lab = el("label", "consent-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = "consent";
      input.checked = answers.consent === 1;
      input.disabled = isReadonly();
      input.addEventListener("change", () => setAnswer("consent", input.checked ? 1 : 0));
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(" " + q.label));
      wrap.appendChild(lab);
      root.appendChild(wrap);
      return;
    }

    const head = el("div", "q-head");
    const title = el("h3", "q-title");
    title.innerHTML =
      '<span class="q-code">' +
      escapeHtml(q.id) +
      "</span>" +
      escapeHtml(q.label) +
      (q.required ? ' <span class="req">*</span>' : "");
    head.appendChild(title);
    if (q.type === "multi" && q.maxSelect) {
      const sel = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      head.appendChild(el("span", "select-hint", "Đã chọn " + sel.length + "/" + q.maxSelect));
    }
    wrap.appendChild(head);
    if (q.note) wrap.appendChild(el("p", q.noteProminent ? "q-note prominent" : "q-note", escapeHtml(q.note)));

    if (q.type === "single" || q.type === "likert") {
      const list = el("div", q.type === "likert" ? "likert-single" : "option-list");
      const opts = q.type === "likert" ? [1, 2, 3, 4, 5].map((c) => ({ code: c, label: String(c) })) : q.options;
      if (q.type === "likert" && q.scale) {
        list.appendChild(el("div", "scale-ends", "<span>" + escapeHtml(q.scale.left) + "</span><span>" + escapeHtml(q.scale.right) + "</span>"));
      }
      const row = q.type === "likert" ? el("div", "choice-row") : list;
      opts.forEach((o) => {
        const lab = el("label", "choice");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = q.id;
        input.value = o.code;
        input.checked = answers[q.id] === o.code;
        input.disabled = isReadonly();
        input.addEventListener("change", () => setAnswer(q.id, o.code));
        lab.appendChild(input);
        lab.appendChild(el("span", "choice-mark", "✓"));
        lab.appendChild(el("span", "choice-text", escapeHtml(o.label)));
        row.appendChild(lab);
      });
      if (q.type === "likert") list.appendChild(row);
      wrap.appendChild(list);
      if (q.other && answers[q.id] === q.other.code) wrap.appendChild(renderOtherInput(q));
    }

    if (q.type === "multi") {
      const sel = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      const list = el("div", "option-list");
      (q.options || []).forEach((o) => {
        if (!Logic.isOptionVisible(o, answers)) return;
        const disabled = !isReadonly() && Logic.optionDisabled(q.id, o.code, answers);
        const lab = el("label", "choice" + (disabled ? " disabled" : ""));
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = sel.includes(o.code);
        input.disabled = isReadonly() || (disabled && !sel.includes(o.code));
        input.addEventListener("change", () => toggleMulti(q.id, o.code));
        lab.appendChild(input);
        lab.appendChild(el("span", "choice-mark", "✓"));
        lab.appendChild(el("span", "choice-text", escapeHtml(o.label)));
        list.appendChild(lab);
      });
      wrap.appendChild(list);
      if (q.other && sel.includes(q.other.code)) wrap.appendChild(renderOtherInput(q));
    }

    if (q.type === "likert_group") wrap.appendChild(renderLikertGroup(q));

    if (q.type === "text") {
      const ta = document.createElement("textarea");
      ta.id = q.id;
      ta.maxLength = q.maxLength || 1000;
      ta.value = answers[q.id] || "";
      ta.disabled = isReadonly();
      const counter = el("div", "char-count", (answers[q.id] || "").length + "/" + (q.maxLength || 1000));
      ta.addEventListener("input", () => {
        answers[q.id] = ta.value;
        counter.textContent = ta.value.length + "/" + (q.maxLength || 1000);
        saveProgress();
      });
      wrap.appendChild(ta);
      wrap.appendChild(counter);
    }

    root.appendChild(wrap);
  }

  function renderLikertGroup(q) {
    const box = el("div", "likert-group");
    const scale = q.scale || { left: "1", right: "5" };
    box.appendChild(
      el(
        "div",
        "scale-legend",
        "<span>1 – " + escapeHtml(scale.left) + "</span>" + (scale.mid ? "<span>3 – " + escapeHtml(scale.mid) + "</span>" : "") + "<span>5 – " + escapeHtml(scale.right) + "</span>"
      )
    );
    const table = el("div", "likert-table desktop-only");
    table.appendChild(el("div", "likert-head", "<div class='likert-stmt'>Nội dung</div>" + [1, 2, 3, 4, 5].map((n) => "<div class='likert-col'>" + n + "</div>").join("")));
    const mobile = el("div", "likert-mobile mobile-only");

    (q.blocks || []).forEach((block) => {
      if (block.title) {
        table.appendChild(el("div", "likert-block-title", escapeHtml(block.title)));
        mobile.appendChild(el("div", "likert-block-title", escapeHtml(block.title)));
      }
      (block.items || []).forEach((it) => {
        if (it.group) {
          table.appendChild(el("div", "likert-group-title", escapeHtml(it.group)));
          mobile.appendChild(el("div", "likert-group-title", escapeHtml(it.group)));
        }
        const answered = answers[it.id] != null;
        const row = el("div", "likert-row");
        row.id = "item-" + it.id;
        const label = (it.display || it.id) + ". " + it.label + (answered ? ' <span class="answered-mark">✓</span>' : "");
        row.appendChild(el("div", "likert-stmt", label));
        [1, 2, 3, 4, 5].forEach((n) => {
          const cell = el("div", "likert-col");
          const input = document.createElement("input");
          input.type = "radio";
          input.name = it.id;
          input.value = n;
          input.checked = answers[it.id] === n;
          input.disabled = isReadonly();
          input.addEventListener("change", () => {
            answers[it.id] = n;
            saveProgress();
            render();
          });
          cell.appendChild(input);
          row.appendChild(cell);
        });
        table.appendChild(row);

        const card = el("div", "likert-card");
        card.id = "m-item-" + it.id;
        card.appendChild(el("div", "likert-card-title", label));
        const btns = el("div", "likert-dots");
        [1, 2, 3, 4, 5].forEach((n) => {
          const b = el("button", "dot" + (answers[it.id] === n ? " on" : ""), String(n));
          b.type = "button";
          b.disabled = isReadonly();
          b.addEventListener("click", () => {
            if (isReadonly()) return;
            answers[it.id] = n;
            saveProgress();
            render();
          });
          btns.appendChild(b);
        });
        card.appendChild(btns);
        card.appendChild(el("div", "scale-ends small", "<span>" + escapeHtml(scale.left) + "</span><span>" + escapeHtml(scale.right) + "</span>"));
        mobile.appendChild(card);
      });
    });
    box.appendChild(table);
    box.appendChild(mobile);
    return box;
  }

  function updateStatusStrip() {
    const strip = document.getElementById("status-strip");
    const left = document.getElementById("status-left");
    const right = document.getElementById("status-right");
    if (!strip) return;
    right.innerHTML = "";
    if (mode === "view" && viewingRec) {
      strip.dataset.mode = "view";
      left.innerHTML =
        "👁 Đang xem <strong>" +
        escapeHtml(viewingRec.display_name || viewingRec.form_code) +
        "</strong>" +
        (viewingRec.entered_by ? " · nhập bởi " + escapeHtml(viewingRec.entered_by) : "") +
        " · lúc " +
        escapeHtml(fmtShort(viewingRec.server_time));
      if (!publicMode) {
        right.appendChild(btn("Sửa", "btn outline sm", () => startEdit(viewingRec)));
        right.appendChild(
          btn("Tải Word", "btn outline sm", async () => {
            try {
              await WordExport.downloadOne(viewingRec);
            } catch (e) {
              toast(e.message);
            }
          })
        );
      }
      right.appendChild(
        btn(viewAll ? "Xem từng phần" : "Xem toàn bộ", "btn outline sm", () => {
          viewAll = !viewAll;
          render();
        })
      );
      right.appendChild(btn("Đóng", "btn primary sm", () => closeView()));
    } else if (mode === "edit") {
      strip.dataset.mode = "edit";
      left.innerHTML = "✎ Đang sửa <strong>" + escapeHtml(viewingRec && viewingRec.display_name ? viewingRec.display_name : editFormCode) + "</strong>";
      right.appendChild(btn("Lưu thay đổi", "btn primary sm", () => finishSurvey()));
      right.appendChild(btn("Hủy", "btn outline sm", () => closeView()));
    } else if (publicMode) {
      strip.dataset.mode = "new";
      left.innerHTML = "Phiếu mới · sẽ lưu thành <strong>" + escapeHtml(displayNameFromSeq(nextPreviewSeq)) + "</strong>";
    } else {
      strip.dataset.mode = "paper";
      left.innerHTML = "Nhập phiếu giấy · sẽ lưu thành <strong>" + escapeHtml(displayNameFromSeq(nextPreviewSeq)) + "</strong>";
    }
  }

  function btn(label, cls, fn) {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function fmtShort(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + " " + p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function renderSteps() {
    const bar = document.getElementById("step-bar");
    const meta = document.getElementById("step-meta");
    if (!bar) return;
    const list = pages();
    const cur = list[pageIndex];
    bar.innerHTML = "";
    STEP_META.forEach((step, si) => {
      const anyVisible = step.pageIds.some((id) => list.some((p) => p.id === id));
      const doneIdx = list.findIndex((p) => step.pageIds.includes(p.id));
      const isCurrent = cur && step.pageIds.includes(cur.id);
      const item = el("button", "step-item");
      item.type = "button";
      if (!anyVisible) item.classList.add("skip");
      else if (isCurrent) item.classList.add("on");
      else if (doneIdx >= 0 && doneIdx < pageIndex) item.classList.add("done");
      else if (mode !== "view" && doneIdx > pageIndex) item.classList.add("locked");
      const dot = el("div", "step-dot", !anyVisible ? "–" : doneIdx >= 0 && doneIdx < pageIndex ? "✓" : step.key);
      item.appendChild(dot);
      item.appendChild(el("span", "step-label", step.label));
      item.addEventListener("click", () => {
        if (!anyVisible) return;
        if (mode === "view" || mode === "edit") {
          const idx = list.findIndex((p) => step.pageIds.includes(p.id));
          if (idx >= 0) {
            pageIndex = idx;
            render();
            window.scrollTo({ top: document.getElementById("block1").offsetTop - 70, behavior: "smooth" });
          }
          return;
        }
        const idx = list.findIndex((p) => step.pageIds.includes(p.id));
        if (idx >= 0 && idx <= pageIndex) {
          pageIndex = idx;
          render();
        }
      });
      bar.appendChild(item);
    });
    if (meta && cur) {
      const remain = Math.max(1, Math.round(((list.length - pageIndex) / list.length) * 10));
      meta.textContent = cur.partLabel + " · " + (pageIndex + 1) + "/" + list.length + " · khoảng " + remain + " phút còn lại";
    }
  }

  function renderSuccess() {
    const app = document.getElementById("app");
    app.innerHTML = "";
    const panel = el("div", "success-panel");
    panel.innerHTML =
      '<div class="success-icon">✓</div><h2>Đã lưu <strong>' +
      escapeHtml(lastDisplayName || lastFormCode || "phiếu") +
      "</strong></h2><p>" +
      (publicMode ? "Cảm ơn Ông/Bà đã tham gia khảo sát." : "Phiếu đã xuất hiện ở danh sách bên dưới.") +
      "</p>";
    const actions = el("div", "success-actions");
    if (publicMode) {
      actions.appendChild(btn("Làm phiếu mới", "btn primary", () => startFresh()));
    } else {
      actions.appendChild(
        btn("Nhập phiếu tiếp", "btn primary", () => {
          startFresh({ keepDate: true });
        })
      );
      actions.appendChild(
        btn("Xem phiếu vừa lưu", "btn outline", async () => {
          try {
            const rec = await Api.api("get", { form_code: lastFormCode });
            if (rec) openReadOnly(normalizeRecord(rec));
          } catch (e) {
            toast(e.message);
          }
        })
      );
    }
    panel.appendChild(actions);
    app.appendChild(panel);
    document.getElementById("nav-bar").hidden = true;
  }

  function normalizeRecord(rec) {
    if (!rec) return rec;
    const out = Object.assign({}, rec);
    if (!out.answers && typeof rec === "object") {
      /* get có thể trả answers lồng hoặc phẳng */
      if (rec.answers) out.answers = rec.answers;
    }
    out.seq_num = out.seq_num != null ? out.seq_num : out.seq;
    return out;
  }

  function render() {
    const app = document.getElementById("app");
    if (!CONFIG.SURVEY_OPEN && mode === "online") {
      app.innerHTML = "<div class='success-panel'><h2>Khảo sát đã đóng</h2></div>";
      document.getElementById("nav-bar").hidden = true;
      return;
    }
    if (finished && mode !== "edit") {
      renderSuccess();
      updateStatusStrip();
      return;
    }

    answers = Logic.clearDependentAnswers(answers);
    updateStatusStrip();
    renderSteps();

    const list = pages();
    if (pageIndex >= list.length) pageIndex = Math.max(0, list.length - 1);
    app.innerHTML = "";

    if (viewAll && (mode === "view" || mode === "edit")) {
      list.forEach((page) => {
        const header = el("header", "page-header");
        header.appendChild(el("p", "part-label", escapeHtml(page.partLabel)));
        header.appendChild(el("h2", "", escapeHtml(page.title)));
        app.appendChild(header);
        if (page.id === "intro" && mode !== "view") {
          renderIntroExtras(app);
          renderPaperDate(app);
        }
        page.questions.forEach((qid) => {
          const q = SURVEY.questions[qid];
          if (q) renderQuestion(q, app);
        });
      });
      document.getElementById("nav-bar").hidden = mode === "view";
      return;
    }

    const page = list[pageIndex];
    if (!page) return;
    const header = el("header", "page-header");
    header.appendChild(el("p", "part-label", escapeHtml(page.partLabel)));
    header.appendChild(el("h2", "", escapeHtml(page.title)));
    if (page.lead) header.appendChild(el("p", "page-lead", escapeHtml(page.lead)));
    app.appendChild(header);
    if (page.id === "intro") {
      renderIntroExtras(app);
      renderPaperDate(app);
    }
    page.questions.forEach((qid) => {
      const q = SURVEY.questions[qid];
      if (q) renderQuestion(q, app);
    });

    const back = document.getElementById("btn-back");
    const next = document.getElementById("btn-next");
    document.getElementById("nav-bar").hidden = mode === "view";
    back.style.visibility = pageIndex === 0 ? "hidden" : "visible";
    back.disabled = pageIndex === 0;
    const last = pageIndex === list.length - 1;
    next.textContent = last ? (mode === "edit" ? "Lưu thay đổi" : publicMode ? "Gửi phiếu ✓" : "Lưu phiếu ✓") : "Tiếp tục →";
    next.classList.toggle("send", last && mode !== "edit");
    next.disabled = saving;
  }

  function markMissing(list) {
    document.querySelectorAll(".q-block.error").forEach((n) => n.classList.remove("error"));
    if (!list.length) return;
    const first = list[0];
    const block = document.getElementById("q-" + first.questionId);
    if (block) {
      block.classList.add("error");
      if (![...block.querySelectorAll(".err-msg")].length) {
        block.appendChild(el("div", "err-msg", first.message || "Vui lòng trả lời câu này"));
      }
      block.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function trackPageTime() {
    const page = currentPage();
    if (!page || !pageEnterAt) return;
    pageTimes[page.id] = (pageTimes[page.id] || 0) + Math.round((Date.now() - pageEnterAt) / 1000);
    pageEnterAt = Date.now();
  }

  async function goNext() {
    if (isReadonly()) return;
    if (mode === "paper" && pageIndex === 0 && !paperCollectedAt) {
      const r = await showFormDialog("Ngày thu phiếu giấy", [{ id: "date", label: "Ngày thu phiếu", type: "date", required: true, value: new Date().toISOString().slice(0, 10) }]);
      if (!r) return;
      paperCollectedAt = r.date;
      saveProgress();
    }
    const page = currentPage();
    if (!page) return;
    const missing = Logic.validatePage(page, answers);
    if (missing.length) {
      markMissing(missing);
      return;
    }
    if (page.id === "intro" && answers.S0 === 2) {
      screenedOut = true;
      finished = true;
      await submitPayload(true);
      renderSuccess();
      return;
    }
    const flags = Logic.checkConsistency(answers).filter((f) => !flagInconsistent.includes(f.code) && !f.soft);
    if (flags.length && pageIndex >= 1) {
      const f = flags[0];
      const choice = await showDialog("Câu trả lời của Ông/Bà ở câu " + f.x + " và câu " + f.y + " có vẻ chưa khớp. Ông/Bà vui lòng kiểm tra lại.");
      if (choice !== "keep") return;
      flagInconsistent.push(f.code);
    }
    Logic.checkConsistency(answers)
      .filter((f) => f.soft)
      .forEach((f) => {
        if (!flagInconsistent.includes(f.code)) flagInconsistent.push(f.code);
      });

    trackPageTime();
    const list = pages();
    if (pageIndex >= list.length - 1) {
      finishSurvey();
      return;
    }
    pageIndex += 1;
    pageEnterAt = Date.now();
    saveProgress();
    render();
    document.getElementById("survey-scroll").scrollTop = 0;
  }

  function goBack() {
    if (pageIndex <= 0 || isReadonly()) return;
    trackPageTime();
    pageIndex -= 1;
    pageEnterAt = Date.now();
    saveProgress();
    render();
  }

  function deviceInfo() {
    return {
      device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop",
      screen_w: window.screen ? window.screen.width : "",
      user_agent: String(navigator.userAgent || "").slice(0, 180),
    };
  }

  function todayYmd() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function buildFlags(quality, screened) {
    const parts = [];
    if (screened || quality.screened_out) parts.push("screened_out");
    if (quality.attention_fail) parts.push("attention_fail");
    if (quality.speeder) parts.push("speeder");
    if (quality.straightline_flag) parts.push("straightline");
    if (quality.honeypot_flag) parts.push("honeypot");
    flagInconsistent.forEach((c) => parts.push(c));
    return parts.join(";");
  }

  function buildCreateBody(screened) {
    const end = new Date();
    const start = startTime ? new Date(startTime) : end;
    const duration_sec = Math.max(0, Math.round((end - start) / 1000));
    const honeypot = (document.getElementById("website_url") || {}).value || "";
    const quality = Logic.computeQuality(answers, { duration_sec, speederSec: CONFIG.SPEEDER_SEC, honeypot: !!String(honeypot).trim() });
    if (screened) {
      quality.screened_out = 1;
      quality.valid = 0;
    }
    const session = Api.getSession() || {};
    const body = {
      answers: Object.assign({}, answers),
      client_uuid: clientUuid || uid(),
      start_time: vnIso(start),
      end_time: vnIso(end),
      duration_sec,
      valid: quality.valid,
      flags: buildFlags(quality, screened),
      survey_version: CONFIG.SURVEY_VERSION,
      source: publicMode ? "online" : "paper",
    };
    if (!publicMode) {
      body.entered_by = session.name || "";
      body.paper_date = paperCollectedAt || todayYmd();
    }
    return body;
  }

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.PENDING_QUEUE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveQueue(q) {
    try {
      localStorage.setItem(CONFIG.PENDING_QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}
    updateQueueChip();
  }
  function enqueuePending(action, body) {
    const q = loadQueue();
    q.push({ id: uid(), action, body, at: Date.now() });
    saveQueue(q);
  }
  function updateQueueChip() {
    const n = loadQueue().length;
    let chip = document.getElementById("queue-chip");
    if (!chip) {
      const host = document.getElementById("header-right");
      if (!host) return;
      chip = el("span", "chip-queue");
      chip.id = "queue-chip";
      host.insertBefore(chip, host.firstChild);
    }
    if (n > 0) {
      chip.hidden = false;
      chip.textContent = "⏳ " + n + " phiếu chờ gửi";
    } else {
      chip.hidden = true;
    }
  }

  async function flushQueue() {
    let q = loadQueue();
    if (!q.length) return;
    const remain = [];
    for (const item of q) {
      try {
        const data = await Api.api(item.action, item.body);
        if (data && data.form_code && window.Manager) Manager.onNewResponse(data.form_code, data.display_name);
      } catch (e) {
        if (e.code === "UNAUTHORIZED") {
          remain.push(item);
          break;
        }
        remain.push(item);
      }
    }
    saveQueue(remain);
  }

  async function submitPayload(screened) {
    if (mode === "edit") {
      const session = Api.getSession() || {};
      const honeypot = (document.getElementById("website_url") || {}).value || "";
      const end = new Date();
      const start = startTime ? new Date(startTime) : end;
      const duration_sec = Math.max(0, Math.round((end - start) / 1000));
      const quality = Logic.computeQuality(answers, { duration_sec, speederSec: CONFIG.SPEEDER_SEC, honeypot: !!String(honeypot).trim() });
      const data = await Api.api("update", {
        form_code: editFormCode,
        answers: Object.assign({}, answers),
        reason: editReason,
        by: session.name || "",
        expected_updated_at: expectedUpdatedAt || (viewingRec && viewingRec.updated_at) || "",
        valid: quality.valid,
        flags: buildFlags(quality, false),
        paper_date: paperCollectedAt || (viewingRec && viewingRec.paper_date) || "",
      });
      if (data && data.conflict) {
        const choice = await showDialog(
          "Phiếu này vừa được " + (data.updated_by || "người khác") + " sửa lúc " + fmtShort(data.updated_at) + ".",
          [
            { label: "Hủy", value: "cancel", className: "btn outline" },
            { label: "Tải bản mới", value: "reload", className: "btn primary" },
          ]
        );
        if (choice === "reload") {
          const rec = normalizeRecord(await Api.api("get", { form_code: editFormCode }));
          openReadOnly(rec);
        }
        throw new Error("CONFLICT");
      }
      lastFormCode = editFormCode;
      lastDisplayName = (viewingRec && viewingRec.display_name) || editFormCode;
      toast("Đã cập nhật " + lastDisplayName);
      if (window.Manager) Manager.onNewResponse(lastFormCode);
      return data;
    }

    const action = publicMode ? "createPublic" : "create";
    const body = buildCreateBody(screened);
    try {
      const data = await Api.api(action, body);
      lastFormCode = data.form_code || "";
      lastDisplayName = data.display_name || displayNameFromSeq(data.seq || nextPreviewSeq);
      if (data.duplicate) toast("Phiếu này đã được lưu trước đó (" + lastDisplayName + ")");
      else toast("Đã lưu " + lastDisplayName);
      if (window.Manager) Manager.onNewResponse(lastFormCode, lastDisplayName);
      await refreshNextSeq();
      return data;
    } catch (e) {
      if (e.code === "UNAUTHORIZED") throw e;
      enqueuePending(action, body);
      toast("Mất mạng – phiếu đã vào hàng chờ gửi");
      lastFormCode = body.client_uuid;
      lastDisplayName = "phiếu chờ gửi";
      return { queued: true, form_code: body.client_uuid };
    }
  }

  async function finishSurvey() {
    if (!publicMode && mode !== "edit" && mode !== "view") {
      if (!paperCollectedAt) {
        toast("Vui lòng chọn Ngày thu phiếu");
        const inp = document.getElementById("paper-date-input");
        if (inp) inp.focus();
        return;
      }
    }
    if (mode === "edit" && !editReason) {
      const r = await showFormDialog("Lý do sửa phiếu", [{ id: "reason", label: "Lý do sửa (bắt buộc)", type: "textarea", required: true }]);
      if (!r) return;
      editReason = r.reason;
    }
    if (saving) return;
    saving = true;
    const nextBtn = document.getElementById("btn-next");
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = "Đang lưu…";
    }
    finished = true;
    try {
      await submitPayload(false);
      if (mode === "edit") {
        viewingRec = null;
        editFormCode = null;
        editReason = "";
        expectedUpdatedAt = "";
        startFresh({ keepDate: true });
      } else {
        keepPaperDate = paperCollectedAt;
        renderSuccess();
        updateStatusStrip();
      }
    } catch (e) {
      finished = false;
      if (e.message !== "CONFLICT") toast(e.message === "UNAUTHORIZED" ? "Mã truy cập không đúng" : e.message || "Không lưu được phiếu");
      render();
    } finally {
      saving = false;
    }
  }

  function resetState(opts) {
    opts = opts || {};
    answers = opts.answers || {};
    pageIndex = opts.pageIndex || 0;
    startTime = opts.startTime || vnIso(new Date());
    pageTimes = opts.pageTimes || {};
    flagInconsistent = opts.flagInconsistent || [];
    screenedOut = false;
    finished = false;
    mode = opts.mode || (publicMode ? "public" : "paper");
    editFormCode = opts.editFormCode || null;
    editReason = opts.editReason || "";
    expectedUpdatedAt = opts.expectedUpdatedAt || "";
    paperCollectedAt = opts.paperCollectedAt != null ? opts.paperCollectedAt : todayYmd();
    viewingRec = opts.viewingRec || null;
    viewAll = false;
    lastFormCode = null;
    lastDisplayName = null;
    clientUuid = opts.clientUuid || uid();
    respondentId = opts.respondentId || clientUuid;
    pageEnterAt = Date.now();
  }

  function startFresh(opts) {
    opts = opts || {};
    const date = opts.keepDate && (keepPaperDate || paperCollectedAt) ? keepPaperDate || paperCollectedAt : todayYmd();
    resetState({
      mode: publicMode ? "public" : "paper",
      paperCollectedAt: date,
    });
    keepPaperDate = date;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startPaper() {
    startFresh();
    document.getElementById("block1").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function startEdit(record) {
    const full = normalizeRecord(record.answers ? record : await Api.api("get", { form_code: record.form_code }));
    resetState({
      mode: "edit",
      answers: Object.assign({}, full.answers || {}),
      editFormCode: full.form_code,
      editReason: "",
      expectedUpdatedAt: full.updated_at || "",
      respondentId: full.respondent_id || full.client_uuid,
      viewingRec: full,
      startTime: full.start_time || vnIso(new Date()),
      paperCollectedAt: full.paper_date || todayYmd(),
      flagInconsistent: String(full.flags || full.flag_inconsistent || "")
        .split(";")
        .filter(Boolean),
    });
    render();
    document.getElementById("block1").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openReadOnly(record) {
    const full = normalizeRecord(record);
    viewingRec = full;
    resetState({
      mode: "view",
      answers: Object.assign({}, full.answers || {}),
      respondentId: full.respondent_id || full.client_uuid,
      viewingRec: full,
      startTime: full.start_time || vnIso(new Date()),
      expectedUpdatedAt: full.updated_at || "",
      paperCollectedAt: full.paper_date || "",
    });
    finished = false;
    render();
    const b1 = document.getElementById("block1");
    b1.classList.remove("flash-view");
    void b1.offsetWidth;
    b1.classList.add("flash-view");
    const top = b1.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top: top, behavior: "smooth" });
    if (window.Manager) Manager.setActiveCode(full.form_code);
  }

  function closeView() {
    viewingRec = null;
    viewAll = false;
    if (window.Manager) Manager.setActiveCode(null);
    startFresh({ keepDate: true });
  }

  async function refreshNextSeq() {
    try {
      if (publicMode || !Api.getSession()) {
        nextPreviewSeq = 1;
      } else {
        const st = await Api.api("stats", {});
        nextPreviewSeq = (st.lastSeq || 0) + 1;
      }
    } catch (e) {
      /* giữ giá trị cũ */
    }
    updateStatusStrip();
  }

  function setupPublicMode() {
    const params = new URLSearchParams(location.search);
    publicMode = params.get("mode") === "public";
    document.body.classList.toggle("public-mode", publicMode);
  }

  function renderUserChip() {
    const host = document.getElementById("header-right");
    if (!host || publicMode) return;
    let chip = document.getElementById("user-chip");
    const session = Api.getSession();
    if (!session) {
      if (chip) chip.remove();
      return;
    }
    if (!chip) {
      chip = el("button", "chip-user");
      chip.id = "user-chip";
      chip.type = "button";
      host.insertBefore(chip, host.firstChild);
      chip.addEventListener("click", async () => {
        Api.clearSession();
        await ensureLogin(true);
      });
    }
    chip.textContent = "👤 " + session.name + " · Đổi";
  }

  function ensureLogin(force) {
    return new Promise((resolve) => {
      if (publicMode) {
        resolve(true);
        return;
      }
      if (!force && Api.getSession()) {
        renderUserChip();
        resolve(true);
        return;
      }
      const host = document.getElementById("modal-host");
      const overlay = el("div", "dialog-overlay login-overlay");
      const box = el("div", "dialog login-dialog");
      box.innerHTML =
        "<h3>Đăng nhập người nhập phiếu</h3>" +
        '<div class="dialog-form">' +
        '<div class="field"><label for="login-name">Tên người nhập</label><input id="login-name" type="text" autocomplete="nickname" /></div>' +
        '<div class="field"><label for="login-key">Mã truy cập</label>' +
        '<div class="pwd-row"><input id="login-key" type="password" autocomplete="current-password" />' +
        '<button type="button" class="btn ghost sm" id="login-toggle">Hiện</button></div></div>' +
        '<p class="login-error" id="login-error" hidden></p>' +
        "</div>";
      const actions = el("div", "dialog-actions");
      const ok = el("button", "btn primary", "Vào nhập phiếu");
      ok.type = "button";
      actions.appendChild(ok);
      box.appendChild(actions);
      overlay.appendChild(box);
      host.appendChild(overlay);

      const nameEl = document.getElementById("login-name");
      const keyEl = document.getElementById("login-key");
      const errEl = document.getElementById("login-error");
      document.getElementById("login-toggle").addEventListener("click", (e) => {
        const show = keyEl.type === "password";
        keyEl.type = show ? "text" : "password";
        e.currentTarget.textContent = show ? "Ẩn" : "Hiện";
      });
      nameEl.focus();

      async function tryLogin() {
        const name = (nameEl.value || "").trim();
        const key = keyEl.value || "";
        if (!name) {
          nameEl.focus();
          return;
        }
        if (!key) {
          keyEl.focus();
          return;
        }
        ok.disabled = true;
        ok.textContent = "Đang kiểm tra…";
        errEl.hidden = true;
        try {
          Api.saveSession({ key, name });
          await Api.api("stats", {});
          overlay.remove();
          renderUserChip();
          resolve(true);
        } catch (e) {
          Api.clearSession();
          errEl.hidden = false;
          errEl.textContent = e.code === "UNAUTHORIZED" || e.message === "UNAUTHORIZED" ? "Mã truy cập không đúng" : e.message || "Không đăng nhập được";
          ok.disabled = false;
          ok.textContent = "Vào nhập phiếu";
        }
      }
      ok.addEventListener("click", tryLogin);
      keyEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") tryLogin();
      });
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") keyEl.focus();
      });
    });
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "TEXTAREA" || (e.target.tagName === "INPUT" && e.target.type === "text"))) {
        if (!(e.ctrlKey && e.key === "Enter")) return;
      }
      if (document.querySelector(".dialog-overlay")) return;
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btn-next")?.click();
        return;
      }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "Left")) {
        e.preventDefault();
        goBack();
        return;
      }
      if (mode === "view" || saving) return;
      if (!/^[1-5]$/.test(e.key)) return;
      const active = document.activeElement;
      let qid = null;
      if (active && active.name && /^[A-Z0-9_]+$/i.test(active.name) && active.type === "radio") qid = active.name;
      else {
        const row = document.querySelector(".likert-row:hover, .likert-card:hover, .q-block:hover");
        if (row) {
          const inp = row.querySelector('input[type="radio"]');
          if (inp) qid = inp.name;
        }
      }
      if (!qid) return;
      const n = Number(e.key);
      answers[qid] = n;
      render();
      const ids = [];
      pages().forEach((p) => {
        (p.questions || []).forEach((qid2) => {
          const q = SURVEY.questions[qid2];
          if (!q) return;
          if (q.type === "likert_group") {
            (q.blocks || []).forEach((b) => (b.items || []).forEach((it) => ids.push(it.id)));
          } else if (q.type === "likert") ids.push(q.id);
        });
      });
      const idx = ids.indexOf(qid);
      if (idx >= 0 && idx < ids.length - 1) {
        const next = document.querySelector('input[name="' + ids[idx + 1] + '"]');
        if (next) next.focus();
      }
    });
  }

  function renderPaperDate(root) {
    if (publicMode || mode === "view") return;
    if (mode !== "paper" && mode !== "edit") return;
    const wrap = el("div", "paper-date-row");
    wrap.innerHTML = '<label for="paper-date-input">Ngày thu phiếu <span class="req">*</span></label>';
    const input = document.createElement("input");
    input.type = "date";
    input.id = "paper-date-input";
    input.required = true;
    input.value = paperCollectedAt || todayYmd();
    input.disabled = mode === "view";
    input.addEventListener("change", () => {
      paperCollectedAt = input.value;
      keepPaperDate = input.value;
    });
    wrap.appendChild(input);
    root.appendChild(wrap);
  }

  async function boot() {
    setupPublicMode();
    document.getElementById("footer-ver").textContent = CONFIG.SURVEY_VERSION;
    Api.setUnauthorizedHandler(() => {
      ensureLogin(true).then(() => {
        if (window.Manager && !publicMode) Manager.refresh();
      });
    });

    document.getElementById("btn-back").addEventListener("click", goBack);
    document.getElementById("btn-next").addEventListener("click", goNext);
    document.getElementById("btn-goto-block2")?.addEventListener("click", () => {
      document.getElementById("block2").scrollIntoView({ behavior: "smooth" });
    });
    bindShortcuts();
    updateQueueChip();
    window.addEventListener("online", flushQueue);
    setInterval(flushQueue, 30000);

    if (!publicMode) await ensureLogin(false);

    startFresh();
    await refreshNextSeq();
    if (window.Manager && !publicMode) Manager.init();
    flushQueue();
  }

  return {
    boot,
    toast,
    showDialog,
    showFormDialog,
    startFresh,
    startPaper,
    startEdit,
    openReadOnly,
    closeView,
    escapeHtml,
    isPublicMode,
    renderPaperDate,
    isModalOpen: () => !!document.querySelector(".dialog-overlay"),
    getSessionName: () => (Api.getSession() && Api.getSession().name) || "",
    CONFIG,
  };
})();

document.addEventListener("DOMContentLoaded", () => App.boot());

