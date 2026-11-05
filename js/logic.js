/* Bước nhảy, ràng buộc chọn đáp án, kiểm tra nhất quán, chất lượng dữ liệu */

const Logic = (function () {
  /* Chế độ nhập phiếu giấy: ẩn câu kiểm tra chú ý (ATT1) và trang mở đầu (đồng ý + sàng lọc),
     không gắn cờ 'làm quá nhanh' vì người nhập liệu gõ nhanh là bình thường. */
  let paperMode = false;
  function setPaperMode(v) { paperMode = !!v; }
  function isPaperMode() { return paperMode; }

  function isVisibleCondition(cond, answers) {
    if (!cond) return true;
    const val = answers[cond.question];
    if (cond.in) return Array.isArray(val) ? val.some((v) => cond.in.includes(v)) : cond.in.includes(val);
    if (cond.notIn) return Array.isArray(val) ? !val.some((v) => cond.notIn.includes(v)) : !cond.notIn.includes(val);
    if (cond.equals !== undefined) return val === cond.equals;
    return true;
  }

  function isQuestionVisible(q, answers) {
    if (!q) return false;
    if (q.derivedWhen && isVisibleCondition(q.derivedWhen, answers) && q.derivedWhen.question === "D1" && answers.D1 === 1) {
      return false;
    }
    return isVisibleCondition(q.showIf, answers);
  }

  function isOptionVisible(opt, answers) {
    return isVisibleCondition(opt.showIf, answers);
  }

  function isPageVisible(page, answers) {
    if (paperMode && page.id === "intro") return false;
    return isVisibleCondition(page.showIf, answers);
  }

  function visiblePages(answers) {
    return SURVEY.pages.filter((p) => isPageVisible(p, answers));
  }

  function getLikertItems(q) {
    if (!q || q.type !== "likert_group") return [];
    const items = [];
    (q.blocks || []).forEach((b) => {
      (b.items || []).forEach((it) => {
        if (paperMode && it.attention) return;
        items.push(it);
      });
    });
    return items;
  }

  function clearDependentAnswers(answers) {
    const next = Object.assign({}, answers);

    if (!([3, 4, 5].includes(next.A2))) {
      ["B1_1", "B1_2", "B1_3", "B1_4", "B1_5", "B1_6", "B1_7", "B2", "B2_other"].forEach((k) => delete next[k]);
    }

    if (next.A6 === 0 || next.A6 === undefined || next.A6 === null) {
      ["DB1", "DB2", "DB3", "DB4", "DB5"].forEach((k) => delete next[k]);
      if (Array.isArray(next.C6)) next.C6 = next.C6.filter((c) => c !== 5 && c !== 6);
      if (Array.isArray(next.D2)) next.D2 = next.D2.filter((c) => c !== 2);
    }

    if (next.D1 === 1) {
      ["D3", "D4", "D6"].forEach((k) => delete next[k]);
      next.D5 = [5];
    } else if ([2, 3, 4].includes(next.D1)) {
      if (Array.isArray(next.D5) && next.D5.length === 1 && next.D5[0] === 5) {
        delete next.D5;
      }
    } else {
      ["D3", "D4", "D5", "D6"].forEach((k) => delete next[k]);
    }

    if (!(Array.isArray(next.G5) && next.G5.includes(6))) {
      delete next.G5_other;
    }

    return next;
  }

  function applyMultiConstraints(questionId, selected, answers) {
    const q = SURVEY.questions[questionId];
    if (!q || q.type !== "multi") return selected.slice();
    let sel = selected.slice().filter((c) => {
      const opt = (q.options || []).find((o) => o.code === c);
      return opt ? isOptionVisible(opt, answers) : false;
    });

    const exclusive = q.exclusive || [];
    const hitExclusive = sel.find((c) => exclusive.includes(c));
    if (hitExclusive !== undefined) {
      const last = sel[sel.length - 1];
      if (exclusive.includes(last)) sel = [last];
      else sel = sel.filter((c) => !exclusive.includes(c));
    }

    if (q.mutex && q.mutex.length === 2) {
      const [g1, g2] = q.mutex;
      const in1 = sel.some((c) => g1.includes(c));
      const in2 = sel.some((c) => g2.includes(c));
      if (in1 && in2) {
        const last = sel[sel.length - 1];
        if (g1.includes(last)) sel = sel.filter((c) => !g2.includes(c));
        else sel = sel.filter((c) => !g1.includes(c));
      }
    }

    if (q.bans) {
      q.bans.forEach((ban) => {
        const hasA = sel.some((c) => ban.a.includes(c));
        const hasB = sel.some((c) => ban.b.includes(c));
        if (hasA && hasB) {
          const last = sel[sel.length - 1];
          if (ban.a.includes(last)) sel = sel.filter((c) => !ban.b.includes(c));
          else sel = sel.filter((c) => !ban.a.includes(c));
        }
      });
    }

    if (q.maxSelect && sel.length > q.maxSelect) {
      sel = sel.slice(sel.length - q.maxSelect);
    }

    return sel;
  }

  function optionDisabled(questionId, code, answers) {
    const q = SURVEY.questions[questionId];
    if (!q || q.type !== "multi") return false;
    const sel = Array.isArray(answers[questionId]) ? answers[questionId] : [];
    const exclusive = q.exclusive || [];

    if (exclusive.length && sel.some((c) => exclusive.includes(c)) && !exclusive.includes(code)) {
      return true;
    }
    if (exclusive.includes(code) && sel.length && !sel.some((c) => exclusive.includes(c))) {
      /* still selectable – choosing it will clear others */
    }

    if (q.mutex && q.mutex.length === 2) {
      const [g1, g2] = q.mutex;
      const in1 = sel.some((c) => g1.includes(c));
      const in2 = sel.some((c) => g2.includes(c));
      if (in1 && g2.includes(code)) return true;
      if (in2 && g1.includes(code)) return true;
    }

    if (q.bans) {
      for (const ban of q.bans) {
        const hasA = sel.some((c) => ban.a.includes(c));
        const hasB = sel.some((c) => ban.b.includes(c));
        if (hasA && ban.b.includes(code) && !sel.includes(code)) return true;
        if (hasB && ban.a.includes(code) && !sel.includes(code)) return true;
      }
    }

    if (q.maxSelect && sel.length >= q.maxSelect && !sel.includes(code)) return true;
    return false;
  }

  function validateQuestion(q, answers) {
    if (!isQuestionVisible(q, answers)) return { ok: true };
    if (!q.required && q.type !== "consent") {
      if (q.type === "text") return { ok: true };
    }

    if (q.type === "consent") {
      return answers.consent === 1 ? { ok: true } : { ok: false, message: "Vui lòng đồng ý tham gia khảo sát." };
    }

    if (q.type === "single" || q.type === "likert") {
      const v = answers[q.id];
      if (v === undefined || v === null || v === "") {
        return { ok: false, message: "Vui lòng trả lời câu hỏi bắt buộc." };
      }
      if (q.other && v === q.other.code) {
        const text = (answers[q.other.id] || "").trim();
        if (text.length < (q.other.minLength || 1)) {
          return { ok: false, message: "Vui lòng ghi rõ phương án “Khác”." };
        }
      }
      return { ok: true };
    }

    if (q.type === "multi") {
      let sel = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      const min = q.minSelect || (q.required ? 1 : 0);
      if (sel.length < min) {
        return { ok: false, message: `Vui lòng chọn ít nhất ${min} phương án.` };
      }
      if (q.maxSelect && sel.length > q.maxSelect) {
        return { ok: false, message: `Chỉ được chọn tối đa ${q.maxSelect} phương án.` };
      }
      if (q.other && sel.includes(q.other.code)) {
        const text = (answers[q.other.id] || "").trim();
        if (text.length < (q.other.minLength || 1)) {
          return { ok: false, message: "Vui lòng ghi rõ phương án “Khác”." };
        }
      }
      return { ok: true };
    }

    if (q.type === "likert_group") {
      const items = getLikertItems(q);
      for (const it of items) {
        if (answers[it.id] === undefined || answers[it.id] === null || answers[it.id] === "") {
          return { ok: false, message: "Vui lòng trả lời đủ các phát biểu.", itemId: it.id };
        }
      }
      return { ok: true };
    }

    if (q.type === "text" && q.required) {
      const t = (answers[q.id] || "").trim();
      if (!t) return { ok: false, message: "Vui lòng nhập nội dung." };
    }
    return { ok: true };
  }

  function validatePage(page, answers) {
    const missing = [];
    for (const qid of page.questions) {
      const q = SURVEY.questions[qid];
      if (!q) continue;
      if (!isQuestionVisible(q, answers)) continue;
      const r = validateQuestion(q, answers);
      if (!r.ok) missing.push({ questionId: qid, itemId: r.itemId, message: r.message });
    }
    return missing;
  }

  function avg(ids, answers) {
    const vals = ids.map((id) => answers[id]).filter((v) => typeof v === "number");
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function checkConsistency(answers) {
    const flags = [];
    const soft = [];

    if (answers.A1 === 1 && answers.A2 === 5) {
      flags.push({ code: "R1", x: "A1", y: "A2", soft: false });
    }
    if (answers.A1 === 1 && answers.A2 === 4) {
      flags.push({ code: "R2", x: "A1", y: "A2", soft: false });
    }
    if (answers.A7 === 1 && answers.A12 === 1) {
      flags.push({ code: "R3", x: "A7", y: "A12", soft: false });
    }
    if (answers.A3 === 1 && answers.A6 === 4) {
      soft.push({ code: "R4", x: "A3", y: "A6", soft: true });
    }

    if (Array.isArray(answers.B2) && answers.B2.includes(6)) {
      const b1 = ["B1_1", "B1_2", "B1_3", "B1_4", "B1_5", "B1_6", "B1_7"];
      const changed = b1.filter((id) => typeof answers[id] === "number" && answers[id] !== 3).length;
      if (changed >= 5) flags.push({ code: "R5", x: "B2", y: "B1", soft: false });
    }

    const a8 = Array.isArray(answers.A8) ? answers.A8 : [];
    if (!a8.some((c) => [3, 4, 5].includes(c)) && answers.F1 === 4) {
      flags.push({ code: "R6", x: "A8", y: "F1", soft: false });
    }

    if (answers.F1 === 1) {
      const m = avg(["KT1", "KT2", "KT3", "KT4"], answers);
      if (m !== null && m >= 4) flags.push({ code: "R7", x: "F1", y: "F2", soft: false });
    }

    if (Array.isArray(answers.C6) && answers.C6.includes(8)) {
      const m = avg(["HT1", "HT2", "HT3", "HT4"], answers);
      if (m !== null && m >= 4) flags.push({ code: "R8", x: "C6", y: "C3", soft: false });
    }

    if (answers.A4 === 3 && answers.A5 === 3) {
      soft.push({ code: "R9", x: "A4", y: "A5", soft: true });
    }

    return flags.concat(soft);
  }

  function straightlineScore(ids, answers) {
    const vals = ids.map((id) => answers[id]).filter((v) => typeof v === "number");
    if (vals.length < 3) return false;
    const counts = {};
    vals.forEach((v) => {
      counts[v] = (counts[v] || 0) + 1;
    });
    const max = Math.max.apply(null, Object.values(counts));
    return max / vals.length >= 0.9;
  }

  function computeQuality(answers, meta) {
    const attention_fail = answers.ATT1 !== undefined && answers.ATT1 !== 2 ? 1 : 0;

    const blocks = {
      C1: getLikertItems(SURVEY.questions.C1).map((i) => i.id).filter((id) => id !== "ATT1"),
      C2: getLikertItems(SURVEY.questions.C2).map((i) => i.id),
      C3: getLikertItems(SURVEY.questions.C3).map((i) => i.id).filter((id) => id !== "ATT1"),
      C4: ["MS1", "MS2", "MS3", "MS4", "FSIS1", "FSIS2", "FSIS3", "FSIS4", "SI1", "SI2", "SI3", "SI4"],
      E1: getLikertItems(SURVEY.questions.E1).map((i) => i.id),
      F2: getLikertItems(SURVEY.questions.F2).map((i) => i.id),
      F3: getLikertItems(SURVEY.questions.F3).map((i) => i.id),
      H1: getLikertItems(SURVEY.questions.H1).map((i) => i.id),
    };

    let straightline_max = 0;
    Object.keys(blocks).forEach((k) => {
      if (straightlineScore(blocks[k], answers)) straightline_max += 1;
    });
    const straightline_flag = straightline_max >= 2 ? 1 : 0;

    const duration_sec = meta.duration_sec || 0;
    const speeder = !paperMode && duration_sec > 0 && duration_sec < (meta.speederSec || 240) ? 1 : 0;
    const honeypot_flag = meta.honeypot ? 1 : 0;
    const screened_out = answers.S0 === 2 ? 1 : 0;

    const valid =
      answers.consent === 1 &&
      answers.S0 === 1 &&
      attention_fail === 0 &&
      speeder === 0 &&
      straightline_flag === 0 &&
      honeypot_flag === 0
        ? 1
        : 0;

    return {
      attention_fail,
      straightline_max,
      straightline_flag,
      speeder,
      honeypot_flag,
      screened_out,
      valid,
      skip_B: [3, 4, 5].includes(answers.A2) ? 0 : 1,
      skip_C5: answers.A6 === 0 ? 1 : 0,
      skip_D: answers.D1 === 1 ? 1 : 0,
    };
  }

  return {
    isQuestionVisible,
    isOptionVisible,
    isPageVisible,
    visiblePages,
    getLikertItems,
    setPaperMode,
    isPaperMode,
    clearDependentAnswers,
    applyMultiConstraints,
    optionDisabled,
    validateQuestion,
    validatePage,
    checkConsistency,
    computeQuality,
  };
})();

if (typeof module !== "undefined") module.exports = { Logic };
window.Logic = Logic;
