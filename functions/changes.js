// 부서 변경 알림: 운영자 한 명이 부서 내용을 고치면, 같은 부서의 다른 운영자(관리자 포함)에게 알려요
//  · 고친 사람 본인에게는 안 보내요 (이벤트의 authId = 고친 사람 uid)
//  · 같은 사람이 같은 부서를 연달아 고치면(가져오기 등) 20초에 한 번만
//  · 각자 앱의 알림 설정에서 부서마다 켜고 끌 수 있어요 (chg_social 등)
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP = "https://jink915.github.io/runners/";
const DEPT_NAME = { social: "사회부", care: "챙김부", finance: "총무부", leaders: "리더단" };
const LINK = { social: "#schedule", care: "#birth", finance: "#ledger", leaders: "#lead" };
const won = n => (Math.round(n) || 0).toLocaleString("ko-KR");
const md = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "";
const BRANCH = { army: "육군", marine: "해병대", navy: "해군", air: "공군", social: "사회복무요원" };
const nm = x => (x?.name || "").trim();

// 컬렉션별: 부서, 알림 문장 (없으면 안 보냄)
export const WATCH = {
  soldiers: { dept: "care", what: "군입대", msg: (b, a) =>
    !b ? `🪖 ${nm(a)}님이 군입대에 등록되었어요! (${BRANCH[a.branch] || "군 복무"} · ${md(a.start)} 입대)`
    : !a ? `${nm(b)}님이 군입대 명단에서 빠졌어요`
    : `${nm(a)}님 군입대 정보가 바뀌었어요` },
  birthdays: { dept: "care", what: "생일", msg: (b, a) =>
    !b ? `🎂 생일 명단에 ${nm(a)}님이 추가됐어요 (${a.month}/${a.day})`
    : !a ? `생일 명단에서 ${nm(b)}님이 빠졌어요`
    : `${nm(a)}님 생일 정보가 바뀌었어요` },
  weeks: { dept: "social", what: "주일 일정", msg: (b, a, id) => {
    const d = (a || b)?.date || id;
    if (!a) return `${md(d)} 주일 일정을 지웠어요`;
    const F = [["event", "행사"], ["mc", "사회"], ["prayer", "대표기도"], ["hymn", "헌금찬송"]];
    const ch = F.filter(([k]) => (b?.[k] || "") !== (a[k] || "")).map(([k, l]) => `${l} ${a[k] || "비움"}`);
    if ((b?.mukdo || "") !== (a.mukdo || "") || (b?.offering || "") !== (a.offering || "")) ch.push("기도문 수정");
    return ch.length ? `📅 ${md(d)} 주일: ${ch.join(", ")}` : null; } },
  people: { dept: "social", what: "대표기도 명단", msg: (b, a) =>
    !b ? `대표기도 명단에 ${nm(a)}님이 추가됐어요` : !a ? `대표기도 명단에서 ${nm(b)}님이 빠졌어요` : null },
  config: { dept: "social", what: "기도제목", msg: (b, a, id) => id === "topics" && (b?.text || "") !== (a?.text || "") ? "🙏 사회 원고 기도제목이 바뀌었어요" : null },
  ledger: { dept: "finance", what: "장부", msg: (b, a) => {
    const r = a || b; const line = `${r.type === "in" ? "수입" : "지출"} ${won(r.amount)}원${r.cat ? ` · ${r.cat}` : ""}${r.memo ? ` ${r.memo}` : ""}`;
    return !b ? `💰 장부에 ${line}을 적었어요` : !a ? `장부에서 ${line}을 지웠어요` : `장부를 고쳤어요: ${line}`; } },
  teams: { dept: "leaders", what: "팀 명단", msg: (b, a) => {
    const t = (a || b)?.name || "팀"; const A = a?.members || [], B = b?.members || [];
    const plus = A.filter(x => !B.includes(x)), minus = B.filter(x => !A.includes(x));
    const parts = [...plus.map(x => `+${x}`), ...minus.map(x => `−${x}`)];
    if ((a?.leader || "") !== (b?.leader || "")) parts.push(`리더 ${a?.leader || "비움"}`);
    if ((a?.mentor || "") !== (b?.mentor || "")) parts.push(`멘토 ${a?.mentor || "비움"}`);
    return parts.length ? `👥 ${t} 명단: ${parts.slice(0, 6).join(", ")}${parts.length > 6 ? " 외" : ""}` : null; } },
};

const prefOn = (prefs, k) => { if (prefs.all === false) return false; const v = prefs[k]; return v && typeof v === "object" ? v.on !== false : v !== false; };
const editsDept = (m, d) => !!(m.owner || m.role === "admin" || (m.role === "operator" && (Array.isArray(m.depts) ? m.depts : ["social", "care"]).includes(d)));

export async function notifyChange(col, ev) {
  const w = WATCH[col]; if (!w) return;
  if (ev.authType !== "api_key" || !ev.authId) return;   // 앱에서 사람이 고친 것만 (서버 작업 제외)
  const b = ev.data?.before?.exists ? ev.data.before.data() : null, a = ev.data?.after?.exists ? ev.data.after.data() : null;
  const body = w.msg(b, a, ev.params.id); if (!body) return;
  const db = getFirestore(), actor = ev.authId, dept = w.dept;
  // 같은 사람·같은 부서는 20초에 한 번
  const th = db.doc(`chgThrottle/${dept}_${actor}`);
  const go = await db.runTransaction(async tx => { const s = await tx.get(th); const last = s.exists ? s.data().at?.toMillis?.() || 0 : 0;
    if (Date.now() - last < 20000) return false; tx.set(th, { at: FieldValue.serverTimestamp() }); return true; });
  if (!go) return;
  const members = Object.fromEntries((await db.collection("members").get()).docs.map(d => [d.id, d.data()]));
  const who = nm(members[actor]) || "누군가";
  const tokens = (await db.collection("pushTokens").get()).docs.map(d => d.data())
    .filter(t => t.uid !== actor && members[t.uid] && (members[t.uid].status === "approved" || members[t.uid].owner) && editsDept(members[t.uid], dept) && prefOn(t.prefs || {}, `chg_${dept}`));
  if (!tokens.length) return;
  const res = await getMessaging().sendEach(tokens.map(t => ({ token: t.token,
    data: { title: `${DEPT_NAME[dept]} · ${w.what}`, body: `${body} — ${who}`, link: APP + LINK[dept], tag: `runners-chg-${col}-${ev.params.id}` },
    webpush: { headers: { Urgency: "high", TTL: "21600" },
      notification: { title: `${DEPT_NAME[dept]} · ${w.what}`, body: `${body} — ${who}`, icon: APP + "icons/icon-192.png", badge: APP + "icons/icon-192.png", tag: `runners-chg-${col}-${ev.params.id}`, renotify: true },
      fcmOptions: { link: APP + LINK[dept] } } })));
  const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];
  await Promise.all(res.responses.map((r, i) => !r.success && dead.includes(r.error?.code) ? db.doc(`pushTokens/${tokens[i].token}`).delete().catch(() => {}) : null));
  console.log(`변경 알림 ${col}/${ev.params.id} → ${res.successCount}/${tokens.length}`);
}
