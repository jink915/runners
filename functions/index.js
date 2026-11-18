// 러너스 Cloud Functions
//  · remindHourly: 매시 정각(한국 시간) 예약 알림
//  · onMember / onRequest / onExpense: 가입 신청·수정 요청·지출결의서가 들어오는 순간 알림
import { readFileSync } from "node:fs";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
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
export const onExpense = onDocumentWritten("expenses/{id}", async ev => {
  const e = after(ev); if (e && ((e.status === "submitted" && e.notified === false) || e.resultNotified === false)) await runRemind({ instantOnly: true });
});
