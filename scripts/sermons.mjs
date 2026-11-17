// 안암UBF '주일말씀' 게시판을 읽어 data/sermons.json(주일별 본문·설교 제목)을 갱신해요.
// GitHub Actions가 매일 실행하고, 바뀐 게 있을 때만 저장소에 올려요.
//  · 목록의 각 행: 강의순서 | 성경본문 | 글 제목 | 전한날짜(YYYY/MM/DD) | 조회
//  · 날짜가 일요일인 행만 쓰고, 같은 일요일이 여러 번 나오면 목록 위쪽(최신) 것을 써요
//  · 게시판에서 사라진 날짜는 지우지 않아요
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BOARD_URL || "http://www.anamubf.org/technote7/board.php?board=word";
const FILE = new URL("../data/sermons.json", import.meta.url);
const PAGES = Number(process.env.PAGES || 3);
const DRY = process.env.DRY === "true";

const decodeEntities = s => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const text = h => decodeEntities(h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (runners sermon sync)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const head = buf.subarray(0, 2048).toString("latin1");
  const cs = (r.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1] || head.match(/charset=["']?([\w-]+)/i)?.[1] || "utf-8";
  try { return new TextDecoder(cs.toLowerCase() === "ks_c_5601-1987" ? "euc-kr" : cs).decode(buf); }
  catch { return new TextDecoder("euc-kr").decode(buf); }
}

// 성경본문 나누기: "로마서 15:14-33" / "출애굽기 22:21-23:33" / "이사야 8:6" / "열왕기상 9장" / "빌레몬1:1-25"
const BOOK_FIX = { "빌레몬": "빌레몬서" };
function parseRef(raw) {
  const s = raw.replace(/[–~∼－]/g, "-").replace(/\s+/g, " ").trim();
  const m = s.match(/^([가-힣]+(?:\s?[가-힣]+)?)\s*(\d+)\s*(?:장|:\s*(\d+)(?:\s*-\s*(\d+)(?:\s*:\s*(\d+))?)?)?/);
  if (!m) return null;
  let [, book, ch, v1 = "", a = "", b = ""] = m;
  book = book.replace(/\s/g, ""); book = BOOK_FIX[book] || book;
  let v2 = "";
  if (b) v2 = `${a}장 ${b}`;      // 장을 넘어가는 본문: 22:21-23:33
  else if (a) v2 = a;
  return { book, ch, v1, v2 };
}

function parseList(html) {
  const rows = [];
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length < 3) continue;
    const texts = cells.map(text);
    const di = texts.findIndex(t => /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}$/.test(t));
    if (di < 0) continue;
    const [y, mo, d] = texts[di].split(/[\/.-]/).map(Number);
    const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() !== 0) continue;   // 일요일만
    // 이 게시판은 성경본문 칸과 제목 칸이 둘 다 글 링크예요 → 본문처럼 생긴 첫 칸이 본문, 그 뒤의 링크 칸이 제목
    const ri = texts.findIndex((t, i) => i < di && /\d/.test(t) && parseRef(t) && /[:장]/.test(t));
    const ti = cells.findIndex((c, i) => i > ri && i < di && /command=body/i.test(c));
    if (ri < 0) continue;
    const ref = parseRef(texts[ri]);
    const title = (ti >= 0 ? texts[ti] : texts[ri + 1] || "").replace(/\s*(\.\.+|…)\s*$/, "").trim();
    const lecture = ri > 0 ? texts[ri - 1] : "";
    rows.push({ date, ...ref, title, lecture: /^\d+$/.test(lecture) ? "" : lecture });
  }
  return rows;
}

const found = new Map();
let firstHtml = "";
for (let p = 1; p <= PAGES; p++) {
  const html = await get(p === 1 ? BASE : `${BASE}&page=${p}`);
  if (p === 1) firstHtml = html;
  const rows = parseList(html);
  console.log(`page ${p}: ${rows.length}행`);
  if (!rows.length) break;
  let fresh = 0;
  for (const r of rows) if (!found.has(r.date)) { found.set(r.date, r); fresh++; }
  if (!fresh) break;   // 같은 페이지가 반복되면 그만
}
if (!found.size) {
  console.log("게시판에서 주일 행을 하나도 찾지 못했어요. 페이지 구조를 확인해야 해요. 앞부분:");
  const flat = firstHtml.replace(/\s+/g, " "); const at = flat.search(/\d{4}\/\d{1,2}\/\d{1,2}/);
  console.log(at < 0 ? "날짜를 찾지 못함\n" + flat.slice(-6000) : flat.slice(Math.max(0, at - 5000), at + 1500));
  process.exit(1);
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const KEYS = ["book", "ch", "v1", "v2", "title", "lecture"];
let added = 0, changed = 0;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
for (const [date, r] of [...found].sort()) {
  const cur = data[date] || {};
  const next = { ...cur };
  for (const k of KEYS) if (r[k] !== undefined && (r[k] !== "" || !cur[k])) next[k] = r[k];
  const diff = KEYS.filter(k => (cur[k] || "") !== (next[k] || ""));
  if (!data[date]) { added++; console.log(`+ ${date} ${r.book} ${r.ch}:${r.v1}-${r.v2} ${r.title}`); }
  else if (diff.length) { changed++; console.log(`~ ${date}${date < today ? " (지난 주일)" : ""} ${diff.map(k => `${k}: "${cur[k] || ""}" → "${next[k]}"`).join(", ")}`); }
  data[date] = next;
}
console.log(`읽은 주일 ${found.size}개 · 새로 ${added} · 바뀜 ${changed}`);
if (DRY) { console.log("[미리보기] 파일은 저장하지 않았어요"); process.exit(0); }
if (added || changed) {
  const sorted = Object.fromEntries(Object.keys(data).sort().map(k => [k, data[k]]));
  writeFileSync(FILE, JSON.stringify(sorted, null, 1) + "\n");
  console.log("data/sermons.json 저장");
}
