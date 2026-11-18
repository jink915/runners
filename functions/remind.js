// 러너스 알림 (Cloud Functions에서 실행)
//  · 매시 정각: 각자 고른 요일·시각의 예약 알림 + 들어온 알림
//  · 문서가 바뀔 때(가입 신청·수정 요청·지출결의서): 들어온 알림만 즉시
// scripts/remind.mjs(GitHub Actions)와 같은 로직이에요. 바꿀 땐 둘 다 맞춰 주세요.
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP = "https://jink915.github.io/runners/";
const DEFAULTS = {   // 앱의 ALERTS 기본값과 같게
  prayer: { days: [3, 4], hour: 12 }, hymn: { days: [3, 4], hour: 12 }, script: { days: [3, 4], hour: 12 },
  mcDay: { days: [6], hour: 20 }, prayDay: { days: [6], hour: 20 }, fallback: { days: [3, 4], hour: 12 },
  bdToday: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 }, bdWeek: { days: [1], hour: 9 },
  join: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 }, request: { days: [0, 1, 2, 3, 4, 5, 6], hour: 9 },
  expense: { days: [0, 1, 2, 3, 4, 5, 6], hour: 0 }, expResult: { days: [0, 1, 2, 3, 4, 5, 6], hour: 0 },
};
const ALL_DEPTS = ["social", "care"];
const HONOR = { "목자": "목자님", "형제": "형제님", "자매": "자매님" };

export async function runRemind({ instantOnly = false, test = false } = {}) {
  const INSTANT_ONLY = instantOnly, TEST = test;
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
  if (!INSTANT_ONLY) try { sermon = (await (await fetch(APP + "data/sermons.json", { cache: "no-store" })).json())[date] || {}; } catch {}
  const mc = (w.mc || "").trim(), prayer = (w.prayer || "").trim();
  const hasScript = !!((w.mukdo || sermon.mukdo) && (w.offering || sermon.offering));
  console.log(`[${INSTANT_ONLY ? "instant" : "hourly"}] now ${today} ${hour}시 (요일 ${dow}) → 주일 ${date} | test=${TEST} event="${w.event || ""}" mc="${mc}" prayer="${prayer}" hymn="${w.hymn || ""}" script=${hasScript}`);

  // 기기: 이름·권한은 멤버 정보에서 최신으로 (승인된 멤버만)
  const members = Object.fromEntries((await db.collection("members").get()).docs.map(d => [d.id, d.data()]));
  const devices = (await db.collection("pushTokens").get()).docs.map(d => d.data())
    .map(t => ({ ...t, m: members[t.uid] }))
    .filter(t => t.m && (t.m.status === "approved" || t.m.owner))
    .map(t => {
      const admin = !!(t.m.owner || t.m.role === "admin");
      const depts = admin ? ALL_DEPTS : Array.isArray(t.m.depts) ? t.m.depts : ALL_DEPTS;   // 예전 멤버는 모든 부서
      const editFinance = admin || (t.m.role === "operator" && Array.isArray(t.m.depts) && t.m.depts.includes("finance"));
      return { token: t.token, uid: t.uid, name: (t.m.name || "").trim(), admin, depts, editFinance,
        editSocial: admin || (t.m.role === "operator" && depts.includes("social")), prefs: t.prefs || {} };
    });
  const pref = (d, k) => {
    const v = d.prefs[k], def = DEFAULTS[k];
    if (v && typeof v === "object") return { on: v.on !== false, days: Array.isArray(v.days) && v.days.length ? v.days : def.days, hour: Number.isInteger(v.hour) ? v.hour : def.hour };
    return { on: v !== false, ...def };
  };
  const enabled = (d, k) => d.prefs.all !== false && pref(d, k).on;
  const INSTANT = new Set(["join", "request", "expense", "expResult"]);   // 가입 신청·수정 요청은 시간 상관없이 바로
  const dueNow = (d, k) => { if (INSTANT.has(k)) return enabled(d, k); const p = pref(d, k); return enabled(d, k) && p.days.includes(dow) && hour >= p.hour; };
  // 사회·대표기도 차례 알림은 이름으로 가니까 부서와 상관없이, 생일 알림은 승인된 멤버 모두에게
  const social = devices;
  const care = devices;
  const byName = n => n ? social.filter(d => d.name === n) : [];

  // 보낼 알림: 항목 하나 = 알림 하나 (기기마다)
  //  key  = 예약 알림 발송 기록(sentAlerts) — 같은 날 두 번 안 가게
  //  mark = 보낸 뒤 표시할 문서 [경로, 필드] — 들어온 알림을 한 번만 보내게
  const msgs = [];
  const add = (d, m) => msgs.push({ d, ...m });
  if (TEST) {
    for (const d of devices.filter(d => d.admin)) add(d, { title: "[테스트] 러너스 알림", body: `알림이 잘 와요. ${when} 사회 ${mc || "미정"}, 대표기도 ${prayer || "미정"}.`, link: "#dash", tag: "test" });
  } else {
    if (!INSTANT_ONLY) {
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
    due.forEach(([d, k, line], i) => { if (sent[i].exists) return; const bd = k === "bdToday" || k === "bdWeek";
      add(d, { title: bd ? "러너스 생일 알림" : `주일 준비 알림 · ${label}`, body: line, link: bd ? "#birth" : "#dash", tag: `${k}-${today}`, key: keyOf(d, k) }); });

    }
    // 관리자: 새 가입 신청·수정 요청 (한 번 알리면 notified 표시)
    const admins = devices.filter(d => d.admin);
    const newJoins = Object.entries(members).filter(([, m]) => m.status === "pending" && !m.notified);
    const newReqs = (await db.collection("requests").where("notified", "==", false).get()).docs;
    const CAT = { bug: "오류·불편", idea: "기능 제안", etc: "기타" };
    for (const d of admins) {
      if (dueNow(d, "join")) for (const [id, m] of newJoins)
        add(d, { title: "가입 신청", body: `${m.name || m.email}님이 가입을 신청했어요. 멤버 관리에서 승인해 주세요.`, link: "#members", tag: `join-${id}`, mark: [`members/${id}`, "notified"] });
      if (dueNow(d, "request")) for (const x of newReqs) { const r = x.data();
        add(d, { title: `수정 요청 · ${CAT[r.cat] || "기타"}`, body: `${r.name || "멤버"}: ${String(r.text || "").split("\n")[0].slice(0, 80)}`, link: "#requests", tag: `req-${x.id}`, mark: [`requests/${x.id}`, "notified"] }); }
    }
    // 총무부: 새 지출결의서 / 작성자: 승인·반려 결과
    const newExps = (await db.collection("expenses").where("notified", "==", false).get()).docs.filter(x => x.data().status === "submitted");
    const results = (await db.collection("expenses").where("resultNotified", "==", false).get()).docs;
    const won = n => (Math.round(n) || 0).toLocaleString("ko-KR");
    for (const d of devices.filter(d => d.editFinance && dueNow(d, "expense"))) for (const x of newExps) { const e = x.data();
      add(d, { title: "지출결의서 도착", body: `${e.name || "멤버"} · ${e.title} ${won(e.amount)}원 — 검토 후 승인·반려해 주세요.`, link: "#expReview", tag: `exp-${x.id}`, mark: [`expenses/${x.id}`, "notified"] }); }
    for (const x of results) {
      const e = x.data(); const ok = e.status === "approved";
      for (const d of devices.filter(d => d.uid === e.uid && dueNow(d, "expResult")))
        add(d, { title: ok ? "지출결의서 승인" : "지출결의서 반려", body: ok ? `'${e.title}' ${won(e.amount)}원이 승인됐어요.` : `'${e.title}'이(가) 반려됐어요. 사유: ${String(e.rejectReason || "").slice(0, 60)}`, link: "#expenses", tag: `expres-${x.id}-${e.status}`, mark: [`expenses/${x.id}`, "resultNotified"] });
    }
  }

  if (!msgs.length) { console.log("지금 보낼 알림이 없어요"); }
  else {
    const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"];
    const okKeys = new Set(), okMarks = new Map(), deadTokens = new Set(); let ok = 0, fail = 0;
    for (let i = 0; i < msgs.length; i += 500) {
      const chunk = msgs.slice(i, i + 500);
      const res = await fcm.sendEach(chunk.map(m => ({ token: m.d.token,
        data: { title: m.title, body: m.body, link: APP + m.link, tag: `runners-${m.tag}` },
        webpush: { headers: { Urgency: "high", TTL: "21600" } } })));
      res.responses.forEach((r, k) => { const m = chunk[k];
        if (r.success) { ok++; if (m.key) okKeys.add(m.key); if (m.mark) okMarks.set(m.mark.join("|"), m.mark); }
        else { fail++; console.log("실패:", r.error?.code); if (dead.includes(r.error?.code)) deadTokens.add(m.d.token); } });
    }
    console.log(`보냄: 알림 ${msgs.length}개 · 성공 ${ok} / 실패 ${fail}`);
    const batch = db.batch();
    for (const k of okKeys) batch.set(db.doc(`sentAlerts/${k}`), { day: today, at: new Date() });
    for (const [path, field] of okMarks.values()) batch.update(db.doc(path), { [field]: true });
    for (const t of deadTokens) batch.delete(db.doc(`pushTokens/${t}`));
    await batch.commit();
  }
  // 2주 지난 발송 기록 정리
  if (!INSTANT_ONLY) {
  const old = await db.collection("sentAlerts").where("day", "<", new Date(kst.getTime() - 14 * 864e5).toISOString().slice(0, 10)).get();
  if (!old.empty) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); console.log(`오래된 기록 ${old.size}개 정리`); }
  }

}
