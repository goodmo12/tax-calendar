// 세무 신고 달력 - DOM 연결만. 판단은 전부 ui-logic.js / engine.js.
// 주의: file:// 로 열면 fetch 가 막혀 데이터를 못 읽는다. 이 폴더에서
//   python -m http.server 8765
// 로 띄우고 http://localhost:8765/ 로 열 것.
// 답(입력값)은 저장·전송하지 않는다. 방문과 버튼 사용 횟수만 익명으로 센다(쿠키 없음, visit-count.js).

import { QUESTIONS, buildCalendar, toIcs, googleCalendarUrl } from "./engine.js";
import {
  TEXT, QUESTION_META, visibleQuestions, optionsFor, sanitizeAnswers, readiness,
  showUnknownTaxTypeNotice, formatDate, dueLabel, shiftText, displayNotes, buildView, inAppEscape,
  riskNote, groupSummaryText, inAppTexts, inAppCopyUrl,
} from "./ui-logic.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c) n.append(c);
  return n;
}

// 방문 측정 모듈은 동적으로 불러온다. 막히거나 실패해도(광고 차단 등) 도구는 그대로 동작해야 한다.
let vc = null;
import("./visit-count.js").then((m) => { vc = m; m.trackPageview(); }).catch(() => {});
const countEvent = (key) => { try { if (vc) vc.trackEvent(vc.EVENTS[key]); } catch { /* 측정 실패는 무시 */ } };
let questionsDoneSent = false; // 질문 완료는 방문당 1회만 센다
const state = { entity: null, answers: {}, rules: null, holidays: null, current: null };

function showError(msg) {
  const b = $("dataError");
  b.textContent = msg;
  b.hidden = false;
  $("result").hidden = true;
}

// ---------- 질문 그리기 (한 번만 만들고, 이후엔 hidden 과 checked 만 갱신) ----------
function radioGroup(name, legendText, help, where, options) {
  const fs = el("fieldset", { class: "q", "data-q": name });
  fs.append(el("legend", { text: legendText }));
  if (help) fs.append(el("p", { class: "help", text: help }));
  if (where) fs.append(el("p", { class: "where", text: where }));
  fs.append(el("p", { class: "risk", role: "status", hidden: "" }));
  const box = el("div", { class: "opts" });
  for (const o of options) {
    const input = el("input", { type: "radio", name, value: o.value });
    box.append(el("label", {}, input, el("span", { text: o.label })));
  }
  fs.append(box);
  return fs;
}

function buildQuestions() {
  const list = $("questionList");
  list.append(radioGroup("entity", "사업자 형태가 어떻게 되나요?", "개인사업자인지 법인사업자인지의 구분입니다.",
    "어디서 확인하나요? 사업자등록증에서 법인으로 등록되어 있으면 법인, 대표자 개인 명의면 개인입니다. 헷갈리면 세무서에 확인하세요.",
    [{ value: "individual", label: "개인사업자" }, { value: "corporate", label: "법인사업자" }]));
  for (const key of Object.keys(QUESTIONS)) {
    const m = QUESTION_META[key];
    list.append(radioGroup(key, m.label, m.help, m.where, optionsFor(key)));
  }
  list.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "entity") state.entity = t.value;
    else if (t.name in QUESTIONS) state.answers[t.name] = t.value;
    update();
  });
}

function syncQuestions() {
  const vis = new Set(visibleQuestions(state.answers));
  const isIndividual = state.entity === "individual";
  for (const fs of $("questionList").querySelectorAll("fieldset.q")) {
    const key = fs.dataset.q;
    if (key === "entity") {
      for (const r of fs.querySelectorAll("input")) r.checked = r.value === state.entity;
      continue;
    }
    fs.hidden = !(isIndividual && vis.has(key));
    const cur = state.answers[key] ?? QUESTIONS[key].default; // 기본값(모름)은 화면에도 선택돼 보이게
    for (const r of fs.querySelectorAll("input")) r.checked = r.value === cur;
    const note = riskNote(key, cur);
    const rp = fs.querySelector(".risk");
    rp.textContent = note ?? "";
    rp.hidden = !note;
  }
}

// ---------- 결과 그리기 ----------
function kindBadge(kind) {
  if (kind === "고지납부") return el("span", { class: "badge notice-only", text: "고지납부 - 고지서가 온 경우에만" });
  return el("span", { class: "badge", text: kind });
}

function noteBlock(ev) {
  const notes = displayNotes(ev);
  if (!notes.length) return null;
  const d = el("details", {}, el("summary", { text: "안내 보기" }));
  for (const n of notes) d.append(el("p", { class: "note", text: n }));
  return d;
}

function stateBadge(entry, today) {
  if (entry.state === "past") return el("span", { class: "badge", text: "지남" });
  if (entry.isNext) return el("span", { class: "badge next", text: "다음 기한 · " + dueLabel(today, entry.event.deadline) });
  return null;
}

function eventRow(entry, today, cls, withTitle = true) {
  const ev = entry.event;
  const row = el("div", { class: cls + (entry.state === "past" ? " past" : "") + (entry.isNext ? " next" : "") });
  const head = el("div", {}, el("span", { class: "date", text: formatDate(ev.deadline) }), kindBadge(ev.kind), stateBadge(entry, today));
  row.append(head);
  row.append(el("div", { class: "title", text: ev.title }));
  const st = shiftText(ev);
  if (st) row.append(el("div", { class: "shift", text: st }));
  const nb = noteBlock(ev);
  if (nb) row.append(nb);
  const g = el("a", { class: "gcal", href: googleCalendarUrl(ev), target: "_blank", rel: "noopener", text: "구글 캘린더에 추가" });
  g.addEventListener("click", () => countEvent("googleCalendar"));
  row.append(g);
  return row;
}

function groupRow(g, today) {
  const d = el("details", { class: "item group" + (g.allPast ? " past" : "") + (g.hasNext ? " next" : "") });
  const first = g.entries[0].event;
  const sum = el("summary", {}, el("span", { class: "date", text: g.title }), kindBadge(first.kind),
    stateBadge({ state: g.allPast ? "past" : "future", isNext: g.hasNext, event: g.nextEntry?.event ?? first }, today),
    el("span", { class: "group-sum", text: groupSummaryText(g) + " (눌러서 회차별로 보기)" }));
  d.append(sum);
  for (const e of g.entries) d.append(eventRow(e, today, "sub-item"));
  return d;
}

function render() {
  const ready = readiness(state.entity, state.answers);
  $("blocked").hidden = true;
  $("result").hidden = true;
  if (ready === "need-entity") return;
  if (ready === "corporate") {
    $("blocked").textContent = TEXT.corporateNotice;
    $("blocked").hidden = false;
    return;
  }
  if (ready === "need-employees") {
    $("blocked").textContent = "직원 여부를 고르면 내 달력이 나옵니다.";
    $("blocked").hidden = false;
    return;
  }
  let cal;
  try {
    cal = buildCalendar(state.answers, state.rules, state.holidays);
  } catch (e) {
    showError(TEXT.loadError + " (" + e.message + ")");
    return;
  }
  $("dataError").hidden = true;
  state.current = cal;
  if (!questionsDoneSent) {
    questionsDoneSent = true;
    countEvent("questionsDone");
  }
  const view = buildView(cal.events, state.rules, new Date());

  const un = $("unknownTaxNotice");
  un.textContent = TEXT.unknownTaxTypeNotice;
  un.hidden = !showUnknownTaxTypeNotice(state.answers);

  const rn = $("rangeNotice");
  rn.textContent = view.rangeNotice ?? "";
  rn.hidden = !view.rangeNotice;

  const nb = $("nextBox");
  nb.replaceChildren();
  if (view.nextDate) {
    nb.className = "card next-box";
    nb.append(el("h2", { text: view.nextTitle }));
    for (const ev of view.nextEvents) nb.append(el("div", { class: "title", text: ev.title }));
    const b = el("button", { type: "button", class: "primary", text: "내 달력 전체를 .ics 파일로 받기" });
    b.addEventListener("click", downloadIcs);
    const nearBox = inAppNearBox();
    if (nearBox) nb.append(nearBox);
    nb.append(el("p", {}, b));
    nb.hidden = false;
  } else {
    nb.hidden = true;
  }

  const list = $("calendarList");
  list.replaceChildren();
  if (!view.items.length) list.append(el("p", { text: "해당하는 일정이 없습니다. 아래 「이 달력에 없는 일정」을 확인하세요." }));
  for (const it of view.items) list.append(it.type === "group" ? groupRow(it, view.today) : eventRow(it, view.today, "item"));

  const near = $("inAppNear");
  const nearBox = inAppNearBox();
  near.replaceChildren(...(nearBox ? [nearBox] : []));
  near.hidden = !nearBox;
  $("result").hidden = false;
}

const currentEscape = () => inAppEscape(navigator.userAgent, location);

// 다음 기한 박스와 등록 영역에 두는 한 줄 경고(안드로이드는 같은 intent 버튼도). 인앱이 아니면 null.
function inAppNearBox() {
  const esc = currentEscape();
  if (!esc) return null;
  const box = el("div", { class: "notice warn inapp-near" }, el("p", { text: inAppTexts(esc).near }));
  if (esc.kind === "intent") {
    const a = el("a", { class: "primary", href: esc.href, text: TEXT.inAppButton });
    a.addEventListener("click", () => countEvent("openInChrome"));
    box.append(a);
  }
  return box;
}

// 인앱 브라우저면 페이지 맨 위(답하기 전)에 탈출 버튼/안내. 자동 이동은 하지 않는다.
function renderInApp() {
  const esc = currentEscape();
  $("inAppBox").hidden = !esc;
  if (!esc) return;
  $("inAppFirst").textContent = inAppTexts(esc).first;
  $("inAppWarn").textContent = TEXT.inAppWarning;
  const a = $("inAppIntent");
  a.hidden = esc.kind !== "intent";
  if (esc.kind === "intent") {
    a.textContent = TEXT.inAppButton;
    a.href = esc.href;
    a.addEventListener("click", () => countEvent("openInChrome"));
  }
  const g = $("inAppGuide");
  g.hidden = esc.kind !== "copy";
  g.textContent = esc.kind === "copy" ? TEXT.inAppGuide : "";
  const cb = $("copyBtn");
  cb.hidden = esc.kind !== "copy";
  cb.textContent = TEXT.copyButton;
  const n = $("inAppNote");
  n.hidden = esc.kind !== "intent";
  n.textContent = esc.kind === "intent" ? TEXT.inAppIntentNote : "";
}

async function copyUrl() {
  const s = $("copyStatus");
  try {
    await navigator.clipboard.writeText(inAppCopyUrl(location));
    s.textContent = TEXT.copyDone;
  } catch {
    s.textContent = TEXT.copyFail;
    const u = $("copyUrl");
    u.value = inAppCopyUrl(location);
    u.hidden = false;
    u.focus();
    u.select();
  }
}

function update() {
  state.answers = sanitizeAnswers(state.answers);
  syncQuestions();
  if (state.rules) render();
}

function downloadIcs() {
  if (!state.current) return;
  countEvent("icsDownload");
  const blob = new Blob([toIcs(state.current.events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: "tax-calendar-2027.ics" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + " 응답 " + r.status);
  return r.json();
}

function staticTexts() {
  const rn = $("registerNotes");
  for (const t of [TEXT.googleAlarmNote, TEXT.icsAlarmNote, TEXT.reDownloadNote]) rn.append(el("li", { text: t }));
  const dl = $("disclaimerList");
  for (const t of TEXT.disclaimers) dl.append(el("li", { text: t }));
  $("privacy").textContent = TEXT.privacy;
}

async function main() {
  buildQuestions();
  staticTexts();
  renderInApp(); // 답·데이터 로드와 무관하게 첫 화면부터
  $("icsBtn").addEventListener("click", downloadIcs);
  $("copyBtn").addEventListener("click", copyUrl);
  syncQuestions();
  try {
    [state.rules, state.holidays] = await Promise.all([loadJson("data/rules.json"), loadJson("data/holidays-2027.json")]);
  } catch (e) {
    showError(TEXT.loadError + " (" + e.message + ")");
    return;
  }
  $("carryOver").textContent = state.rules.carryOverNote ?? "";
  const sn = state.rules.scopeNotice; // 첫 화면부터 항상 보인다(답과 무관)
  if (sn) {
    const sb = $("scopeBox");
    const ul = el("ul", { class: "plain" });
    for (const t of sn.items) ul.append(el("li", { text: t }));
    sb.replaceChildren(el("h2", { text: sn.title }), ul, el("p", { text: sn.tail }));
    sb.hidden = false;
  }
  update();
}

main();
