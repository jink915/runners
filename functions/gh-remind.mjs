// GitHub Actions 예비 실행용 (6시간마다 / 수동 테스트) — Cloud Functions와 같은 remind.js를 써요
import { initializeApp, cert } from "firebase-admin/app";
import { runRemind } from "./remind.js";
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
await runRemind({ test: process.env.TEST === "true" });
