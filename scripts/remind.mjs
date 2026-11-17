// GitHub Actions가 정해진 시간에 실행하는 주일 준비 알림
//  · 수·목 낮 12시: 이번 주일 사회자에게 비어 있는 준비물(대표기도·헌금찬송·기도문) 알림
//  · 토 저녁 8시: 내일 사회자·대표기도자에게 전날 알림
// 각자 앱의 더보기 → 알림에서 고른 종류만 받아요.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP = "https://jink915.github.io/runners/";
const TEST = process.env.TEST === "true";

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore(), fcm = getMessaging();

// 한국 시간 기준 요일과 다가오는 주일
const kst = new Date(Date.now() + 9 * 3600e3);
const dow = kst.getUTCDay();
const MODE = process.env.MODE || (dow === 6 ? "eve" : "check");
const sun = new Date(kst.getTime() + (((7 - dow) % 7) || 7) * 864e5);
const date = sun.toISOString().slice(0, 10);
const label = `${sun.getUTCMonth() + 1}월 ${sun.getUTCDate()}일`;

const snap = await db.doc(`weeks/${date}`).get();
const w = snap.exists ? snap.data() : {};
let sermon = {};
try { sermon = JSON.parse(readFileSync(new URL("../data/sermons.json", import.meta.url)))[date] || {}; } catch {}
const mc = (w.mc || "").trim(), prayer = (w.prayer || "").trim();
const hasScript = !!((w.mukdo || sermon.mukdo) && (w.offering || sermon.offering));
console.log(`${date} mode=${MODE} test=${TEST} event="${w.event || ""}" mc="${mc}" prayer="${prayer}" hymn="${w.hymn || ""}" script=${hasScript}`);
if (!TEST && w.event) { console.log("러너스 예배가 없는 주 → 건너뜀"); process.exit(0); }

// 기기 목록: 이름·권한은 멤버 정보에서 최신으로 가져와요 (승인된 멤버만)
const members = Object.fromEntries((await db.collection("members").get()).docs.map(d => [d.id, d.data()]));
const devices = (await db.collection("pushTokens").get()).docs.map(d => d.data())
  .map(t => ({ ...t, m: members[t.uid] }))
  .filter(t => t.m && (t.m.status === "approved" || t.m.owner))
  .map(t => ({ token: t.token, name: (t.m.name || "").trim(), admin: !!(t.m.owner || t.m.role === "admin"), prefs: t.prefs || {} }));
const want = (d, k) => d.prefs[k] !== false;   // 설정이 없으면 켜진 것으로
const byName = n => n ? devices.filter(d => d.name === n) : [];
const admins = devices.filter(d => d.admin);

const LINES = {
  prayer: `아직 대표기도가 세워지지 않았어요! 이번주(${label}) 대표기도 섭외를 진행해주세요:)`,
  hymn: `헌금찬송이 아직 비어 있어요. 찬송가를 골라 앱에 적어 주세요.`,
  script: `묵도·헌금기도 문장이 아직 비어 있어요. 원고 화면의 '내용 고치기'에서 작성해 주세요.`,
};
const out = new Map();   // token → {title, lines[]}
const add = (d, title, line) => { const o = out.get(d.token) || { title, lines: [] }; o.lines.push(line); out.set(d.token, o); };

if (TEST) {
  for (const d of admins) add(d, "[테스트] 주일 준비 알림", `알림이 잘 와요. 이번 주(${label}) 사회 ${mc || "미정"}, 대표기도 ${prayer || "미정"}.`);
} else if (MODE === "check") {
  const missing = [!prayer && "prayer", !w.hymn && "hymn", !hasScript && "script"].filter(Boolean);
  const mcDevices = byName(mc);
  for (const d of mcDevices) for (const k of missing) if (want(d, k)) add(d, `주일 준비 알림 · ${label}`, LINES[k]);
  if (!prayer && !mcDevices.length) {
    const why = mc ? `${mc}님이 알림을 켜지 않아 대신 알려 드려요. ` : "사회자도 아직 정해지지 않았어요. ";
    for (const d of admins) if (want(d, "fallback")) add(d, `주일 준비 알림 · ${label}`, why + `${label} 대표기도가 아직 세워지지 않았어요.`);
  }
} else if (MODE === "eve") {
  for (const d of byName(mc)) if (want(d, "mcDay")) add(d, "내일 사회예요", `내일(${label}) 사회 차례예요. 사회 원고를 미리 확인해 주세요.`);
  for (const d of byName(prayer)) if (want(d, "prayDay")) add(d, "내일 대표기도예요", `내일(${label}) 대표기도 차례예요. 기도 준비 부탁드려요.`);
}

if (!out.size) { console.log("보낼 알림이 없어요"); process.exit(0); }
const tokens = [...out.keys()];
const res = await fcm.sendEach(tokens.map(token => {
  const o = out.get(token);
  return { token, data: { title: o.title, body: o.lines.join("\n"), link: APP + "#dash", tag: `${MODE}-${date}` },
    webpush: { headers: { Urgency: "high", TTL: "86400" } } };
}));
console.log(`보냄: 성공 ${res.successCount} / 실패 ${res.failureCount}`);
const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"];
await Promise.all(res.responses.map((r, i) => {
  if (r.success) return;
  console.log("실패:", r.error?.code);
  if (dead.includes(r.error?.code)) return db.doc(`pushTokens/${tokens[i]}`).delete();
}));
