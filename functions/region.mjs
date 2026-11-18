// 배포 전에 Firestore 위치를 알아내서 함수 지역을 같게 맞춰요 (region.json)
import { writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const project = process.env.PROJECT || "runners-prepare";
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const c = await auth.getClient();
// firebase 배포가 확인하는 API를 미리 켜요 (이미 켜져 있으면 그대로)
for (const api of ["cloudbilling.googleapis.com", "cloudresourcemanager.googleapis.com", "firestore.googleapis.com", "fcm.googleapis.com"]) {
  try { await c.request({ url: `https://serviceusage.googleapis.com/v1/projects/${project}/services/${api}:enable`, method: "POST" }); console.log(`API ${api} 켜짐`); }
  catch (e) { console.log(`API ${api}: ${e.response?.status} ${e.response?.data?.error?.message || e.message}`); }
}
const r = await c.request({ url: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)` });
const loc = r.data.locationId;
const region = { nam5: "us-central1", eur3: "europe-west1" }[loc] || loc;
writeFileSync(new URL("./region.json", import.meta.url), JSON.stringify({ region, firestore: loc }) + "\n");
console.log(`Firestore ${loc} → functions ${region}`);
