// 세무 신고 달력 - 기한 계산 엔진 (ES 모듈, 외부 의존성 0)
// 날짜는 항상 'YYYY-MM-DD' 문자열 또는 UTC 기반으로만 다룬다. 로컬 시간대 API(getDay 등) 금지:
// 시간대에 따라 요일이 하루 밀린다.

// 알림 상수(한 곳): 종일 일정 시작(당일 0시) 기준. -P6DT15H = 1주 전 오전 9시, -PT15H = 전날 오전 9시.
// 삼성 캘린더에 두 알림이 등록되는 것을 실기로 확인함(실제 울림은 미확인).
export const ALARM_TRIGGERS = ["-P6DT15H", "-PT15H"];

const MAX_CARRY = 31; // 연쇄 이월 안전장치

const pad = (n) => String(n).padStart(2, "0");

function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error("날짜 형식 오류: " + s);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error("존재하지 않는 날짜: " + s);
  }
  return t;
}

function fmt(t) {
  const d = new Date(t);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

const DAY = 86400000;

export function addDays(iso, n) {
  return fmt(parseIso(iso) + n * DAY);
}

// 0=일 ... 6=토
export function weekday(iso) {
  return new Date(parseIso(iso)).getUTCDay();
}

// holidays: holidays-2027.json 객체({year, holidays:[...]}) 또는 {date} 배열.
// 반환 { set, year }. year 는 객체면 선언값, 배열이면 항목들의 연도(비면 null=검사 안 함).
// 어떤 형태든 모든 항목의 연도가 같아야 한다(다르면 예외).
function holidayInfo(holidays) {
  const isArr = Array.isArray(holidays);
  const list = isArr ? holidays : holidays.holidays;
  let year = isArr ? null : holidays.year;
  for (const h of list) {
    const y = Number(String(h.date).slice(0, 4));
    if (year === null) year = y;
    else if (y !== year) throw new Error("공휴일 데이터에 다른 연도 항목이 섞임: " + h.date + " (기준 " + year + ")");
  }
  return { set: new Set(list.map((h) => h.date)), year };
}

export function isRestDay(iso, holidays) {
  const wd = weekday(iso);
  return wd === 0 || wd === 6 || holidayInfo(holidays).set.has(iso);
}

// 국세기본법 5조: 토·일·공휴일·대체공휴일·노동절이면 그 다음날. 다음날도 쉬는 날이면 반복.
// 연도 경계 방침: 후보 날짜가 공휴일 데이터의 연도를 벗어나면(예: 12/31 이 쉬는 날이라 다음 해로 넘어감)
// 그 해 공휴일을 모르므로 조용히 계산하지 않고 예외를 던진다.
export function toDeadline(statutoryDate, holidays) {
  const { set, year } = holidayInfo(holidays);
  let d = statutoryDate;
  for (let i = 0; i < MAX_CARRY; i++) {
    if (year !== null && Number(d.slice(0, 4)) !== year) {
      throw new Error("공휴일 데이터(" + year + ")가 없는 연도로 넘어가 판정할 수 없음: " + statutoryDate + " -> " + d);
    }
    const wd = weekday(d);
    if (wd !== 0 && wd !== 6 && !set.has(d)) return d;
    d = addDays(d, 1);
  }
  throw new Error("이월 계산이 끝나지 않음: " + statutoryDate);
}

// 질문 키와 허용값의 유일한 정의. normalizeAnswers 와 규칙 파일 검증(validateRules)이 함께 쓴다.
const YNU = ["yes", "no", "unknown"];
export const QUESTIONS = {
  taxType: { allowed: ["general", "simplified", "exempt", "unknown"], default: "unknown" },
  simplifiedIssuedInvoiceH1: { allowed: YNU, default: "unknown" },
  hasEmployees: { allowed: ["yes", "no"] }, // 기본값 없음: 반드시 답해야 함
  withholdingSemiannual: { allowed: YNU, default: "unknown" },
  diligentFiling: { allowed: YNU, default: "unknown" },
};

export function normalizeAnswers(a) {
  const out = {};
  for (const [k, q] of Object.entries(QUESTIONS)) {
    const v = a[k] ?? q.default;
    if (!q.allowed.includes(v)) throw new Error(k + " 값 오류: " + v);
    out[k] = v;
  }
  return out;
}

const KINDS = ["신고", "납부", "고지납부"];
const STATUSES = ["✅", "⚠"];

function checkCond(ruleId, where, cond) {
  if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
    throw new Error("규칙 " + ruleId + ": " + where + " 는 객체여야 함");
  }
  for (const [k, vals] of Object.entries(cond)) {
    const q = QUESTIONS[k];
    if (!q) throw new Error("규칙 " + ruleId + ": " + where + " 에 모르는 질문 키 '" + k + "'");
    if (!Array.isArray(vals) || vals.length === 0) throw new Error("규칙 " + ruleId + ": " + where + "." + k + " 는 비지 않은 배열이어야 함");
    for (const v of vals) {
      if (!q.allowed.includes(v)) throw new Error("규칙 " + ruleId + ": " + where + "." + k + " 에 허용되지 않는 값 '" + v + "'");
    }
  }
}

// 규칙 파일 검증. 오타 하나가 기한을 조용히 지우는 일을 막으려고 deadlinesFor 가 매번 호출한다.
export function validateRules(rulesFile) {
  if (!rulesFile || !Number.isInteger(rulesFile.calendarYear) || !Array.isArray(rulesFile.rules)) {
    throw new Error("규칙 파일 형식 오류: calendarYear(정수)와 rules(배열) 필요");
  }
  const ids = new Set();
  for (const r of rulesFile.rules) {
    const id = r && r.id;
    if (typeof id !== "string" || !id) throw new Error("규칙에 id 가 없음");
    if (ids.has(id)) throw new Error("규칙 id 중복: " + id);
    ids.add(id);
    for (const f of ["name", "source", "note"]) {
      if (typeof r[f] !== "string" || !r[f]) throw new Error("규칙 " + id + ": 필수 필드 " + f + " 누락");
    }
    if (!KINDS.includes(r.kind)) throw new Error("규칙 " + id + ": kind 값 오류 " + r.kind);
    if (!STATUSES.includes(r.status)) throw new Error("규칙 " + id + ": status 값 오류 " + r.status);
    checkCond(id, "applies", r.applies);
    for (const n of r.noteIf ?? []) {
      checkCond(id, "noteIf.if", n.if);
      if (typeof n.text !== "string" || !n.text) throw new Error("규칙 " + id + ": noteIf.text 누락");
    }
    const kinds = ["dates", "monthly", "monthEnds"].filter((f) => r[f] !== undefined);
    if (kinds.length !== 1) throw new Error("규칙 " + id + ": dates, monthly, monthEnds 중 정확히 하나가 필요");
    const dk = kinds[0];
    if (dk === "monthly") {
      if (!(Number.isInteger(r.monthly) && r.monthly >= 1 && r.monthly <= 28)) throw new Error("규칙 " + id + ": monthly 는 1-28 정수");
    } else if (!Array.isArray(r[dk]) || r[dk].length === 0) {
      throw new Error("규칙 " + id + ": " + dk + " 는 비지 않은 배열이어야 함");
    }
    for (const d of r.dates ?? []) {
      if (typeof d.md !== "string" || !/^\d\d-\d\d$/.test(d.md)) throw new Error("규칙 " + id + ": 날짜 형식 오류 " + d.md);
      parseIso(rulesFile.calendarYear + "-" + d.md); // 없는 날짜(02-30 등)면 예외
    }
    for (const m of r.monthEnds ?? []) {
      if (typeof m.month !== "string" || !/^(0[1-9]|1[0-2])$/.test(m.month)) throw new Error("규칙 " + id + ": monthEnds.month 형식 오류 " + m.month);
    }
  }
}

// cond: { 키: [허용값, ...] } 모두 맞아야 true (키·값은 validateRules 가 보장)
function matches(cond, answers) {
  return Object.entries(cond ?? {}).every(([k, allowed]) => allowed.includes(answers[k]));
}

function occurrences(rule, year) {
  if (rule.monthly) {
    return Array.from({ length: 12 }, (_, i) => ({
      md: pad(i + 1) + "-" + pad(rule.monthly),
      label: (i === 0 ? "전년 12" : String(i)) + "월 징수분",
    }));
  }
  if (rule.monthEnds) {
    // 해당 월의 말일: 다음 달 0일 = 이번 달 마지막 날. 없는 날짜(2월 30일 등)가 생기지 않는다.
    return rule.monthEnds.map((m) => ({
      md: m.month + "-" + pad(new Date(Date.UTC(year, Number(m.month), 0)).getUTCDate()),
      label: m.label,
    }));
  }
  return rule.dates;
}

// 반환: 날짜순(같은 날은 id순) 목록. 각 항목에 법정 날짜(statutoryDate)와 실제 기한(deadline) 모두 담는다.
export function deadlinesFor(answers, rulesFile, holidays) {
  validateRules(rulesFile);
  const a = normalizeAnswers(answers);
  const year = rulesFile.calendarYear;
  const hy = holidayInfo(holidays).year;
  if (hy !== null && hy !== year) {
    throw new Error("공휴일 데이터 연도(" + hy + ")가 달력 연도(" + year + ")와 다름");
  }
  const events = [];
  for (const rule of rulesFile.rules) {
    if (!matches(rule.applies, a)) continue;
    const notes = [rule.note];
    for (const n of rule.noteIf ?? []) if (matches(n.if, a)) notes.push(n.text);
    for (const occ of occurrences(rule, year)) {
      const statutoryDate = year + "-" + occ.md;
      const deadline = toDeadline(statutoryDate, holidays);
      const shifted = deadline !== statutoryDate;
      events.push({
        ruleId: rule.id,
        title: rule.name + (occ.label ? " - " + occ.label : ""),
        kind: rule.kind,
        statutoryDate,
        deadline,
        shifted,
        notes: shifted
          ? [...notes, "법정 기한 " + statutoryDate + "이(가) 쉬는 날이라 " + deadline + "로 넘어갑니다."]
          : notes,
        status: rule.status,
        source: rule.source,
      });
    }
  }
  events.sort((x, y) =>
    x.deadline < y.deadline ? -1 : x.deadline > y.deadline ? 1 : x.ruleId < y.ruleId ? -1 : x.ruleId > y.ruleId ? 1 : 0
  );
  return events;
}

// 화면용 묶음: 일정 + 범위 고지(항상 함께 보여 줄 것) + 이월 안내문
export function buildCalendar(answers, rulesFile, holidays) {
  const events = deadlinesFor(answers, rulesFile, holidays);
  if (!rulesFile.scopeNotice) throw new Error("규칙 파일에 scopeNotice(범위 고지)가 없음");
  return { events, scopeNotice: rulesFile.scopeNotice, carryOverNote: rulesFile.carryOverNote };
}

// 한국 표준시(UTC+9, 서머타임 없음) 기준 오늘 날짜 'YYYY-MM-DD'. 실행 환경의 시간대와 무관.
// new Date().toISOString().slice(0,10) 은 UTC 날짜라 한국 오전 9시 전에는 어제로 나온다.
export function todayKst(now) {
  return fmt((now ?? new Date()).getTime() + 9 * 3600000);
}

// ---------- .ics ----------

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545: 75 옥텟 초과 줄은 CRLF + 공백으로 접는다(UTF-8 글자 중간은 자르지 않음).
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curLen + n > limit) {
      parts.push(cur);
      cur = "";
      curLen = 0;
      limit = 74; // 이어지는 줄은 앞 공백 1옥텟 포함
    }
    cur += ch;
    curLen += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const compact = (iso) => iso.replace(/-/g, "");

function eventDescription(ev) {
  return (ev.notes ?? []).join("\n");
}

function stamp(now) {
  const d = now ?? new Date();
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"
  );
}

// events: deadlinesFor 결과. now 는 테스트용(DTSTAMP 고정).
// UID = 규칙 id + 법정 날짜 (휴일 데이터가 바뀌어도 같은 일정으로 갱신됨).
// 반복 규칙(RRULE)은 쓰지 않는다: 이월 때문에 회차마다 날짜가 다르다.
export function toIcs(events, now) {
  const dtstamp = stamp(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ToolForge//tax-calendar//KO", "CALSCALE:GREGORIAN"];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + ev.ruleId + "-" + ev.statutoryDate + "@tax-calendar.toolforge",
      "DTSTAMP:" + dtstamp,
      "DTSTART;VALUE=DATE:" + compact(ev.deadline),
      "DTEND;VALUE=DATE:" + compact(addDays(ev.deadline, 1)),
      "SUMMARY:" + icsEscape(ev.title),
      "DESCRIPTION:" + icsEscape(eventDescription(ev)),
      "TRANSP:TRANSPARENT",
      ...ALARM_TRIGGERS.flatMap((t) => ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(ev.title), "TRIGGER:" + t, "END:VALARM"]),
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------- 구글 캘린더 ----------

export function googleCalendarUrl(ev) {
  const dates = compact(ev.deadline) + "/" + compact(addDays(ev.deadline, 1));
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(ev.title) +
    "&dates=" + dates +
    "&details=" + encodeURIComponent(eventDescription(ev))
  );
}
