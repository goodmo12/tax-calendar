// 세무 신고 달력 - 화면 판단 로직 (순수 함수, DOM 없음, Node 로 테스트 가능)
// 날짜는 문자열 연산과 엔진의 weekday 로만 다룬다. 로컬 시간대 API(getDate 등) 금지.
// "오늘"은 반드시 엔진의 todayKst 로만 잡는다(toISOString 방식은 미국 저녁에 하루 어긋남).

import { QUESTIONS, weekday, todayKst } from "./engine.js";

// ---------- 안내 문구: 화면에 나오는 문구는 여기 한 곳에서 고친다 ----------
export const TEXT = {
  inAppFirstIntent: "크롬에서 열면 파일 받기와 구글 캘린더 연결이 됩니다. 답하기 전에 먼저 여세요. 이 도구는 답을 저장하지 않아, 답한 뒤에 열면 처음부터 다시 답해야 합니다.",
  inAppFirstCopy: "Safari 등 다른 브라우저에서 여세요. 답하기 전에 먼저 여세요. 이 도구는 답을 저장하지 않아, 답한 뒤에 열면 처음부터 다시 답해야 합니다.",
  inAppNearIntent: "앱 안 브라우저에서는 파일 받기와 구글 캘린더 연결이 막힐 수 있습니다. 지금 크롬으로 넘어가면 답을 다시 해야 합니다.",
  inAppNearCopy: "앱 안 브라우저에서는 파일 받기와 구글 캘린더 연결이 막힐 수 있습니다. 맨 위 안내대로 다른 브라우저에서 여세요. 지금 넘어가면 답을 다시 해야 합니다.",
  inAppWarning: "앱 안 브라우저에서는 파일 받기와 구글 캘린더 연결이 막힐 수 있습니다.",
  inAppButton: "크롬으로 열기 (캘린더 등록용)",
  inAppIntentNote: "크롬이 없거나 열리지 않으면 앱 메뉴에서 「다른 브라우저로 열기」를 눌러 주세요.",
  inAppGuide: "이 앱에서는 자동으로 열리지 않을 수 있습니다. 앱 메뉴(···)에서 「Safari로 열기」나 「다른 브라우저로 열기」를 눌러 주세요. 메뉴가 안 보이면 아래 버튼으로 주소를 복사해 Safari나 크롬 주소창에 붙여넣으세요.",
  copyButton: "현재 주소 복사",
  copyDone: "주소를 복사했습니다. Safari나 크롬 주소창에 붙여넣어 주세요.",
  copyFail: "자동으로 복사하지 못했습니다. 아래 주소를 길게 눌러 복사해 주세요.",
  googleAlarmNote: "구글 캘린더 링크는 알림을 정할 수 없어 내 캘린더의 기본 알림 설정을 따릅니다.",
  icsAlarmNote: ".ics 파일에는 일정마다 1주 전 오전 9시와 전날 오전 9시, 알림 2개가 들어 있습니다.",
  reDownloadNote: "답을 바꿔 다시 받으면 이전에 넣은 일정이 캘린더에 남을 수 있습니다. 예전에 넣은 것은 직접 지워 주세요.",
  unknownTaxTypeNotice: "사업자등록증에서 과세유형을 확인하시면 일정이 줄어듭니다. 지금은 모름이라 일반과세자·간이과세자·면세사업자 일정이 전부 나옵니다.",
  corporateNotice: "이 도구는 개인사업자용입니다. 법인사업자의 신고 일정은 이 달력에 없습니다. 국세청 안내나 세무 전문가에게 확인하세요.",
  privacy: "이 도구는 입력한 답을 저장하거나 어디로도 보내지 않습니다. 계산은 모두 이 기기 안에서 이루어집니다.",
  disclaimers: [
    "휴일로 기한이 미뤄지는 계산 중 다음날도 쉬는 날이라 또 미루는 연쇄 이월은 조문에 명시된 것이 아니라 통설에 따른 계산입니다.",
    "임시공휴일(정부가 따로 지정하는 휴일)은 반영하지 않았습니다. 공휴일 목록은 관보와 대조하지 않았습니다.",
    "최종 기한은 반드시 국세청 홈택스(hometax.go.kr)나 관할 세무서에서 확인하세요.",
  ],
  loadError: "기한 데이터를 불러오지 못했습니다. 달력을 만들 수 없어 일정이 비어 보일 수 있으니 이 화면의 결과를 믿지 마세요. 페이지를 새로고침하거나, 파일을 직접 열었다면(file://) 로컬 서버로 띄워 주세요.",
};

// ---------- 질문 ----------
// 엔진 QUESTIONS 에 없는 질문 0(사업자 형태)은 화면이 처리한다. 허용값은 엔진에서 가져온다.
export const VALUE_LABELS = {
  general: "일반과세자",
  simplified: "간이과세자",
  exempt: "면세사업자",
  unknown: "모름",
  yes: "예",
  no: "아니오",
};

export const QUESTION_META = {
  taxType: {
    label: "부가가치세 과세유형이 무엇인가요?",
    help: "부가가치세(물건·서비스값에 붙는 세금)를 어떤 방식으로 내는지의 구분입니다.",
    where: "어디서 확인하나요? 사업자등록증에 적혀 있습니다. 홈택스나 세무서에서도 확인할 수 있습니다.",
  },
  simplifiedIssuedInvoiceH1: {
    label: "2027년 1-6월에 세금계산서를 발급했거나 발급할 예정인가요? 확실하지 않으면 「모름」을 고르세요.",
    help: "간이과세자라도 세금계산서를 발급했다면 7월에 신고를 해야 하고, 발급하지 않았다면 고지서가 온 경우에만 내는 쪽입니다.",
    where: "어디서 확인하나요? 직접 발급한 기억이나 발급 내역으로 판단하세요. 확실하지 않으면 홈택스나 세무서에서 확인하세요.",
  },
  hasEmployees: {
    label: "2026년이나 2027년에 직원(아르바이트·일용직 포함)에게 급여를 준 적이 있거나 줄 예정인가요?",
    help: "월급을 주며 세금을 미리 떼어 국가에 대신 내는 일(원천징수)이 있는지를 묻습니다. 2027년 1-3월 기한 일부는 2026년 급여에 달려 있습니다.",
    where: "어디서 확인하나요? 4대보험, 급여대장, 아르바이트·일용직에게 준 급여 내역을 보세요. 일용직만 있어도 「예」를 고르면 원천세 일정이 나옵니다. 다만 일용직 관련 기한(일용근로소득 지급명세서 등)과 3.3%를 떼는 프리랜서 관련 기한은 이 달력에 없으니, 해당되면 아래 「이 달력에 없는 일정」을 꼭 보세요. 일용직만 있으면 해당 없는 일정이 몇 개 더 보일 수 있습니다.",
  },
  withholdingSemiannual: {
    label: "원천세를 반기(6개월)에 한 번 내는 승인을 받았나요?",
    help: "직전 연도 상시고용인원이 20명 이하(금융·보험업 제외)인 원천징수의무자는 세무서 승인을 받으면 매월 대신 1월·7월에 두 번만 원천세를 낼 수 있습니다.",
    where: "어디서 확인하나요? 세무서에 반기별 납부를 신청해 승인받은 기억이 없다면 아니오입니다. 홈택스나 세무서에서 확인하세요.",
  },
  diligentFiling: {
    label: "성실신고확인대상자인가요?",
    help: "종합소득세를 신고할 때 세무사의 확인을 받아야 하는 사업자입니다. 해당하면 신고 기한이 한 달 늦습니다.",
    where: "어디서 확인하나요? 담당 세무사, 홈택스, 세무서에서 확인하세요. 해당 여부를 모르면 「모름」을 고르세요.",
  },
};

// 일정을 늦추거나 지우는 위험한 답. 확실할 때만 고르도록 그 답 옆에 안내를 붙인다.
const RISKY_NOTES = {
  taxType: { exempt: "「면세사업자」는 사업자등록증에서 확인했을 때만 고르세요. 고르면 부가세 신고 일정이 달력에서 빠집니다. 확실하지 않으면 「모름」을 고르세요(일정이 더 많이 보입니다)." },
  simplifiedIssuedInvoiceH1: { no: "「아니오」는 발급하지 않았고 앞으로도 발급하지 않을 것이 확실할 때만 고르세요. 고르면 7월 신고 대신 고지서가 온 경우에만 내는 일정으로 보입니다. 확실하지 않으면 「모름」을 고르세요(더 이른 날짜로 보여 드립니다)." },
  hasEmployees: { no: "「아니오」는 급여를 준 사람이 없고 줄 예정도 없다고 확실할 때만 고르세요. 고르면 원천세·지급명세서 일정이 달력에서 빠집니다. 확실하지 않으면 「예」를 고르세요(일정이 더 많이 보입니다)." },
  withholdingSemiannual: { yes: "「예」는 세무서 승인을 받은 것이 확실할 때만 고르세요. 고르면 원천세가 매월이 아니라 1월·7월 두 번만 보입니다. 확실하지 않으면 「모름」을 고르세요(더 이른 날짜로 보여 드립니다)." },
  diligentFiling: { yes: "「예」는 성실신고확인대상자인 것이 확실할 때만 고르세요. 고르면 종합소득세 기한이 한 달 늦은 날짜로 보입니다. 확실하지 않으면 「모름」을 고르세요(더 이른 날짜로 보여 드립니다)." },
};

export function riskNote(key, value) {
  return RISKY_NOTES[key]?.[value] ?? null;
}

// 화면에 보이는 엔진 질문 키 목록(엔진 QUESTIONS 순서). 나중 질문은 앞 답에 따라 숨는다.
export function visibleQuestions(answers) {
  const a = answers ?? {};
  return Object.keys(QUESTIONS).filter((k) => {
    if (k === "simplifiedIssuedInvoiceH1") return a.taxType === "simplified" || a.taxType === "unknown" || a.taxType === undefined;
    if (k === "withholdingSemiannual") return a.hasEmployees === "yes";
    return true;
  });
}

// 질문의 선택지: 엔진이 허용하는 값만, 엔진 순서대로.
export function optionsFor(key) {
  return QUESTIONS[key].allowed.map((v) => ({ value: v, label: VALUE_LABELS[v] }));
}

// 숨겨진 질문의 답을 지운 새 객체. 지우지 않으면 예전 답이 엔진에 남아 일정이 어긋날 수 있다.
export function sanitizeAnswers(answers) {
  const vis = new Set(visibleQuestions(answers));
  const out = {};
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (k in QUESTIONS && !vis.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// 달력을 그릴 수 있는 상태인지. 직원 여부는 기본값이 없어 반드시 답해야 한다.
export function readiness(entity, answers) {
  if (entity !== "individual" && entity !== "corporate") return "need-entity";
  if (entity === "corporate") return "corporate";
  const v = answers?.hasEmployees;
  if (!QUESTIONS.hasEmployees.allowed.includes(v)) return "need-employees";
  return "ready";
}

export function showUnknownTaxTypeNotice(answers) {
  return (answers?.taxType ?? QUESTIONS.taxType.default) === "unknown";
}

// ---------- 날짜 표기 (문자열 연산 + 엔진 weekday 만) ----------
const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function formatDate(iso, { year = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("날짜 형식 오류: " + iso);
  return (year ? m[1] + "년 " : "") + Number(m[2]) + "월 " + Number(m[3]) + "일(" + WD[weekday(iso)] + ")";
}

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("날짜 형식 오류: " + iso);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function daysUntil(todayIso, iso) {
  return dayNumber(iso) - dayNumber(todayIso);
}

export function dueLabel(todayIso, iso) {
  const n = daysUntil(todayIso, iso);
  if (n === 0) return "오늘";
  if (n === 1) return "내일";
  if (n > 1) return n + "일 남음";
  return "지남";
}

// 이월이 일어난 항목만 문구가 나온다(아니면 null).
export function shiftText(ev) {
  if (!ev.shifted) return null;
  return "법정 기한 " + formatDate(ev.statutoryDate) + " → 휴일이라 " + formatDate(ev.deadline);
}

// 엔진이 이월 시 끝에 붙이는 ISO 날짜 안내는 shiftText 와 겹치므로 화면에서는 뺀다.
export function displayNotes(ev) {
  const notes = ev.notes ?? [];
  return ev.shifted ? notes.slice(0, -1) : notes.slice();
}

// ---------- 다음 기한 / 묶기 ----------
// 기한 당일은 지남이 아니라 오늘이다.
export function eventState(todayIso, deadline) {
  if (deadline < todayIso) return "past";
  if (deadline === todayIso) return "today";
  return "future";
}

// 묶을 규칙: 매월 반복(monthly) 또는 말일 여러 건(monthEnds 2건 이상)
export function groupableRuleIds(rulesFile) {
  const ids = new Set();
  for (const r of rulesFile.rules) {
    if (r.monthly || (Array.isArray(r.monthEnds) && r.monthEnds.length > 1)) ids.add(r.id);
  }
  return ids;
}

// events: 엔진 deadlinesFor 결과(날짜순). now: 테스트용으로 주입(없으면 현재). 오늘은 todayKst 로만.
export function buildView(events, rulesFile, now) {
  const today = todayKst(now);
  const nextEv = events.find((e) => e.deadline >= today);
  const nextDate = nextEv ? nextEv.deadline : null;
  const groupable = groupableRuleIds(rulesFile);
  const names = new Map(rulesFile.rules.map((r) => [r.id, r.name]));
  const items = [];
  const groups = new Map();
  for (const ev of events) {
    const entry = { event: ev, state: eventState(today, ev.deadline), isNext: ev.deadline === nextDate };
    if (!groupable.has(ev.ruleId)) {
      items.push({ type: "single", ...entry });
      continue;
    }
    let g = groups.get(ev.ruleId);
    if (!g) {
      g = { type: "group", ruleId: ev.ruleId, title: names.get(ev.ruleId) ?? ev.ruleId, kind: ev.kind, entries: [] };
      groups.set(ev.ruleId, g);
      items.push(g);
    }
    g.entries.push(entry);
  }
  for (const g of groups.values()) {
    g.hasNext = g.entries.some((e) => e.isNext);
    g.nextEntry = g.entries.find((e) => e.state !== "past") ?? null;
    g.allPast = g.nextEntry === null;
  }
  const nextEvents = events.filter((e) => e.deadline === nextDate);
  const year = rulesFile.calendarYear;
  const range = rangeStatus(today, year, nextDate);
  return { today, nextDate, nextEvents, items, range, rangeNotice: rangeNotice(range, today, year), nextTitle: nextTitle(range, year, nextDate, today) };
}

// 달력 연도(rules.calendarYear)와 오늘의 관계: before 이면 올해 남은 기한이 이 달력에 없고, ended 이면 달력의 기한이 다 지났다.
export function rangeStatus(todayIso, year, nextDate) {
  if (todayIso < year + "-01-01") return "before";
  if (nextDate === null) return "ended";
  return "in";
}

export function rangeNotice(range, todayIso, year) {
  if (range === "before") {
    return "이 달력은 " + year + "년 기한만 담고 있습니다. 올해(" + todayIso.slice(0, 4) + "년)에 남은 기한(직원이 있으면 매월 10일 원천세 등)은 이 달력에 없으니 홈택스나 세무서에서 확인하세요.";
  }
  if (range === "ended") {
    return "이 달력의 " + year + "년 기한은 모두 지났습니다. 이 달력은 끝났습니다. 이후 기한은 홈택스나 세무서에서 확인하세요.";
  }
  return null;
}

export function nextTitle(range, year, nextDate, todayIso) {
  if (!nextDate) return null;
  const head = range === "before" ? year + "년 기한 중 다음 기한: " : "다음 기한: ";
  return head + formatDate(nextDate, { year: true }) + " (" + dueLabel(todayIso, nextDate) + ")";
}

// 묶음 접힘 줄에 보일 요약: 회차 수와 다음 회차 날짜
export function groupSummaryText(g) {
  const next = g.nextEntry ? "다음 회차 " + formatDate(g.nextEntry.event.deadline) : "모든 회차 지남";
  return g.entries.length + "회 반복 · " + next;
}

// ---------- 인앱 브라우저 감지 (UA 기반이라 완벽하지 않음: 막지 말고 안내만) ----------
const IN_APP_RE = /NAVER|KAKAOTALK|Instagram|FBAN|FBAV|\bLine\/|DaumApps|; wv\)/;
export function isInAppBrowser(ua) {
  return IN_APP_RE.test(String(ua ?? ""));
}

// 플랫폼: "android" | "ios" | "other". (아이패드가 데스크톱 UA 를 쓰면 other 로 떨어진다 - 안내+복사로 처리됨)
export function detectPlatform(ua) {
  const s = String(ua ?? "");
  if (/Android/i.test(s)) return "android";
  if (/iPhone|iPad|iPod/.test(s)) return "ios";
  return "other";
}

// 안드로이드 크롬 intent 링크. 해시(#...)는 intent 문법과 충돌하므로 버린다.
// loc: { host, pathname, search } (location 객체 그대로 넘겨도 됨)
export function chromeIntentUrl(loc) {
  return "intent://" + loc.host + loc.pathname + (loc.search ?? "") + "#Intent;scheme=https;package=com.android.chrome;end";
}

// 인앱 탈출 화면 결정. 인앱이 아니면 null. 자동 이동은 하지 않고 버튼/안내만 만든다.
// 안드로이드 -> { kind: "intent", href } / 그 외(iOS 등) -> { kind: "copy" } (메뉴 안내 + 주소 복사)
export function inAppEscape(ua, loc) {
  if (!isInAppBrowser(ua)) return null;
  if (detectPlatform(ua) === "android") return { kind: "intent", href: chromeIntentUrl(loc) };
  return { kind: "copy" };
}

// inAppEscape 결과 하나로 문구를 고른다: first = 맨 위 안내, near = 다음 기한·등록 영역의 한 줄.
export function inAppTexts(esc) {
  if (!esc) return null;
  return esc.kind === "intent"
    ? { first: TEXT.inAppFirstIntent, near: TEXT.inAppNearIntent }
    : { first: TEXT.inAppFirstCopy, near: TEXT.inAppNearCopy };
}
