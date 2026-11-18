// 러너스 Cloud Functions
//  · remindHourly: 매시 정각(한국 시간) 예약 알림
//  · onPost: 관리자가 게시판 글을 공지로 올리면 모두에게 알림
//  · chg*: 부서 내용이 바뀌면 같은 부서의 다른 운영자에게 알림
//  · deleteAccount: 본인 탈퇴 (계정과 내가 남긴 기록 삭제)
//  · onMember / onRequest / onExpenseWrite: 가입 신청·수정 요청·지출결의서가 들어오는 순간 알림
import { readFileSync } from "node:fs";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten, onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { notifyChange } from "./changes.js";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldPath, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";
import { runRemind } from "./remind.js";

let region = "asia-northeast3";
try { region = JSON.parse(readFileSync(new URL("./region.json", import.meta.url))).region || region; } catch {}
setGlobalOptions({ region, maxInstances: 2, memory: "256MiB", timeoutSeconds: 120 });
initializeApp();

export const remindHourly = onSchedule({ schedule: "0 * * * *", timeZone: "Asia/Seoul", retryCount: 0 }, () => runRemind());

const after = ev => ev.data?.after?.exists ? ev.data.after.data() : null;
export const onMember = onDocumentWritten("members/{id}", async ev => {
  const m = after(ev); if (m && m.status === "pending" && !m.notified) await runRemind({ instantOnly: true });
});
export const onRequest = onDocumentWritten("requests/{id}", async ev => {
  const r = after(ev); if (r && r.notified === false) await runRemind({ instantOnly: true });
});
export const onExpenseWrite = onDocumentWritten("expenses/{id}", async ev => {
  const e = after(ev); if (e && ((e.status === "submitted" && e.notified === false) || e.resultNotified === false)) await runRemind({ instantOnly: true });
});

// 공지: pinned가 false → true로 바뀌고 아직 안 알렸을 때만
export const onPost = onDocumentWritten("posts/{id}", async ev => {
  const b = ev.data?.before?.exists ? ev.data.before.data() : null, p = after(ev);
  if (p && p.pinned && !(b && b.pinned) && !p.noticeSent) await runRemind({ instantOnly: true, notice: { id: ev.params.id, title: p.title || "", body: p.body || "" } });
});

// 탈퇴: 로그인한 본인만. 승인된 지출결의서(장부에 기록된 회계 자료)는 남기고, 나머지 내 기록은 지워요
export const deleteAccount = onCall(async req => {
  const uid = req.auth?.uid; if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요해요");
  const db = getFirestore();
  const me = (await db.doc(`members/${uid}`).get()).data() || {};
  if (me.owner) throw new HttpsError("failed-precondition", "최고 관리자 계정은 탈퇴할 수 없어요");
  const name = (me.name || "").trim();
  const del = async q => { const s = await q.get(); await Promise.all(s.docs.map(d => db.recursiveDelete(d.ref))); return s.size; };
  const n = {};
  n.tokens = await del(db.collection("pushTokens").where("uid", "==", uid));
  n.requests = await del(db.collection("requests").where("uid", "==", uid));
  n.posts = await del(db.collection("posts").where("uid", "==", uid));   // 댓글까지 같이
  // 남의 글에 단 내 댓글
  n.comments = 0;
  for (const p of (await db.collection("posts").get()).docs) {
    const c = await p.ref.collection("comments").where("uid", "==", uid).get();
    if (c.empty) continue;
    await Promise.all(c.docs.map(d => d.ref.delete())); n.comments += c.size;
    await p.ref.update({ commentCount: FieldValue.increment(-c.size) }).catch(() => {});
  }
  // 지출결의서: 승인 전(검토 중·반려)만 지우기
  const ex = await db.collection("expenses").where("uid", "==", uid).get();
  const keep = ex.docs.filter(d => ["approved", "checked"].includes(d.data().status));
  await Promise.all(ex.docs.filter(d => !keep.includes(d)).map(d => db.recursiveDelete(d.ref)));
  n.expenses = ex.size - keep.length; n.expensesKept = keep.length;
  // 리더단 기록의 내 기도제목
  n.prayers = 0;
  if (name) for (const w of (await db.collection("teamWeeks").get()).docs) {
    const pr = w.data().prayers || {};
    if (Object.prototype.hasOwnProperty.call(pr, name)) { await w.ref.update(new FieldPath("prayers", name), FieldValue.delete()); n.prayers++; }
  }
  await db.doc(`profiles/${uid}`).delete().catch(() => {});
  await db.doc(`members/${uid}`).delete();
  await getAuth().deleteUser(uid).catch(() => {});
  console.log("탈퇴", uid, JSON.stringify(n));
  return { ok: true, ...n };
});

// 부서 변경 알림
export const chgSoldiers = onDocumentWrittenWithAuthContext("soldiers/{id}", ev => notifyChange("soldiers", ev));
export const chgBirthdays = onDocumentWrittenWithAuthContext("birthdays/{id}", ev => notifyChange("birthdays", ev));
export const chgWeeks = onDocumentWrittenWithAuthContext("weeks/{id}", ev => notifyChange("weeks", ev));
export const chgPeople = onDocumentWrittenWithAuthContext("people/{id}", ev => notifyChange("people", ev));
export const chgConfig = onDocumentWrittenWithAuthContext("config/{id}", ev => notifyChange("config", ev));
export const chgLedger = onDocumentWrittenWithAuthContext("ledger/{id}", ev => notifyChange("ledger", ev));
export const chgTeams = onDocumentWrittenWithAuthContext("teams/{id}", ev => notifyChange("teams", ev));
