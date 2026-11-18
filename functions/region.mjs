// 배포 전에 Firestore 위치를 알아내서 함수 지역을 같게 맞춰요 (region.json)
import { writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const project = process.env.PROJECT || "runners-prepare";
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const c = await auth.getClient();
const r = await c.request({ url: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)` });
const loc = r.data.locationId;
const region = { nam5: "us-central1", eur3: "europe-west1" }[loc] || loc;
writeFileSync(new URL("./region.json", import.meta.url), JSON.stringify({ region, firestore: loc }) + "\n");
console.log(`Firestore ${loc} → functions ${region}`);
