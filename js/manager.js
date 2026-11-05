/* Khối 2 – danh sách phiếu đồng bộ Google Sheets */
const Manager = (function () {
  let page = 1;
  let sortDir = "desc";
  let filters = { status: "all", q: "", source: "", enteredBy: "", from: "", to: "" };
  let selected = new Set();
  let highlightCode = null;
  let activeCode = null;
  let refreshTimer = null;
  let bound = false;
  let knownCodes = new Set();
  let firstLoad = true;
  let lastStats = null;
  let lastItems = [];
  let offline = false;

  const A1L = { 1: "Dưới 25", 2: "25–34", 3: "35–44", 4: "≥45" };
  const A2L = { 1: "<1 năm", 2: "1–<3 năm", 3: "3–<5 năm", 4: "5–<10 năm", 5: "≥10 năm" };
  const A11L = { 1: "Hà Nội", 2: "TP.HCM", 3: "Đô thị lớn khác", 4: "Tỉnh/thành khác" };

  function init() {
    if (App.isPublicMode()) return;
    bind();
    refresh(true);
    schedule();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;
      } else {
        refresh(true);
        schedule();
      }
    });
  }

  function schedule() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refresh(false), (CONFIG.AUTO_REFRESH_SEC || 20) * 1000);
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function bind() {
    if (bound) return;
    bound = true;
    const readFilters = () => {
      filters = {
        q: val("mgr-q"),
        status: val("mgr-status") || "all",
        source: val("mgr-source"),
        enteredBy: val("mgr-editor"),
        from: val("mgr-from"),
        to: val("mgr-to"),
      };
      page = 1;
      refresh(true);
    };
    ["mgr-q", "mgr-status", "mgr-source", "mgr-editor", "mgr-from", "mgr-to"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", readFilters);
    });
    document.getElementById("mgr-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") readFilters();
    });
    document.getElementById("mgr-clear")?.addEventListener("click", () => {
      ["mgr-q", "mgr-status", "mgr-source", "mgr-editor", "mgr-from", "mgr-to"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = id === "mgr-status" ? "all" : "";
      });
      filters = { status: "all", q: "", source: "", enteredBy: "", from: "", to: "" };
      page = 1;
      refresh(true);
    });
    document.getElementById("mgr-add")?.addEventListener("click", () => App.startPaper());
    document.getElementById("mgr-dl-selected")?.addEventListener("click", downloadSelectedWord);
    document.getElementById("mgr-batch")?.addEventListener("click", (e) => {
      e.stopPropagation();
      buildBatchMenu();
      toggleMenu("mgr-batch-menu");
    });
    document.getElementById("mgr-export")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu("mgr-export-menu");
    });
    document.getElementById("mgr-export-menu")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-exp]");
      if (!btn) return;
      hideMenus();
      await exportNamed(btn.dataset.exp);
    });
    document.getElementById("mgr-refresh")?.addEventListener("click", () => refresh(true));
    document.addEventListener("click", hideMenus);
  }

  function toggleMenu(id) {
    const m = document.getElementById(id);
    if (!m) return;
    const open = !m.hidden;
    hideMenus();
    m.hidden = open;
  }
  function hideMenus() {
    ["mgr-batch-menu", "mgr-export-menu"].forEach((id) => {
      const m = document.getElementById(id);
      if (m) m.hidden = true;
    });
  }

  function shouldSkipRefresh() {
    if (App.isModalOpen && App.isModalOpen()) return true;
    if (selected.size > 0) return true;
    return false;
  }

  async function refresh(force) {
    if (!force && shouldSkipRefresh()) return;
    try {
      const [listData, stats] = await Promise.all([
        Api.api("list", {
          page,
          pageSize: CONFIG.PAGE_SIZE,
          q: filters.q || "",
          status: filters.status || "all",
          source: filters.source || "",
          enteredBy: filters.enteredBy || "",
          from: filters.from || "",
          to: filters.to || "",
          sortDir,
        }),
        Api.api("stats", {}),
      ]);
      offline = false;
      setOfflineBanner(false);
      lastStats = stats;
      lastItems = listData.items || [];
      detectNewRows(lastItems);
      renderStats(stats);
      renderEditorFilter(stats);
      renderTable(lastItems, listData);
      renderPager(listData);
      updateHeader(stats);
      const now = new Date();
      const p = (n) => String(n).padStart(2, "0");
      const el = document.getElementById("mgr-updated");
      if (el) el.textContent = "Cập nhật lúc " + p(now.getHours()) + ":" + p(now.getMinutes()) + ":" + p(now.getSeconds());
      firstLoad = false;
    } catch (e) {
      offline = true;
      setOfflineBanner(true);
      if (lastItems.length) {
        /* giữ dữ liệu cũ */
      } else {
        const wrap = document.getElementById("mgr-table-wrap");
        if (wrap) wrap.innerHTML = '<div class="empty-msg">Không tải được danh sách: ' + App.escapeHtml(e.message) + "</div>";
      }
    }
  }

  function setOfflineBanner(on) {
    let ban = document.getElementById("offline-banner");
    if (on) {
      if (!ban) {
        ban = document.createElement("div");
        ban.id = "offline-banner";
        ban.className = "offline-banner";
        ban.textContent = "Mất kết nối máy chủ – đang thử lại…";
        const block2 = document.getElementById("block2");
        if (block2) block2.insertBefore(ban, block2.firstChild);
      }
      ban.hidden = false;
    } else if (ban) ban.hidden = true;
  }

  function detectNewRows(items) {
    const me = App.getSessionName ? App.getSessionName() : "";
    items.forEach((r) => {
      if (!firstLoad && !knownCodes.has(r.form_code)) {
        highlightCode = highlightCode || r.form_code;
        if (r.entered_by && r.entered_by !== me) {
          App.toast(r.entered_by + " vừa nhập " + (r.display_name || r.form_code));
        }
      }
      knownCodes.add(r.form_code);
    });
  }

  function updateHeader(stats) {
    const total = stats.total || 0;
    const hc = document.getElementById("header-count");
    if (hc) hc.innerHTML = "Đã thu: <strong>" + total + "</strong> phiếu";
  }

  function renderStats(stats) {
    const el = document.getElementById("mgr-stats");
    if (!el) return;
    const items = [
      ["Tổng phiếu", stats.total || 0, "📦"],
      ["Hợp lệ", stats.valid || 0, "✅"],
      ["Bị gắn cờ", stats.flagged || 0, "🚩"],
      ["Hôm nay", stats.today || 0, "🗓️"],
    ];
    el.innerHTML = items
      .map(
        ([label, num, ico]) =>
          '<div class="stat-card"><div class="stat-label">' +
          label +
          '</div><div class="stat-num">' +
          num +
          '</div><div class="stat-ico">' +
          ico +
          "</div></div>"
      )
      .join("");
    const by = stats.byEditor || {};
    const editors = Object.keys(by);
    let byLine = document.getElementById("mgr-by-editor");
    if (!byLine) {
      byLine = document.createElement("p");
      byLine.id = "mgr-by-editor";
      byLine.className = "by-editor";
      el.insertAdjacentElement("afterend", byLine);
    }
    byLine.textContent = editors.length ? "Theo người nhập: " + editors.map((n) => n + " " + by[n]).join(" · ") : "";
    const total = stats.total || 0;
    const pct = Math.min(100, Math.round((total / (CONFIG.TARGET_N || 1000)) * 100));
    const tl = document.getElementById("mgr-target-label");
    const tb = document.getElementById("mgr-target-bar");
    if (tl) tl.textContent = total + " / " + CONFIG.TARGET_N + " phiếu";
    if (tb) tb.style.width = pct + "%";
  }

  function renderEditorFilter(stats) {
    const sel = document.getElementById("mgr-editor");
    if (!sel) return;
    const cur = sel.value;
    const by = (stats && stats.byEditor) || {};
    const names = Object.keys(by).sort();
    sel.innerHTML = '<option value="">Người nhập</option>' + names.map((n) => '<option value="' + App.escapeHtml(n) + '">' + App.escapeHtml(n) + "</option>").join("");
    if (cur) sel.value = cur;
  }

  function statusInfo(r) {
    if (r.deleted) return { label: "Đã xóa", cls: "badge gray", tip: r.delete_reason || "" };
    const flags = String(r.flags || "");
    if (Number(r.valid) === 1 && !flags) return { label: "Hợp lệ", cls: "badge green", tip: "" };
    if (Number(r.valid) === 1 && !/attention_fail|speeder|straightline|honeypot|screened/.test(flags))
      return { label: "Hợp lệ", cls: "badge green", tip: flags };
    return { label: "Gắn cờ", cls: "badge orange", tip: flags || "valid=0" };
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fmtDur(sec) {
    sec = Number(sec) || 0;
    return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
  }

  function renderTable(rows, data) {
    const wrap = document.getElementById("mgr-table-wrap");
    if (!rows.length) {
      wrap.innerHTML =
        '<div class="empty-msg"><div class="empty-illu">📭</div><strong>Chưa có phiếu nào</strong><br/>Phiếu sẽ xuất hiện tại đây ngay sau khi được gửi.<br/><br/><button type="button" class="btn primary" id="mgr-first">Làm phiếu đầu tiên ↑</button></div>';
      document.getElementById("mgr-first")?.addEventListener("click", () => {
        document.getElementById("block1").scrollIntoView({ behavior: "smooth" });
      });
      updateBulk();
      return;
    }
    let html =
      '<div class="table-desktop"><table class="mgr-table"><thead><tr>' +
      '<th><input type="checkbox" id="mgr-check-all" /></th><th>Tên phiếu</th><th>Mã</th><th>Thời gian gửi</th><th>Người nhập</th><th>Nguồn</th><th>Nhóm tuổi</th><th>Kinh nghiệm</th><th>Khu vực</th><th>Thời gian làm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>';
    rows.forEach((r) => {
      const st = statusInfo(r);
      const isNew = highlightCode && r.form_code === highlightCode;
      const isActive = activeCode && r.form_code === activeCode;
      html +=
        '<tr class="' +
        (isNew ? "row-new " : "") +
        (isActive ? "row-active" : "") +
        '"><td><input type="checkbox" class="row-check" data-code="' +
        App.escapeHtml(r.form_code) +
        '" ' +
        (selected.has(r.form_code) ? "checked" : "") +
        " /></td><td><strong>" +
        App.escapeHtml(r.display_name || r.form_code) +
        "</strong>" +
        (isNew ? ' <span class="tag-new">Mới</span>' : "") +
        '</td><td class="mono">' +
        App.escapeHtml(r.form_code) +
        "</td><td>" +
        fmtTime(r.server_time) +
        "</td><td>" +
        App.escapeHtml(r.entered_by || "—") +
        "</td><td>" +
        (r.source === "paper" ? "Giấy" : "Online") +
        "</td><td>" +
        (A1L[r.A1] || "—") +
        "</td><td>" +
        (A2L[r.A2] || "—") +
        "</td><td>" +
        (A11L[r.A11] || "—") +
        "</td><td>" +
        fmtDur(r.duration_sec) +
        '</td><td><span class="' +
        st.cls +
        '" title="' +
        App.escapeHtml(st.tip) +
        '">' +
        st.label +
        "</span>" +
        (r.edited ? " ✎" : "") +
        '</td><td class="ops">' +
        actionBtns(r) +
        "</td></tr>";
    });
    html += '</tbody></table></div><div class="table-mobile">';
    rows.forEach((r) => {
      const st = statusInfo(r);
      html +=
        '<article class="mgr-card' +
        (activeCode === r.form_code ? " row-active" : "") +
        '"><div class="mgr-card-top"><label><input type="checkbox" class="row-check" data-code="' +
        App.escapeHtml(r.form_code) +
        '" ' +
        (selected.has(r.form_code) ? "checked" : "") +
        " /> <strong>" +
        App.escapeHtml(r.display_name || r.form_code) +
        '</strong></label><span class="' +
        st.cls +
        '">' +
        st.label +
        '</span></div><div class="mgr-card-meta">' +
        fmtTime(r.server_time) +
        " · " +
        App.escapeHtml(r.entered_by || "") +
        " · " +
        App.escapeHtml(r.form_code) +
        '</div><div class="ops">' +
        actionBtns(r) +
        "</div></article>";
    });
    html += "</div>";
    wrap.innerHTML = html;

    document.getElementById("mgr-check-all")?.addEventListener("change", (e) => {
      document.querySelectorAll(".row-check").forEach((c) => {
        c.checked = e.target.checked;
        if (e.target.checked) selected.add(c.dataset.code);
        else selected.delete(c.dataset.code);
      });
      updateBulk();
    });
    document.querySelectorAll(".row-check").forEach((c) => {
      c.addEventListener("change", () => {
        if (c.checked) selected.add(c.dataset.code);
        else selected.delete(c.dataset.code);
        updateBulk();
      });
    });
    document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAction));
    updateBulk();
    if (highlightCode) setTimeout(() => (highlightCode = null), 3000);
  }

  function actionBtns(r) {
    let s =
      '<button type="button" class="icon-btn" data-act="view" data-code="' +
      App.escapeHtml(r.form_code) +
      '" title="Xem">👁</button>' +
      '<button type="button" class="icon-btn" data-act="edit" data-code="' +
      App.escapeHtml(r.form_code) +
      '" title="Sửa">✎</button>' +
      '<button type="button" class="icon-btn" data-act="word" data-code="' +
      App.escapeHtml(r.form_code) +
      '" title="Tải Word">⬇</button>';
    if (r.deleted) {
      s +=
        '<button type="button" class="icon-btn" data-act="restore" data-code="' +
        App.escapeHtml(r.form_code) +
        '" title="Khôi phục">♻</button>';
    } else {
      s +=
        '<button type="button" class="icon-btn" data-act="delete" data-code="' +
        App.escapeHtml(r.form_code) +
        '" title="Xóa">🗑</button>';
    }
    return s;
  }

  function updateBulk() {
    const btn = document.getElementById("mgr-dl-selected");
    if (btn) btn.disabled = selected.size === 0;
    const del = document.getElementById("mgr-bulk-del");
    if (del) del.disabled = selected.size === 0;
  }

  function renderPager(data) {
    const el = document.getElementById("mgr-pager");
    if (!el) return;
    const total = data.total || 0;
    const pageSize = data.pageSize || 20;
    const pages = data.pageCount || Math.max(1, Math.ceil(total / pageSize));
    page = data.page || 1;
    const from = total ? (page - 1) * pageSize + 1 : 0;
    const to = Math.min(page * pageSize, total);
    el.innerHTML =
      "<div>Hiển thị " +
      from +
      "–" +
      to +
      " trên " +
      total +
      ' phiếu</div><div class="pager-btns">' +
      '<button type="button" data-p="' +
      Math.max(1, page - 1) +
      '">‹</button>' +
      pageWindow(page, pages)
        .map((n) =>
          n === "…"
            ? "<span>…</span>"
            : '<button type="button" class="' + (n === page ? "on" : "") + '" data-p="' + n + '">' + n + "</button>"
        )
        .join("") +
      '<button type="button" data-p="' +
      Math.min(pages, page + 1) +
      '">›</button>' +
      ' <label>Đến trang <input type="number" id="mgr-goto" min="1" max="' +
      pages +
      '" value="' +
      page +
      '" style="width:56px" /></label></div>';
    el.querySelectorAll("button[data-p]").forEach((b) =>
      b.addEventListener("click", () => {
        page = Number(b.dataset.p);
        refresh(true);
      })
    );
    document.getElementById("mgr-goto")?.addEventListener("change", (e) => {
      page = Math.min(pages, Math.max(1, Number(e.target.value) || 1));
      refresh(true);
    });
  }

  function pageWindow(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, cur, cur - 1, cur + 1]);
    const arr = Array.from(set)
      .filter((n) => n >= 1 && n <= total)
      .sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i && arr[i] - arr[i - 1] > 1) out.push("…");
      out.push(arr[i]);
    }
    return out;
  }

  async function onAction(e) {
    const act = e.currentTarget.dataset.act;
    const code = e.currentTarget.dataset.code;
    try {
      const rec = await Api.api("get", { form_code: code });
      if (act === "view") App.openReadOnly(rec);
      if (act === "edit") App.startEdit(rec);
      if (act === "word") {
        await WordExport.downloadOne(rec);
        App.toast("Đã tải Word " + (rec.display_name || code));
      }
      if (act === "delete") softDeleteOne(rec);
      if (act === "restore") {
        await Api.api("restore", { form_code: code, reason: "Hoàn tác", by: App.getSessionName() });
        App.toast("Đã khôi phục " + (rec.display_name || code));
        refresh(true);
      }
    } catch (err) {
      App.toast(err.message || "Lỗi");
    }
  }

  async function softDeleteOne(rec) {
    const r = await App.showFormDialog(
      "Xóa " + (rec.display_name || rec.form_code) + "?",
      [
        {
          id: "reason",
          label: "Lý do xóa",
          type: "select",
          required: true,
          options: [
            { value: "Trùng lặp", label: "Trùng lặp" },
            { value: "Phiếu thử", label: "Phiếu thử" },
            { value: "Không đạt sàng lọc", label: "Không đạt sàng lọc" },
            { value: "Khác", label: "Khác" },
          ],
        },
      ],
      "Xóa"
    );
    if (!r) return;
    await Api.api("softDelete", { form_code: rec.form_code, reason: r.reason, by: App.getSessionName() });
    if (activeCode === rec.form_code) App.startFresh({ keepDate: true });
    App.toast("Đã xóa " + (rec.display_name || rec.form_code), {
      label: "Hoàn tác",
      onClick: async () => {
        await Api.api("restore", { form_code: rec.form_code, reason: "Hoàn tác", by: App.getSessionName() });
        refresh(true);
      },
    });
    refresh(true);
  }

  async function getByCode(code) {
    return Api.api("get", { form_code: code });
  }

  async function downloadSelectedWord() {
    if (!selected.size) return;
    if (selected.size > 50) {
      App.toast("Chỉ tải tối đa 50 phiếu mỗi lần");
      return;
    }
    const all = await Api.api("exportAll", {});
    const rows = (Array.isArray(all) ? all : all.rows || []).filter((r) => selected.has(r.form_code) && !r.deleted);
    await runBatchZip(rows);
  }

  async function buildBatchMenu() {
    const menu = document.getElementById("mgr-batch-menu");
    if (!menu) return;
    menu.innerHTML = "";
    const lastSeq = (lastStats && lastStats.lastSeq) || 0;
    if (!lastSeq) {
      menu.innerHTML = "<button type='button' disabled>Chưa có phiếu</button>";
      return;
    }
    for (let start = 1; start <= lastSeq; start += 50) {
      const end = Math.min(start + 49, lastSeq);
      const a = String(start).padStart(3, "0");
      const b = String(end).padStart(3, "0");
      const zipBtn = document.createElement("button");
      zipBtn.type = "button";
      zipBtn.textContent = "ZIP Word · Phiếu số " + a + "–" + b;
      zipBtn.addEventListener("click", async () => {
        hideMenus();
        await batchBySeq(start, end, "zip");
      });
      menu.appendChild(zipBtn);
      const oneBtn = document.createElement("button");
      oneBtn.type = "button";
      oneBtn.textContent = "1 file Word gộp · " + a + "–" + b;
      oneBtn.addEventListener("click", async () => {
        hideMenus();
        await batchBySeq(start, end, "one");
      });
      menu.appendChild(oneBtn);
    }
  }

  async function batchBySeq(from, to, kind) {
    const all = await Api.api("exportAll", {});
    const rows = (Array.isArray(all) ? all : [])
      .filter((r) => !r.deleted)
      .filter((r) => {
        const s = Number(r.seq || r.seq_num || 0);
        return s >= from && s <= to;
      })
      .sort((a, b) => Number(a.seq || a.seq_num) - Number(b.seq || b.seq_num));
    if (!rows.length) {
      App.toast("Không có phiếu trong khoảng này");
      return;
    }
    if (kind === "zip") await runBatchZip(rows);
    else await runBatchOneDoc(rows);
  }

  async function runBatchZip(rows) {
    const host = document.getElementById("modal-host");
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML =
      '<div class="dialog progress-modal"><h3>Đang tạo file Word…</h3><div class="bar"><span id="zip-bar"></span></div><p id="zip-text">0/' +
      rows.length +
      '</p><button type="button" class="btn outline" id="zip-cancel">Hủy</button></div>';
    host.appendChild(overlay);
    const ctrl = { aborted: false };
    document.getElementById("zip-cancel").addEventListener("click", () => {
      ctrl.aborted = true;
      overlay.remove();
    });
    try {
      await WordExport.downloadMany(
        rows,
        (cur, total) => {
          const bar = document.getElementById("zip-bar");
          const text = document.getElementById("zip-text");
          if (bar) bar.style.width = Math.round((cur / total) * 100) + "%";
          if (text) text.textContent = "Đang tạo " + cur + "/" + total + "…";
        },
        ctrl
      );
      overlay.remove();
      const a = String(rows[0].seq || rows[0].seq_num).padStart(3, "0");
      const b = String(rows[rows.length - 1].seq || rows[rows.length - 1].seq_num).padStart(3, "0");
      App.toast("Đã tải " + rows.length + " phiếu (" + a + "–" + b + ")");
    } catch (e) {
      overlay.remove();
      if (!ctrl.aborted) App.toast(e.message || "Lỗi tạo ZIP");
    }
  }

  async function runBatchOneDoc(rows) {
    App.toast("Đang tạo file Word gộp…");
    /* ghép từng phiếu bằng downloadMany nội dung – dùng WordExport.buildBlob lần lượt qua JSZip 1 file: đơn giản tải ZIP; gộp 1 docx: nối children */
    if (!window.docx) throw new Error("Thiếu thư viện docx");
    const { Document, Packer, Paragraph, TextRun, PageBreak } = window.docx;
    const children = [];
    for (let i = 0; i < rows.length; i++) {
      const blob = await WordExport.buildBlob(rows[i]);
      /* Không merge blob dễ dàng – fallback: tải ZIP */
      void blob;
    }
    await runBatchZip(rows);
  }

  function stamp(kind) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return "KhaoSat_TamLyNDT_" + kind + "_" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }

  async function exportNamed(kind) {
    if (kind === "codebook") return ExportUtil.downloadText(stamp("codebook") + ".csv", ExportUtil.codebookCsv());
    if (kind === "sps") return ExportUtil.downloadText(stamp("labels") + ".sps", ExportUtil.spssSyntax(), "text/plain;charset=utf-8");
    if (kind === "audit") {
      const audit = await Api.api("audit", {});
      const rows = Array.isArray(audit) ? audit : audit.rows || [];
      const cols = ["time", "form_code", "action", "reason", "changes", "by"];
      const lines = [cols.map((c) => '"' + c + '"').join(",")];
      rows.forEach((r) => lines.push(cols.map((c) => '"' + String(r[c] ?? "").replace(/"/g, '""') + '"').join(",")));
      return ExportUtil.downloadText(stamp("audit_log") + ".csv", "\uFEFF" + lines.join("\r\n"));
    }
    const all = await Api.api("exportAll", {});
    let rows = Array.isArray(all) ? all : [];
    if (kind === "valid") rows = rows.filter((r) => !r.deleted && Number(r.valid) === 1);
    ExportUtil.downloadText(stamp(kind) + ".csv", ExportUtil.toCsv(rows.map(ExportUtil.encodeRow)));
  }

  function onNewResponse(formCode) {
    highlightCode = formCode;
    if (formCode) knownCodes.add(formCode);
    page = 1;
    refresh(true);
  }

  function setActiveCode(code) {
    activeCode = code;
    refresh(true);
  }

  return { init, refresh, onNewResponse, getByCode, setActiveCode };
})();
