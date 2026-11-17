// 수·목요일마다 GitHub Actions가 실행: 이번 주일 대표기도가 비어 있으면 그 주 사회자에게 푸시 알림
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const ADMINS = ["jink021124@gmail.com"];          // 사회자가 알림을 안 켰을 때 대신 받을 운영자
const APP = "https://jink915.github.io/runners/";
const TEST = process.env.TEST === "true";

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore(), fcm = getMessaging();

// 한국 시간 기준 다가오는 주일 (일요일에 돌면 다음 주)
const kst = new Date(Date.now() + 9 * 3600e3);
const sun = new Date(kst.getTime() + (((7 - kst.getUTCDay()) % 7) || 7) * 864e5);
const date = sun.toISOString().slice(0, 10);
const label = `${sun.getUTCMonth() + 1}월 ${sun.getUTCDate()}일`;

const snap = await db.doc(`weeks/${date}`).get();
const w = snap.exists ? snap.data() : {};
const mc = (w.mc || "").trim();
console.log(`${date}: event="${w.event || ""}" mc="${mc}" prayer="${w.prayer || ""}" test=${TEST}`);

if (!TEST && w.event) { console.log("러너스 예배가 없는 주 → 건너뜀"); process.exit(0); }
if (!TEST && w.prayer) { console.log("대표기도가 이미 정해짐 → 건너뜀"); process.exit(0); }

const all = (await db.collection("pushTokens").get()).docs.map(d => d.data());
let targets = mc ? all.filter(t => t.name === mc) : [];
let title = "대표기도 섭외 알림";
let body = `아직 대표기도가 세워지지 않았어요! 이번주(${label}) 대표기도 섭외를 진행해주세요:)`;
if (TEST) {
  targets = all.filter(t => ADMINS.includes(t.email));
  title = "[테스트] " + title;
  body = `알림이 잘 와요. 실제로는 사회자(${mc || "미정"})에게 이렇게 가요: ${body}`;
} else if (!targets.length) {
  targets = all.filter(t => ADMINS.includes(t.email));
  body = mc
    ? `${mc}님이 알림을 켜지 않아 대신 알려 드려요. ${label} 대표기도가 아직 정해지지 않았어요.`
    : `${label} 사회자와 대표기도가 아직 정해지지 않았어요.`;
}
const tokens = [...new Set(targets.map(t => t.token))];
if (!tokens.length) { console.log("알림을 받을 기기가 없어요 (앱 더보기 → 사회자 알림에서 켜야 해요)"); process.exit(0); }

const res = await fcm.sendEachForMulticast({
  tokens,
  data: { title, body, link: APP + "#dash", tag: "prayer-" + date },
  webpush: { headers: { Urgency: "high", TTL: "86400" } },
});
console.log(`보냄: 성공 ${res.successCount} / 실패 ${res.failureCount}`);
const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"];
await Promise.all(res.responses.map((r, i) => {
  if (r.success) return;
  console.log("실패:", r.error?.code);
  if (dead.includes(r.error?.code)) return db.doc(`pushTokens/${tokens[i]}`).delete();
}));
