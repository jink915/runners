// GitHub Actions가 매시간 실행하는 주일 준비 알림
// 각자 앱(더보기 → 알림)에서 고른 종류·요일·시각에 맞춰 보내요.
//  · 그 요일의 고른 시각이 지났고, 그날 아직 안 보냈으면 보냄 (실행이 조금 늦어도 놓치지 않게)
//  · 요일은 "다가오는 주일" 기준 (일요일 당일이면 그날 주일)
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP = "https://jink915.github.io/runners/";
const TEST = process.env.TEST === "true";
const DEFAULTS = {   // 앱의 ALERTS 기본값과 같게
  prayer: { days: [3, 4], hour: 12 }, hymn: { days: [3, 4], hour: 12 }, script: { days: [3, 4], hour: 12 },
  mcDay: { days: [6], hour: 20 }, prayDay: { days: [6], hour: 20 }, fallback: { days: [3, 4], hour: 12 },
  bdToday: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 }, bdWeek: { days: [1], hour: 9 },
  join: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 }, request: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 },
};
const ALL_DEPTS = ["social", "care"];
const HONOR = { "목자": "목자님", "형제": "형제님", "자매": "자매님" };

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore(), fcm = getMessaging();

// 한국 시간
const kst = new Date(Date.now() + 9 * 3600e3);
const dow = kst.getUTCDay(), hour = kst.getUTCHours();
const today = kst.toISOString().slice(0, 10);
const until = (7 - dow) % 7;                       // 다가오는 주일까지 남은 날 (일요일이면 0)
const sun = new Date(kst.getTime() + until * 864e5);
const date = sun.toISOString().slice(0, 10);
const label = `${sun.getUTCMonth() + 1}월 ${sun.getUTCDate()}일`;
const when = until === 0 ? "오늘" : until === 1 ? "내일" : `이번 주일(${label})`;

const snap = await db.doc(`weeks/${date}`).get();
const w = snap.exists ? snap.data() : {};
let sermon = {};
try { sermon = JSON.parse(readFileSync(new URL("../data/sermons.json", import.meta.url)))[date] || {}; } catch {}
const mc = (w.mc || "").trim(), prayer = (w.prayer || "").trim();
const hasScript = !!((w.mukdo || sermon.mukdo) && (w.offering || sermon.offering));
console.log(`now ${today} ${hour}시 (요일 ${dow}) → 주일 ${date} | test=${TEST} event="${w.event || ""}" mc="${mc}" prayer="${prayer}" hymn="${w.hymn || ""}" script=${hasScript}`);

// 기기: 이름·권한은 멤버 정보에서 최신으로 (승인된 멤버만)
const members = Object.fromEntries((await db.collection("members").get()).docs.map(d => [d.id, d.data()]));
const devices = (await db.collection("pushTokens").get()).docs.map(d => d.data())
  .map(t => ({ ...t, m: members[t.uid] }))
  .filter(t => t.m && (t.m.status === "approved" || t.m.owner))
  .map(t => {
    const admin = !!(t.m.owner || t.m.role === "admin");
    const depts = admin ? ALL_DEPTS : Array.isArray(t.m.depts) ? t.m.depts : ALL_DEPTS;   // 예전 멤버는 모든 부서
    return { token: t.token, name: (t.m.name || "").trim(), admin, depts,
      editSocial: admin || (t.m.role === "operator" && depts.includes("social")), prefs: t.prefs || {} };
  });
const pref = (d, k) => {
  const v = d.prefs[k], def = DEFAULTS[k];
  if (v && typeof v === "object") return { on: v.on !== false, days: Array.isArray(v.days) && v.days.length ? v.days : def.days, hour: Number.isInteger(v.hour) ? v.hour : def.hour };
  return { on: v !== false, ...def };
};
const enabled = (d, k) => d.prefs.all !== false && pref(d, k).on;
const dueNow = (d, k) => { const p = pref(d, k); return enabled(d, k) && p.days.includes(dow) && hour >= p.hour; };
const social = devices.filter(d => d.depts.includes("social"));
const care = devices.filter(d => d.depts.includes("care"));
const byName = n => n ? social.filter(d => d.name === n) : [];

const out = new Map();   // token → { lines[], keys[] }
const flags = new Map(); // token → Set("join"|"request")  관리자 알림을 실제로 받은 기기
const flag = (d, k) => { const f = flags.get(d.token) || new Set(); f.add(k); flags.set(d.token, f); };
let inbox = { joins: [], reqs: [] };
const add = (d, key, line) => { const o = out.get(d.token) || { lines: [], keys: [] }; o.lines.push(line); o.keys.push(key); out.set(d.token, o); };

if (TEST) {
  for (const d of devices.filter(d => d.admin)) add(d, null, `알림이 잘 와요. ${when} 사회 ${mc || "미정"}, 대표기도 ${prayer || "미정"}.`);
} else {
  // 후보 알림 모으기
  const cands = [];
  if (!w.event) {
  const mcDevices = byName(mc);
  for (const d of mcDevices) {
    if (!prayer) cands.push([d, "prayer", `아직 대표기도가 세워지지 않았어요! ${until >= 2 ? `이번주(${label})` : when} 대표기도 섭외를 진행해주세요:)`]);
    if (!w.hymn) cands.push([d, "hymn", "헌금찬송이 아직 비어 있어요. 찬송가를 골라 앱에 적어 주세요."]);
    if (!hasScript) cands.push([d, "script", "묵도·헌금기도 문장이 아직 비어 있어요. 원고 화면의 '내용 고치기'에서 작성해 주세요."]);
    cands.push([d, "mcDay", `${when} 사회 차례예요. 사회 원고를 미리 확인해 주세요.`]);
  }
  for (const d of byName(prayer)) cands.push([d, "prayDay", `${when} 대표기도 차례예요. 기도 준비 부탁드려요.`]);
  if (!prayer && !mcDevices.some(d => enabled(d, "prayer"))) {
    const why = mc ? `${mc}님이 대표기도 알림을 켜지 않아 대신 알려 드려요. ` : "사회자도 아직 정해지지 않았어요. ";
    for (const d of social.filter(d => d.editSocial)) cands.push([d, "fallback", `${why}${label} 대표기도가 아직 세워지지 않았어요.`]);
  }
  }
  // 챙김부: 생일
  const bds = (await db.collection("birthdays").get()).docs.map(d => d.data()).filter(b => b.month && b.day && b.name);
  const y = kst.getUTCFullYear();
  const nextOf = b => { const last = new Date(Date.UTC(y, b.month, 0)).getUTCDate(); let d = Date.UTC(y, b.month - 1, Math.min(b.day, last));
    const t0 = Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate()); if (d < t0) d = Date.UTC(y + 1, b.month - 1, Math.min(b.day, new Date(Date.UTC(y + 1, b.month, 0)).getUTCDate()));
    return Math.round((d - t0) / 864e5); };
  const who = b => `${b.name} ${HONOR[b.role] || "님"}`.replace(/ 님$/, "님");
  const todays = bds.filter(b => nextOf(b) === 0);
  const week = bds.map(b => ({ b, dd: nextOf(b) })).filter(x => x.dd <= 6).sort((a, b) => a.dd - b.dd);
  for (const d of care) {
    if (todays.length) cands.push([d, "bdToday", `🎂 오늘은 ${todays.map(who).join(", ")} 생일이에요! 축하 메시지를 보내 주세요.`]);
    if (week.length) cands.push([d, "bdWeek", `이번 주 생일 ${week.length}명: ` + week.map(({ b, dd }) => `${b.month}/${b.day} ${b.name}${dd === 0 ? "(오늘)" : ""}`).join(", ")]);
  }
  // 지금 보낼 차례이고 오늘 아직 안 보낸 것만
  const due = cands.filter(([d, k]) => dueNow(d, k));
  const keyOf = (d, k) => `${today}_${k}_${d.token.slice(-48).replace(/[^A-Za-z0-9_-]/g, "")}`;
  const sent = await Promise.all(due.map(([d, k]) => db.doc(`sentAlerts/${keyOf(d, k)}`).get()));
  due.forEach(([d, k, line], i) => { if (!sent[i].exists) add(d, keyOf(d, k), line); });

  // 관리자: 새 가입 신청·수정 요청 (한 번 알리면 notified 표시)
  const admins = devices.filter(d => d.admin);
  const newJoins = Object.entries(members).filter(([, m]) => m.status === "pending" && !m.notified);
  const newReqs = (await db.collection("requests").where("notified", "==", false).get()).docs;
  const CAT = { bug: "오류·불편", idea: "기능 제안", etc: "기타" };
  for (const d of admins) {
    if (newJoins.length && dueNow(d, "join"))
      add(d, null, `가입 신청 ${newJoins.length}명: ${newJoins.map(([, m]) => m.name || m.email).join(", ")} — 더보기 → 멤버 관리에서 승인해 주세요.`), flag(d, "join");
    if (newReqs.length && dueNow(d, "request"))
      add(d, null, `새 수정 요청 ${newReqs.length}건: ` + newReqs.slice(0, 3).map(x => { const r = x.data(); return `${r.name || "멤버"}(${CAT[r.cat] || "기타"}) ${String(r.text || "").split("\n")[0].slice(0, 30)}`; }).join(" / ") + (newReqs.length > 3 ? " 외" : "")), flag(d, "request");
  }
  inbox = { joins: newJoins.map(([id]) => id), reqs: newReqs.map(x => x.id) };
}

if (!out.size) { console.log("지금 보낼 알림이 없어요"); }
else {
  const tokens = [...out.keys()];
  const kind = k => k === null ? "admin" : /_bd(Today|Week)_/.test(k) ? "birth" : "social";
  const titleOf = keys => { const ks = new Set(keys.map(kind)); if (ks.size > 1) return "러너스 알림";
    return ks.has("admin") ? "러너스 관리자 알림" : ks.has("birth") ? "러너스 생일 알림" : `주일 준비 알림 · ${label}`; };
  const res = await fcm.sendEach(tokens.map(token => {
    const o = out.get(token);
    return { token, data: { title: TEST ? "[테스트] 러너스 알림" : titleOf(o.keys), body: o.lines.join("\n"), link: APP + (flags.has(token) && o.keys.every(k => k === null) ? (flags.get(token).has("join") ? "#members" : "#requests") : o.keys.every(k => /_bd(Today|Week)_/.test(k)) ? "#birth" : "#dash"), tag: `runners-${today}-${hour}` },
      webpush: { headers: { Urgency: "high", TTL: "21600" } } };
  }));
  console.log(`보냄: 성공 ${res.successCount} / 실패 ${res.failureCount}`);
  const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"];
  const batch = db.batch();
  res.responses.forEach((r, i) => {
    const o = out.get(tokens[i]);
    if (r.success) {
      for (const k of o.keys) if (k) batch.set(db.doc(`sentAlerts/${k}`), { day: today, at: new Date() });
      const f = flags.get(tokens[i]);
      if (f?.has("join")) for (const id of inbox.joins) batch.update(db.doc(`members/${id}`), { notified: true });
      if (f?.has("request")) for (const id of inbox.reqs) batch.update(db.doc(`requests/${id}`), { notified: true });
    }
    else { console.log("실패:", r.error?.code); if (dead.includes(r.error?.code)) batch.delete(db.doc(`pushTokens/${tokens[i]}`)); }
  });
  await batch.commit();
}

// 2주 지난 발송 기록 정리
const old = await db.collection("sentAlerts").where("day", "<", new Date(kst.getTime() - 14 * 864e5).toISOString().slice(0, 10)).get();
if (!old.empty) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); console.log(`오래된 기록 ${old.size}개 정리`); }
