// 방문·버튼 사용 횟수 측정 (GoatCounter). 외부 스크립트 없이 문서화된 /count 픽셀(GET)을 직접 부른다.
// 근거: https://www.goatcounter.com/help/pixel  (p=경로/이벤트명, t=제목, r=리퍼러, e=이벤트, q=캠페인용 쿼리)
//       https://www.goatcounter.com/help/campaigns (utm_campaign / utm_source 등을 쿼리에서 자동 인식)
// 원칙: 코드가 비었거나 배포 주소가 아니면 아무것도 안 보낸다. 사용자 입력(답)은 절대 보내지 않는다.
//       이벤트 이름은 아래 고정 목록만. 전송 실패는 삼키고, 화면·버튼 동작에 영향 없다.
// app.js 가 이 파일을 동적 import 로 불러온다(차단돼도 도구는 그대로 동작). 도구별 복사본이며 공유하지 않는다.

export const GOATCOUNTER_CODE = "secondbranch"; // 예: "mycode" -> https://mycode.goatcounter.com/count. 비어 있으면 no-op.
export const COUNT_HOST = "secondbranch.kr"; // 이 호스트에서만 전송(로컬·미리보기 소음 차단)
export const FROM_PARAM = "tf_from"; // 인앱 -> 크롬 탈출로 온 방문 표식. 있으면 방문을 다시 세지 않는다(ui-logic.js 와 같은 이름)

export const EVENTS = Object.freeze({
  questionsDone: "tax-calendar-questions-done", // 필수 답이 처음 갖춰진 순간 1회
  icsDownload: "tax-calendar-ics",
  googleCalendar: "tax-calendar-gcal",
  openInChrome: "tax-calendar-open-chrome",
});
const ALLOWED = new Set(Object.values(EVENTS));
const CAMPAIGN_KEYS = ["utm_source", "utm_campaign"]; // GoatCounter 가 실제로 쓰는 두 개만

// 캠페인용 쿼리 문자열. utm_source·utm_campaign 만 남기고 값은 100자로 자른다. 없으면 "".
export function campaignQuery(search) {
  try {
    const params = new URLSearchParams(search || "");
    const out = new URLSearchParams();
    for (const k of CAMPAIGN_KEYS) if (params.has(k)) out.append(k, params.get(k).slice(0, 100));
    return out.toString();
  } catch {
    return "";
  }
}

// 리퍼러는 origin + pathname 으로 자른다(쿼리·해시 버림). 파싱 실패면 "".
export function trimReferrer(ref) {
  try {
    const u = new URL(ref);
    return u.origin === "null" ? "" : u.origin + u.pathname;
  } catch {
    return "";
  }
}

function countUrl(code, params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  u.set("rnd", Math.random().toString(36).slice(2, 8)); // 캐시 방지(문서상 무시되는 값)
  return `https://${code}.goatcounter.com/count?${u}`;
}

const defaultSend = (url) => { new Image().src = url; };

function active(env) {
  const code = env.code ?? GOATCOUNTER_CODE;
  if (!code || !/^[a-z0-9-]+$/i.test(code)) return null;
  if (env.location?.hostname !== COUNT_HOST) return null;
  return code;
}

// 방문 1회. env 는 테스트 주입용: { code, location, referrer, title, send }
export function trackPageview(env = {}) {
  try {
    const e = { location: globalThis.location, referrer: globalThis.document?.referrer, title: globalThis.document?.title, ...env };
    const code = active(e);
    if (!code) return;
    if (new URLSearchParams(e.location.search || "").has(FROM_PARAM)) return; // 인앱에서 이미 센 방문
    (e.send ?? defaultSend)(countUrl(code, {
      p: e.location.pathname,
      t: e.title,
      r: trimReferrer(e.referrer),
      q: campaignQuery(e.location.search),
    }));
  } catch { /* 측정 실패는 무시 */ }
}

// 버튼 사용 1회. 고정 목록 밖의 이름은 버린다.
export function trackEvent(name, env = {}) {
  try {
    if (!ALLOWED.has(name)) return;
    const e = { location: globalThis.location, ...env };
    const code = active(e);
    if (!code) return;
    (e.send ?? defaultSend)(countUrl(code, { p: name, t: name, e: "1" }));
  } catch { /* 측정 실패는 무시 */ }
}
