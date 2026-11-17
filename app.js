import { firebaseConfig, vapidKey } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
let FB = null;
let AUTH = { signOut: async () => {} };
let IMPORT = async () => { throw new Error("no-db"); };

const EVENTS = ["통합예배","전국학생수양회","봄수양회","여름수양회","가을수양회","겨울수양회","WMC"];
const DEFAULT_TOPICS = `1. 지난 주 주신 말씀에 대한 감사
- 무슨 말씀이었는지, 러너스에게 어떤 의미가 있는지

2. 세계선교

3. 성서한국

4. 러너스

5. 예배
- 예배 모든 순서 하나님 홀로 영광 받으시길

(관리자가 더보기 → 기도제목에서 실제 기도제목을 적어 두면 이 내용 대신 보여요)`;

const APP_VERSION = "11.17-17";   // 더보기 맨 아래에 보여서, 휴대폰이 최신 버전인지 확인할 수 있어요
const store = { get:k=>{ try{ return localStorage.getItem(k); }catch{ return null; } }, set:(k,v)=>{ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch{} } };
// 알림 종류: 기본 요일(0=일 … 6=토)과 시각(시). 각자 앱에서 바꿀 수 있어요.
const ALERTS = [
  {k:"prayer",   dept:"social", t:"대표기도 미정",     d:"사회 맡은 주에 대표기도가 아직 비어 있으면",        days:[3,4], hour:12},
  {k:"hymn",     dept:"social", t:"헌금찬송 미정",     d:"사회 맡은 주에 헌금찬송이 아직 비어 있으면",        days:[3,4], hour:12},
  {k:"script",   dept:"social", t:"기도문 작성",       d:"사회 맡은 주에 묵도·헌금기도 문장이 아직 비어 있으면", days:[3,4], hour:12},
  {k:"mcDay",    dept:"social", t:"사회 차례 알림",    d:"내가 사회인 주에 미리 알려 드려요",                 days:[6],   hour:20},
  {k:"prayDay",  dept:"social", t:"대표기도 차례 알림", d:"내가 대표기도인 주에 미리 알려 드려요",              days:[6],   hour:20},
  {k:"fallback", dept:"social", t:"사회자 대신 받기",   d:"사회자가 알림을 안 켰을 때 대표기도 미정 알림을 대신 받아요", days:[3,4], hour:12, edit:true},
  {k:"bdToday",  dept:"care",   t:"오늘 생일",         d:"고른 요일에 그날 생일인 사람이 있으면",              days:[0,1,2,3,4,5,6], hour:9},
  {k:"bdWeek",   dept:"care",   t:"이번 주 생일 미리보기", d:"앞으로 7일 안의 생일을 한 번에 알려 드려요",       days:[1], hour:9},
  {k:"join",     admin:true,    t:"가입 신청 도착",     d:"누가 가입을 신청하면 고른 요일·시각 이후에 알려 드려요", days:[0,1,2,3,4,5,6], hour:9},
  {k:"request",  admin:true,    t:"수정 요청 도착",     d:"멤버가 수정 요청을 보내면 고른 요일·시각 이후에 알려 드려요", days:[0,1,2,3,4,5,6], hour:9},
];
const DAYS = ["일","월","화","수","목","금","토"];
const DAY_ORDER = [1,2,3,4,5,6,0];
const HOURS = Array.from({length:18},(_,i)=>i+6);   // 오전 6시 ~ 밤 11시
const fmtHour = h => h<12 ? `오전 ${h}시` : h===12 ? "낮 12시" : h<18 ? `오후 ${h-12}시` : `저녁 ${h-12}시`;
const daysText = ds => DAY_ORDER.filter(d=>ds.includes(d)).map(d=>DAYS[d]).join("·");
function normPrefs(p){
  p = p || {}; const o = { all: p.all!==false };
  for(const a of ALERTS){ const v = p[a.k];
    o[a.k] = (v && typeof v==="object")
      ? { on: v.on!==false, days: Array.isArray(v.days)&&v.days.length ? v.days.filter(d=>d>=0&&d<=6) : a.days, hour: Number.isInteger(v.hour) ? v.hour : a.hour }
      : { on: v!==false, days: [...a.days], hour: a.hour }; }
  return o;
}
function loadPrefs(){ try{ return normPrefs(JSON.parse(store.get("runners-push-prefs")||"{}")); }catch{ return normPrefs(); } }
const S = {
  approved:false, isOwner:false,
  push:{ token: store.get("runners-push-token")||"", prefs: loadPrefs() },
  member:null, memberReady:false, members:[], births:[], birthQ:"", requests:[], reqTab:"inbox", reqCat:"bug",
  dept: store.get("runners-dept")==="care" ? "care" : "social",
  db:null, fbReady:false, authReady:false, canEdit:false, mode:"loading", user:null, installEvt:null,
  sermons:{}, weeks:[], people:[], topics:null, all:[], got:{p:false,w:false,s:false,m:false,b:false,r:false},
  schedYear:null, schedScrolled:false, peopleFilter:"all", peopleQ:"", scriptTab:"script",
  script:{date:null, honor:"형제님", prayer:"", book:"", ch:"", v1:"", v2:"", hymn:"", mukdo:"", offering:""}
};

/* ---------- 유틸 ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const fmtShort = s => { const d=parse(s); return `${d.getMonth()+1}.${pad(d.getDate())}`; };
const fmtFull = s => { if(!s) return "기록 없음"; const d=parse(s); return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`; };
const fmtKo = s => { const d=parse(s); return `${d.getMonth()+1}월 ${d.getDate()}일`; };
const addDays = (s,n) => { const d=parse(s); d.setDate(d.getDate()+n); return iso(d); };
const dday = s => Math.round((parse(s)-parse(TODAY))/864e5);
const isOwnerUser = () => S.isOwner;
// 권한: 관리자 = 모든 부서·모든 권한 / 운영자 = 맡은 부서에서 관리자와 같은 권한 / 멤버 = 맡은 부서 보기만
const ALL_DEPTS = ["social","care"];
const ROLE_NAME = { admin:"관리자", operator:"운영자", member:"멤버" };
const deptsOf = m => !m ? [] : (m.owner || m.role==="admin") ? [...ALL_DEPTS] : Array.isArray(m.depts) ? m.depts.filter(d=>ALL_DEPTS.includes(d)) : [...ALL_DEPTS];
const sees = d => S.isAdmin || (S.approved && deptsOf(S.member).includes(d));
const can = d => S.isAdmin || (S.approved && S.member?.role==="operator" && deptsOf(S.member).includes(d));
const alertVisible = a => a.admin ? S.isAdmin : sees(a.dept) && (!a.edit || can(a.dept));
const myName = () => (S.member?.name || S.user?.displayName || "").trim();
const firstName = n => { n=(n||"").trim(); return /^[가-힣]{3}$/.test(n) ? n.slice(1) : n; };

const ICON = {
  chev:'<path d="m9 6 6 6-6 6"/>', down:'<path d="m6 9 6 6 6-6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  up:'<path d="m6 15 6-6 6 6"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  doc:'<path d="M6 3h8.5L19 7.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  pray:'<path d="M12 4.5c-1.2 1.5-2 3.4-2 5.4V14l-3.6 3.6a1.5 1.5 0 0 0 0 2.1l.2.2c.6.6 1.5.6 2.1 0L12 16.6l3.3 3.3c.6.6 1.5.6 2.1 0l.2-.2a1.5 1.5 0 0 0 0-2.1L14 14V9.9c0-2-.8-3.9-2-5.4z"/>',
  book:'<path d="M3.5 5.5c2.5-1.2 5.5-1.2 8.5.8 3-2 6-2 8.5-.8V19c-2.5-1.2-5.5-1.2-8.5.8-3-2-6-2-8.5-.8z"/><path d="M12 6.3v13.5"/>',
  music:'<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  logout:'<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  phone:'<rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M11 18.5h2"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6M15.5 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20c-.5-2.5-1.8-4.1-3.6-4.9"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cake:'<path d="M4 20.5h16M5 20.5v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 15.5c1.2 1 2.4 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 11.5v-3M12 5.6c.8-.6 1-1.5 0-2.6-1 1.1-.8 2 0 2.6z"/>',
  menu:'<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  grid:'<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v3M16 3v3M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  heart:'<path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z"/>',
  upload:'<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'
};
const icon = (n, cls="") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const SPARK = (x,y,s,o=1) => `<svg class="spark" style="left:${x};top:${y};width:${s}px;height:${s}px;opacity:${o}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c.9 6.4 5.6 11.1 12 12-6.4.9-11.1 5.6-12 12-.9-6.4-5.6-11.1-12-12C6.4 11.1 11.1 6.4 12 0z"/></svg>`;
const GOOGLE = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const SHEEP = { heart:["img/sheep-heart.webp",537,479], wave:["img/sheep-wave.webp",455,215], pray:["img/sheep-pray.webp",242,343] };
const sheep = (k, cls="mascot") => `<img class="${cls}" src="${SHEEP[k][0]}" alt="" width="${SHEEP[k][1]}" height="${SHEEP[k][2]}" decoding="async">`;
const hue = name => { let h=0; for(const c of name||"") h=(h*31+c.charCodeAt(0))%360; return h; };
const av = (name, cls="") => `<span class="av ${cls}" style="--h:${hue(name)}" aria-hidden="true">${esc((firstName(name)||"?")[0])}</span>`;

let toastT;
function toast(msg){
  clearTimeout(toastT);
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t=document.createElement("div"); t.className="toast enter"; t.setAttribute("role","status"); t.textContent=msg;
  document.body.append(t); requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.remove("enter")));
  toastT=setTimeout(()=>{ t.classList.add("leave"); setTimeout(()=>t.remove(),180); },2600);
}
async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast("복사했어요"); }
  catch{ const ta=document.createElement("textarea"); ta.value=text; document.body.append(ta); ta.select();
    try{ document.execCommand("copy"); toast("복사했어요"); }catch{ toast("복사가 막혀 있어요. 길게 눌러 직접 복사해 주세요"); } ta.remove(); }
}

/* ---------- 화면 모드 ---------- */
const isDark = () => document.documentElement.dataset.theme==="dark";
function setTheme(dark){
  if(dark) document.documentElement.dataset.theme="dark"; else delete document.documentElement.dataset.theme;
  try{ localStorage.setItem("runners-theme", dark?"dark":"light"); }catch{}
  document.getElementById("theme-color").content = dark ? "#132B55" : "#BFE4FB";
  syncThemeButtons();
}
function syncThemeButtons(){
  document.querySelectorAll(".theme-toggle").forEach(b=>{
    b.querySelector(".sun")?.classList.toggle("off", isDark());
    b.querySelector(".moon")?.classList.toggle("off", !isDark());
    b.setAttribute("aria-label", isDark() ? "밝은 모드로 바꾸기" : "다크 모드로 바꾸기");
  });
}
const themeBtn = (cls="") => `<button class="icon-btn theme-toggle ${cls}" type="button" data-act="theme" aria-label="${isDark()?"밝은 모드로 바꾸기":"다크 모드로 바꾸기"}"><span class="swap" aria-hidden="true">${icon("sun", isDark()?"sun off":"sun")}${icon("moon", isDark()?"moon":"moon off")}</span></button>`;

/* ---------- 데이터 ---------- */
const blankWeek = date => ({date, event:"", mc:"", prayer:"", book:"", ch:"", v1:"", v2:"", hymn:"", title:"", lecture:"", mukdo:"", offering:""});
const LAST_GEN = `${+TODAY.slice(0,4)+2}-12-31`;
function mergedWeeks(){
  const map = new Map();
  for(const [date,sm] of Object.entries(S.sermons)) map.set(date, {...blankWeek(date), ...sm});
  for(const w of S.weeks){
    const o = {...(map.get(w.date)||blankWeek(w.date)), event:w.event||"", mc:w.mc||"", prayer:w.prayer||"", hymn:w.hymn||"", stored:true};
    if(w.mukdo) o.mukdo=w.mukdo; if(w.offering) o.offering=w.offering;
    map.set(w.date, o);
  }
  return [...map.values()];
}
function allWeeks(){
  const map = new Map(S.all.map(w=>[w.date,w]));
  const first = S.all.length ? S.all.reduce((m,w)=>w.date<m?w.date:m, S.all[0].date) : TODAY;
  const x = parse(first); x.setDate(x.getDate()+((7-x.getDay())%7)); let d = iso(x);
  while(d <= LAST_GEN){ if(!map.has(d)) map.set(d, blankWeek(d)); d = addDays(d,7); }
  return [...map.values()];
}
const sortedWeeks = () => allWeeks().sort((a,b)=>a.date.localeCompare(b.date));
const weekAt = date => allWeeks().find(w=>w.date===date) || blankWeek(date);
const isService = w => !w.event;
const nextService = () => sortedWeeks().find(w => w.date >= TODAY && isService(w));
function stats(people=S.people, weeks=S.weeks){
  const m = {};
  for (const p of people) m[p.name] = {last:p.last||"", next:""};
  for (const w of weeks){
    if(!w.prayer || !m[w.prayer]) continue;
    const s = m[w.prayer];
    if (w.date <= TODAY){ if (w.date > s.last) s.last = w.date; }
    else if (!s.next || w.date < s.next) s.next = w.date;
  }
  return m;
}
const status = p => p.excluded ? "excluded" : p.hold ? "hold" : "ok";
const statusChip = p => ({excluded:`<span class="chip bad">제외</span>`, hold:`<span class="chip warn">보류</span>`, ok:`<span class="chip ok">가능</span>`})[status(p)];
function candidates(people=S.people, weeks=S.weeks){
  const st = stats(people, weeks);
  return people.filter(p => status(p)==="ok" && !st[p.name].next)
    .map(p => ({p, last: st[p.name].last}))
    .sort((a,b)=>{
      const pa=a.p.priority||9, pb=b.p.priority||9; if(pa!==pb) return pa-pb;
      if(!a.last && b.last) return -1; if(a.last && !b.last) return 1;
      return a.last.localeCompare(b.last) || a.p.name.localeCompare(b.p.name,"ko");
    });
}
const openSlot = () => sortedWeeks().find(w => w.date >= TODAY && isService(w) && !w.prayer);
function mcPool(){ const s=new Set(); S.weeks.forEach(w=>w.mc&&s.add(w.mc)); return [...s]; }   // 사회자 이름은 일정 기록에서만 가져와요
function verseText(w){ if(!w||!w.book) return ""; let t=`${w.book}`; if(w.ch) t+=` ${w.ch}장`; if(w.v1) t+=` ${w.v1}절`; if(w.v2) t+=` – ${w.v2}절`; return t; }

/* ---------- 저장 ---------- */
async function write(fn, okMsg){
  if(!S.db){ toast("아직 연결 중이에요"); return false; }
  try{ await fn(); if(okMsg) toast(okMsg); try{ navigator.vibrate?.(8); }catch{} return true; }
  catch(e){ toast(e?.code==="permission-denied" ? "이 부서를 수정할 권한이 없어요" : "저장하지 못했어요. 잠시 후 다시 시도해 주세요"); return false; }
}
function opsOf(w, patch={}){
  const o = {date:w.date, event:w.event||"", mc:w.mc||"", prayer:w.prayer||"", hymn:w.hymn||""};
  const fsw = S.weeks.find(x=>x.date===w.date);
  if(fsw?.mukdo) o.mukdo=fsw.mukdo; if(fsw?.offering) o.offering=fsw.offering;
  return {...o, ...patch};
}
function planPriorities(people, weeks, pinId=null, pinRank=null){
  const st = stats(people, weeks);
  const elig = p => status(p)==="ok" && !st[p.name].next;
  let holders = people.filter(p => (p.priority||0)>0 && elig(p) && p.id!==pinId).sort((a,b)=>a.priority-b.priority);
  const pin = pinId ? people.find(p=>p.id===pinId) : null;
  if(pin && pinRank>0 && elig(pin)) holders.splice(Math.min(pinRank-1, holders.length), 0, pin);
  holders = holders.slice(0,3);
  const taken = new Set(holders.map(h=>h.id));
  for(const c of candidates(people, weeks)){
    if(holders.length>=3) break;
    if(taken.has(c.p.id) || (pinId===c.p.id && pinRank===0)) continue;
    holders.push(c.p); taken.add(c.p.id);
  }
  const want = new Map(holders.map((p,i)=>[p.id,i+1]));
  return people.filter(p=>(p.priority||0)!==(want.get(p.id)||0)).map(p=>({id:p.id, priority:want.get(p.id)||0}));
}
async function applyPriorities(people, weeks, pinId, pinRank){
  for(const u of planPriorities(people, weeks, pinId, pinRank)){ try{ await S.db.doc("people/"+u.id).update({priority:u.priority}); }catch{} }
}
async function assign(name, date){
  const body = opsOf(weekAt(date), {prayer:name});
  if(await write(()=>S.db.doc("weeks/"+date).set(body), `${fmtKo(date)} 대표기도: ${name}`))
    await applyPriorities(S.people, [...S.weeks.filter(w=>w.date!==date), body]);
}
async function clearRank(id){
  if(await write(()=>S.db.doc("people/"+id).update({priority:0}),"순위에서 뺐어요"))
    await applyPriorities(S.people.map(p=>p.id===id?{...p,priority:0}:p), S.weeks, id, 0);
}
async function moveRank(id, dir){
  const p=S.people.find(x=>x.id===id); if(!p||!S.canEdit) return;
  const to=Math.max(1,Math.min(3,(p.priority||0)+dir)); if(to===p.priority) return;
  await applyPriorities(S.people, S.weeks, id, to);
}

/* ---------- 화면 조각 ---------- */
const head = (title, sub="", right="", eyebrow="") => `<div class="page-head"><div>${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:""}<h1>${title}</h1>${sub?`<p class="sub">${sub}</p>`:""}</div>${right}</div>`;
const section = (title, body, link="") => `<section class="section"><div class="section-h"><h2>${title}</h2>${link}</div>${body}</section>`;
const empty = (title, text, k="wave", action="") => `<div class="empty">${sheep(k)}<strong>${title}</strong><p>${text}</p>${action}</div>`;
const datebox = d => `<span class="datebox"><span class="m">${parse(d).getMonth()+1}월</span><span class="d">${parse(d).getDate()}</span></span>`;
const person = (role, name) => name ? `<span class="person"><span><span class="role">${role}</span> ${esc(name)}</span></span>` : `<span class="person none">${role} 미정</span>`;

function weekRow(w, nx, opts={}){
  const past = w.date < TODAY, next = nx && w.date===nx.date;
  const verse = w.book ? `${esc(verseText(w))}${w.title?` · ${esc(w.title)}`:""}` : "";
  const body = w.event
    ? `<span class="t">${esc(w.event)}</span><span class="s">${verse || "러너스 예배 없음"}</span>`
    : `<span class="people">${person("사회",w.mc)}${person("기도",w.prayer)}</span>${verse?`<span class="s">${verse}</span>`:""}`;
  const act = S.canEdit ? `data-act="editWeek" data-date="${w.date}"` : (w.event ? "" : `data-act="openScript" data-date="${w.date}"`);
  const tag = act ? "button" : "div";
  const label = `${fmtKo(w.date)} ${w.event?esc(w.event):`사회 ${esc(w.mc)||"미정"}, 대표기도 ${esc(w.prayer)||"미정"}`}`;
  return `<${tag} ${tag==="button"?'type="button"':""} class="row ${past?"past":""} ${next?"is-next":""} ${w.event?"event":""}" ${act} ${opts.id?`id="${opts.id}"`:""} aria-label="${label}">
    ${datebox(w.date)}<span class="main">${body}</span>${act?icon("chev","chev"):""}</${tag}>`;
}

/* ---------- 로그인 ---------- */
function vLogin(){
  const ready = S.fbReady;
  return `<section class="login" aria-labelledby="login-title">
    ${SPARK("12%","16%",22)}${SPARK("82%","11%",30)}${SPARK("88%","38%",14,.8)}${SPARK("8%","52%",16,.8)}${SPARK("78%","70%",20)}
    ${themeBtn("theme-fab")}
    <span class="pillbadge">안암 1부 UBF</span>
    <h1 id="login-title" translate="no">러너스</h1>
    <p class="tag">진실됨으로 하나님께 나아가자<br>주일 예배 준비를 한곳에서</p>
    ${sheep("heart")}
    <button class="gbtn" type="button" data-act="login" ${ready?"":"disabled"}>${GOOGLE}${ready?"Google 계정으로 시작하기":"연결하는 중…"}</button>
    <p class="fine">처음이면 Google 계정으로 가입 신청을 하고, 관리자가 승인하면 이용할 수 있어요.</p>
  </section>`;
}

/* ---------- 승인 대기 ---------- */
function vPending(){
  const m = S.member||{}; const rejected = m.status==="rejected";
  return `<section class="login" aria-labelledby="pend-title">
    ${SPARK("12%","16%",22)}${SPARK("82%","11%",30)}${SPARK("8%","52%",16,.8)}${SPARK("78%","70%",20)}
    ${themeBtn("theme-fab")}
    <span class="pillbadge">${rejected?"가입 안내":"가입 신청 완료"}</span>
    <h1 id="pend-title" class="pend-h">${rejected?"승인되지 않았어요":"승인을 기다리고 있어요"}</h1>
    <p class="tag">${rejected?"러너스 관리자에게 문의해 주세요.":"관리자가 승인하면 이 화면이 바로 열려요.<br>앱을 닫아도 괜찮아요."}</p>
    ${sheep(rejected?"pray":"wave")}
    ${rejected?"":`<div class="pend-card">
      <label class="field"><span>러너스에서 쓰는 이름 (일정에 적히는 이름과 똑같이)</span>
        <input id="pend-name" name="name" autocomplete="name" spellcheck="false" maxlength="20" value="${esc(m.name||"")}"></label>
      <button class="btn pri block" type="button" data-act="savePendName">이름 저장</button>
      <span class="hint">${esc(S.user?.email||"")}</span>
    </div>`}
    <button class="btn" type="button" data-act="logout">${icon("logout")}다른 계정으로 로그인</button>
  </section>`;
}

/* ---------- 멤버 관리 ---------- */
const pendingCount = () => S.members.filter(m=>m.status==="pending").length;
const roleChip = m => m.owner ? `<span class="chip acc plain">최고 관리자</span>` : m.role==="admin" ? `<span class="chip acc plain">관리자</span>` : m.role==="operator" ? `<span class="chip ok plain">운영자</span>` : `<span class="chip mute plain">멤버</span>`;
const deptLine = m => (m.owner||m.role==="admin") ? "모든 부서" : (deptsOf(m).map(d=>DEPTS[d].name).join(" · ") || "부서 없음");
function vMembers(){
  if(!S.got.m) return skeleton();
  const by = st => S.members.filter(m=>m.status===st).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ko"));
  const pend = by("pending"), ok = by("approved"), rej = by("rejected");
  const row = (m, acts) => `<div class="row">${av(m.name||m.email)}<span class="main"><span class="t">${esc(m.name||"(이름 없음)")} ${roleChip(m)}</span><span class="s">${esc(m.email)}</span></span>${acts}</div>`;
  return `${head("멤버 관리", `멤버 ${ok.length}명${pend.length?` · 승인 대기 ${pend.length}명`:""}`)}
    ${pend.length?section("승인 대기", `<div class="card list">${pend.map(m=>row(m, `<span class="acts">
        <button class="btn sm danger" type="button" data-act="rejectMember" data-id="${m.id}">거절</button>
        <button class="btn sm pri" type="button" data-act="editMember" data-id="${m.id}">${icon("check")}권한 정하고 승인</button></span>`)).join("")}</div>
        <p class="note">승인을 누르면 권한과 부서를 고른 뒤 승인할 수 있어요. 이름은 일정에 적힌 이름과 똑같이 맞춰 주세요(알림이 이 이름으로 가요).</p>`):""}
    ${section("멤버", `<div class="card list">${ok.map(m=>`<button type="button" class="row" data-act="editMember" data-id="${m.id}" aria-label="${esc(m.name)} 편집">${av(m.name||m.email)}<span class="main"><span class="t">${esc(m.name||"(이름 없음)")} ${roleChip(m)}</span><span class="s">${deptLine(m)} · ${esc(m.email)}</span></span>${icon("chev","chev")}</button>`).join("")||`<p class="note" style="padding:16px">아직 승인한 멤버가 없어요</p>`}</div>`)}
    ${rej.length?section("거절함", `<div class="card list">${rej.map(m=>row(m, `<span class="acts">
        <button class="btn sm" type="button" data-act="deleteMember" data-id="${m.id}">기록 지우기</button>
        <button class="btn sm" type="button" data-act="editMember" data-id="${m.id}">승인</button></span>`)).join("")}</div>`):""}`;
}
function memberSheet(id){
  const m = S.members.find(x=>x.id===id); if(!m) return; const owner = !!m.owner; const approving = m.status!=="approved";
  const role = m.role==="admin"||m.role==="operator" ? m.role : "member";
  const ds = approving && !Array.isArray(m.depts) ? [...ALL_DEPTS] : deptsOf(m);
  openSheet(approving ? `${esc(m.name||m.email)} 승인` : esc(m.name||m.email), `<div class="fields">
    <label class="field"><span>이름 (일정에 적힌 이름과 똑같이)</span><input id="m-name" name="name" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(m.name||"")}"></label>
    <div class="field"><span class="lab" id="lab-role">권한</span>${owner?`<span class="readout">최고 관리자 (바꿀 수 없어요)</span>`:`
      <div class="role-pick" role="radiogroup" aria-labelledby="lab-role">
        ${[["admin","관리자","모든 부서에서 모든 권한 (멤버 관리 포함)"],["operator","운영자","고른 부서에서 관리자와 같은 권한"],["member","멤버","고른 부서를 보기만"]].map(([v,t,d])=>`
        <label class="role-opt"><input type="radio" name="m-role" value="${v}" ${role===v?"checked":""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}
      </div>`}</div>
    ${owner?"":`<div class="field" id="m-depts-wrap"><span class="lab" id="lab-dept">활동 부서 (여러 개 고를 수 있어요)</span>
      <div class="dept-pick" role="group" aria-labelledby="lab-dept">${ALL_DEPTS.map(d=>`
        <label class="dept-opt"><input type="checkbox" name="m-dept" value="${d}" ${ds.includes(d)?"checked":""}><span class="set-ic" style="--c:${DEPTS[d].color}">${icon(DEPTS[d].icon)}</span><span><b>${DEPTS[d].name}</b><small>${DEPTS[d].desc}</small></span></label>`).join("")}</div>
      <span class="hint" id="m-dept-hint" ${role==="admin"?"":"hidden"}>관리자는 고르지 않아도 모든 부서를 볼 수 있어요.</span></div>`}
    <div class="field"><span>이메일</span><span class="readout">${esc(m.email)}</span></div></div>`,
    owner ? `<button class="btn pri block" type="button" data-act="saveMember" data-id="${m.id}">저장</button>`
    : approving ? `<button class="btn danger" type="button" data-act="rejectMember" data-id="${m.id}">거절</button><button class="btn pri" type="button" data-act="saveMember" data-id="${m.id}" data-approve="1">${icon("check")}승인</button>`
    : `<button class="btn danger" type="button" data-act="rejectMember" data-id="${m.id}">내보내기</button><button class="btn pri" type="button" data-act="saveMember" data-id="${m.id}">저장</button>`);
  syncDeptPick();
}
function syncDeptPick(){
  const role = document.querySelector('input[name="m-role"]:checked')?.value;
  const wrap = document.getElementById("m-depts-wrap"); if(!wrap) return;
  wrap.classList.toggle("dim", role==="admin");
  const h=document.getElementById("m-dept-hint"); if(h) h.hidden = role!=="admin";
}

/* ---------- 홈 ---------- */
function vDash(){
  const nx = nextService();
  const up = sortedWeeks().filter(w=>w.date>=TODAY).slice(0,5);
  const year = TODAY.slice(0,4);
  const mc = {}; S.weeks.filter(w=>w.date.startsWith(year)&&w.mc&&!w.event).forEach(w=>mc[w.mc]=(mc[w.mc]||0)+1);
  const mcArr = Object.entries(mc).sort((a,b)=>b[1]-a[1]); const mcMax = Math.max(1,...mcArr.map(x=>x[1]));
  const tile = (ic,k,v,full=false) => `<div class="tile ${full?"full":""}"><span class="ic">${icon(ic)}</span><div><div class="k">${k}</div><div class="v ${v?"":"none"}">${v||"아직 미정"}</div></div></div>`;
  const name = firstName(myName());
  const hero = nx ? `
    <section class="hero" aria-label="다음 주일 예배">
      ${SPARK("52%","16px",20)}${SPARK("45%","74px",11)}${SPARK("10px","calc(100% - 110px)",14,.8)}
      <div class="hero-top">
        <div class="eyebrow">다음 주일 예배</div>
        <div class="date">${fmtKo(nx.date)}</div>
        <div class="meta"><span>${dday(nx.date)===0?"오늘":`D-${dday(nx.date)}`}</span><span>오후 2시</span></div>
        ${sheep("heart","hero-sheep")}
      </div>
      <div class="tiles">
        ${tile("mic","사회", esc(nx.mc))}${tile("pray","대표기도", esc(nx.prayer))}
        ${tile("book","본문", nx.book?`${esc(verseText(nx))}${nx.title?`<small>${esc(nx.title)}</small>`:""}`:"", true)}
        ${tile("music","헌금찬송", nx.hymn?`찬송가 <span class="tnum">${esc(nx.hymn)}</span>장`:"", true)}
      </div>
      <div class="hero-actions">
        <a class="btn pri" href="#script" data-act="openScript" data-date="${nx.date}">${icon("doc")}사회 원고</a>
        ${S.canEdit?`<button class="btn" type="button" data-act="editWeek" data-date="${nx.date}">${icon("edit")}배정 수정</button>`:""}
      </div>
    </section>` : `<div class="card">${empty("앞으로 잡힌 예배가 없어요","모든 주일이 행사로 잡혀 있어요.","wave",`<a class="btn" href="#schedule">일정 보기</a>`)}</div>`;
  const upcoming = section("다가오는 주일", `<div class="card list">${up.map(w=>weekRow(w,nx)).join("")}</div>`, `<a class="link" href="#schedule">전체 일정${icon("chev")}</a>`);
  const ranks = S.canEdit && S.got.p ? section("대표기도 순서", rankBoard(), `<a class="link" href="#people">명단${icon("chev")}</a>`) : "";
  const bars = section(`${year} 사회 횟수`, `<div class="card"><div class="bars">${mcArr.map(([n,c])=>`<div class="bar"><span class="who">${av(n,"sm")}${esc(n)}</span><div class="track" role="img" aria-label="${esc(n)} ${c}회"><div class="fill" style="width:${c/mcMax*100}%"></div></div><span class="n">${c}</span></div>`).join("")||`<p class="note">기록이 없어요</p>`}</div></div>`);
  const pendBanner = S.isAdmin && pendingCount() ? `<a class="banner pend" href="#members">${icon("users")}<span>가입 신청 <b>${pendingCount()}명</b>이 승인을 기다리고 있어요</span>${icon("chev","chev")}</a>` : "";
  return `${head("이번 주일 준비", "", "", name?`${esc(name)}님, 반가워요`:"반가워요")}${pendBanner}${hero}<div class="cols"><div>${upcoming}</div><div>${ranks}${bars}</div></div>`;
}

/* ---------- 일정 ---------- */
function vSchedule(){
  const nx=nextService(); const all=sortedWeeks();
  const years=[...new Set(all.map(w=>w.date.slice(0,4)))].sort();
  if(!S.schedYear || !years.includes(S.schedYear)) S.schedYear = years.includes(TODAY.slice(0,4)) ? TODAY.slice(0,4) : years[years.length-1];
  const y=S.schedYear; const ws=all.filter(w=>w.date.startsWith(y));
  const svc=ws.filter(isService); const filled=svc.filter(w=>w.mc&&w.prayer).length;
  const byMonth = {}; ws.forEach(w=>{ const m=+w.date.slice(5,7); (byMonth[m] ||= []).push(w); });
  return `${head("주일 일정", `${y}년 예배 ${svc.length}번 중 ${filled}번 배정을 마쳤어요`)}
    <div class="year-bar"><div class="seg" role="group" aria-label="연도">${years.map(k=>`<button type="button" data-act="schedYear" data-v="${k}" aria-pressed="${y===k}">${k}년</button>`).join("")}</div></div>
    <div class="section" style="gap:0">${Object.entries(byMonth).map(([m,list])=>`
      <div class="month-h"><span>${m}월</span></div>
      <div class="card list">${list.map(w=>weekRow(w,nx,{id:nx&&w.date===nx.date?"next-row":""})).join("")}</div>`).join("")}</div>`;
}

/* ---------- 명단 ---------- */
function rankBoard(){
  const st=stats(); const slot=openSlot();
  const ranked=[1,2,3].map(r=>S.people.find(p=>p.priority===r && status(p)==="ok" && !st[p.name].next)||null);
  const gaps = ranked.some(x=>!x) && candidates().length>ranked.filter(Boolean).length;
  return `<div class="card list rank-list">${ranked.map((p,i)=>{ const r=i+1;
      if(!p) return `<div class="row"><span class="medal"><span class="av" style="--h:220;opacity:.5">?</span><b>${r}</b></span><span class="main"><span class="t" style="color:var(--muted)">비어 있음</span><span class="s">추천할 사람이 없어요</span></span>
        ${S.canEdit&&gaps&&i===ranked.findIndex(x=>!x)?`<button class="btn sm" type="button" data-act="rankFill">채우기</button>`:""}</div>`;
      const last=st[p.name].last;
      return `<div class="row"><span class="medal ${r===1?"first":""}">${av(p.name)}<b>${r}</b></span>
        <span class="main"><span class="t">${esc(p.name)}</span><span class="s">${last?`마지막 ${fmtFull(last)}`:"아직 기록 없음"}</span></span>
        ${S.canEdit?`<span class="acts">
          ${r===1&&slot?`<button class="btn sm pri" type="button" data-act="assign" data-name="${esc(p.name)}" data-date="${slot.date}">${fmtShort(slot.date)} 배정</button>`:""}
          ${r>1?`<button class="btn icon sm" type="button" data-act="rankUp" data-id="${p.id}" aria-label="${esc(p.name)} 순위 올리기">${icon("up")}</button>`:""}
          <button class="btn icon sm" type="button" data-act="rankClear" data-id="${p.id}" aria-label="${esc(p.name)} 순위에서 빼기">${icon("x")}</button></span>`:""}
      </div>`;}).join("")}</div>
    ${slot?`<p class="note">1순위는 가장 가까운 빈 주일(${fmtKo(slot.date)})에 바로 배정할 수 있어요</p>`:""}`;
}
function vPeople(){
  const st=stats(); const f=S.peopleFilter; const q=S.peopleQ.trim();
  let ps=[...S.people].filter(p=>(f==="all"||status(p)===f)&&(!q||p.name.includes(q)));
  ps.sort((a,b)=>{ const sa={ok:0,hold:1,excluded:2}; return sa[status(a)]-sa[status(b)] || (st[a.name].last||"").localeCompare(st[b.name].last||"") || a.name.localeCompare(b.name,"ko"); });
  const cnt=k=>S.people.filter(p=>k==="all"||status(p)===k).length;
  return `${head("대표기도 명단", `가능 ${cnt("ok")} · 보류 ${cnt("hold")} · 제외 ${cnt("excluded")}`,
      `<button class="btn pri" type="button" data-act="editPerson">${icon("plus")}추가</button>`)}
    ${section("다음 순서", rankBoard())}
    <section class="section">
      <label class="sr-only" for="pq">이름 검색</label>
      <input id="pq" type="search" name="q" placeholder="이름으로 찾기…" autocomplete="off" autocapitalize="none" autocorrect="off" enterkeyhint="search" spellcheck="false" value="${esc(S.peopleQ)}">
      <div class="seg" role="group" aria-label="상태">${[["all","전체"],["ok","가능"],["hold","보류"],["excluded","제외"]].map(([k,l])=>`<button type="button" data-act="peopleFilter" data-v="${k}" aria-pressed="${f===k}">${l}</button>`).join("")}</div>
      <div class="card list">${ps.map(p=>{ const s=st[p.name]; return `
        <button type="button" class="row" data-act="editPerson" data-id="${p.id}" aria-label="${esc(p.name)} 편집">
          ${av(p.name)}
          <span class="main"><span class="t">${esc(p.name)} ${p.priority?`<span class="chip acc plain">${p.priority}순위</span>`:""}</span>
          <span class="s">${s.next?`${fmtShort(s.next)} 대표기도 예정`:s.last?`마지막 ${fmtFull(s.last)}`:"기록 없음"}${p.note?` · ${esc(p.note)}`:""}</span></span>
          ${statusChip(p)}${icon("chev","chev")}</button>`;}).join("") || empty("찾는 사람이 없어요","검색어나 상태 필터를 바꿔 보세요.","wave",`<button class="btn" type="button" data-act="resetPeople">필터 지우기</button>`)}</div>
    </section>`;
}

/* ---------- 원고 ---------- */
function syncScript(date){
  const w = weekAt(date); const sc=S.script;
  Object.assign(sc, {date, prayer:w.prayer||"", book:w.book||"", ch:w.ch||"", v1:w.v1||"", v2:w.v2||"", hymn:w.hymn||"", mukdo:w.mukdo||"", offering:w.offering||""});
}
function buildScript(){
  const sc=S.script; const ph = t => `[${t}]`;
  const verse = !sc.book ? ph("본문 미정")
    : !sc.v1 ? `${sc.book} ${sc.ch||ph("장")}장`
    : !sc.v2 ? `${sc.book} ${sc.ch||ph("장")}장 ${sc.v1}절`
    : `${sc.book} ${sc.ch||ph("장")}장 ${sc.v1}절부터 ${sc.v2}절까지`;
  return [
    {no:1,t:"묵도",cue:"14:00 정각 단상 · 하이예스 연습 중이면 양해 구하고 중지",p:`다함께 묵도하심으로 예배를 준비하시겠습니다. (묵도 반주)\n감사하신 하나님 아버지, 한주간 은혜 베풀어 주시고 이렇게 한자리에 예배 드리러 오게 하심에 감사합니다. ${sc.mukdo||ph("지난주 말씀 기반 기도")}\n이 시간 예배를 통해 하나님 홀로 영광 받으시길 기도합니다. 감사하며 예수님의 이름으로 기도하였습니다. (퇴장)`},
    {no:2,t:"하이예스",cue:"사회자 역할 없음",p:""},
    {no:3,t:"사도신경",cue:"경배곡 끝날 즈음 단상 대기 · 찬양 완전히 끝난 뒤 진행",p:"다함께 사도신경으로 신앙고백하시겠습니다. 시작"},
    {no:4,t:"대표기도",cue:"",p:`모두 자리에 앉으시겠습니다. 예배를 위해 ${sc.prayer||ph("대표기도자")} ${sc.honor}께서 대표기도해주시겠습니다.`},
    {no:5,t:"말씀봉독",cue:"",p:`오늘 본문 말씀을 읽겠습니다. 말씀은 ${verse}입니다. 저와 여러분이 한절씩 교독하겠습니다.`},
    {no:6,t:"메시지",cue:"",p:"이창무 목자님께서 말씀을 전해주시겠습니다."},
    {no:7,t:"헌금찬송",cue:"",p:`다함께 찬송가 ${sc.hymn||ph("OO")}장을 부르시겠습니다. 부르시는 가운데 준비하신 헌금을 드리겠습니다.`},
    {no:8,t:"헌금기도",cue:"",p:`드리신 헌금을 위해 잠시 기도하겠습니다. ${sc.offering||ph("오늘 말씀 참고 멘트")}\n이시간 지난 한주간 주신 은혜와 오늘 말씀에 감사하여 작은 예물을 드렸습니다. 이 예물을 기뻐 받아주시고 오병이어로 축사하셔서 성서한국과 세계선교 역사에 귀하게 사용되기를 기도합니다. 감사하며 예수님의 이름으로 기도하였습니다.`},
    {no:9,t:"광고",cue:"",p:"이창무 목자님께서 광고와 기도제목을 나눠주시겠습니다."},
  ];
}
const scriptText = () => buildScript().map(s=>`${s.no}. ${s.t}${s.cue?` (${s.cue})`:""}${s.p?"\n"+s.p:""}`).join("\n\n");
const hl = t => esc(t).replace(/\[([^\]]+)\]/g,'<mark>$1</mark>').replace(/\n/g,"<br>");
const stepsHtml = () => buildScript().map(s=>`<div class="step ${s.p?"":"quiet"}"><span class="dot">${s.no}</span><div><h3>${s.t}</h3>${s.cue?`<span class="cue">${esc(s.cue)}</span>`:""}${s.p?`<p>${hl(s.p)}</p>`:""}</div></div>`).join("");
function vScript(){
  const nx = nextService();
  const services = sortedWeeks().filter(w=>isService(w) && w.date>=addDays(TODAY,-84) && w.date<=addDays(TODAY,182));
  if(!S.script.date){ if(nx) syncScript(nx.date); else if(services.length) syncScript(services[services.length-1].date); }
  const sc=S.script; const cw = sc.date?weekAt(sc.date):null;
  const prev = sc.date?sortedWeeks().filter(w=>w.date<sc.date && w.book).pop():null;
  const ppl = S.people.filter(p=>!p.excluded).map(p=>p.name).sort((a,b)=>a.localeCompare(b,"ko"));
  const blanks = (scriptText().match(/\[[^\]]+\]/g)||[]).length;
  const tab = S.scriptTab;
  return `${head("사회 원고", cw?.title?`${esc(verseText(cw))} · ${esc(cw.title)}`:"주일을 고르면 원고가 채워져요", sheep("pray"))}
    <label class="sr-only" for="s-date">주일 선택</label>
    <div class="select-wrap"><select id="s-date" name="date">${services.map(w=>`<option value="${w.date}" ${w.date===sc.date?"selected":""}>${fmtFull(w.date)}${w.date===nx?.date?" · 다음 예배":""}</option>`).join("")}</select>${icon("down")}</div>
    <div class="seg" role="group" aria-label="보기">
      <button type="button" data-act="scriptTab" data-v="script" aria-pressed="${tab==="script"}">원고 보기</button>
      <button type="button" data-act="scriptTab" data-v="input" aria-pressed="${tab==="input"}">내용 고치기</button>
    </div>
    ${tab==="script"?`
    <div class="card">
      <div class="copybar"><span class="s">${blanks?`노란 칸 <b>${blanks}곳</b>을 채워 주세요`:"모든 칸이 채워졌어요"}</span>
        <button class="btn sm pri" type="button" data-act="copyScript">${icon("copy")}전체 복사</button></div>
      <div class="timeline">${stepsHtml()}</div>
    </div>`:`
    <div class="card fields">
      <div class="field-row">
        <label class="field"><span>대표기도자</span><input id="s-prayer" name="prayer" list="dl-people" autocomplete="off" value="${esc(sc.prayer)}"></label>
        <label class="field"><span>호칭</span><select id="s-honor" name="honor">${["형제님","자매님","목자님"].map(h=>`<option ${sc.honor===h?"selected":""}>${h}</option>`).join("")}</select></label>
      </div>
      <div class="field"><span class="lab" id="lab-verse">본문 · 책 / 장 / 시작절 / 끝절</span><div class="verse" role="group" aria-labelledby="lab-verse">
        <input id="s-book" name="book" aria-label="책" placeholder="로마서" autocomplete="off" value="${esc(sc.book)}">
        <input id="s-ch" name="ch" aria-label="장" inputmode="numeric" placeholder="장" autocomplete="off" value="${esc(sc.ch)}">
        <input id="s-v1" name="v1" aria-label="시작 절" inputmode="numeric" placeholder="절" autocomplete="off" value="${esc(sc.v1)}">
        <input id="s-v2" name="v2" aria-label="끝 절" placeholder="절" autocomplete="off" value="${esc(sc.v2)}"></div></div>
      <div class="field-row">
        <label class="field"><span>헌금찬송 (장)</span><input id="s-hymn" name="hymn" inputmode="numeric" autocomplete="off" value="${esc(sc.hymn)}"></label>
        <div class="field"><span>지난주 본문</span><span class="readout">${prev?`${fmtShort(prev.date)} · ${esc(verseText(prev))}`:"기록 없음"}</span></div>
      </div>
      <label class="field"><span>묵도 · 지난주 말씀 기반 기도</span><textarea id="s-mukdo" name="mukdo" rows="6" placeholder="지난주 말씀을 떠올리며 감사와 간구를 적어 주세요">${esc(sc.mukdo)}</textarea></label>
      <label class="field"><span>헌금기도 · 오늘 말씀 참고 멘트</span><textarea id="s-offering" name="offering" rows="3" placeholder="오늘 말씀을 통해 …">${esc(sc.offering)}</textarea></label>
      ${S.canEdit?`<div class="field"><button class="btn block pri" type="button" data-act="saveLines">묵도·헌금기도 저장</button><span class="hint">저장하면 다른 운영자도 같은 문장을 봐요. 나머지 칸은 이 화면에서만 바뀌어요.</span></div>`
        :`<div class="field"><span class="hint">여기서 고친 내용은 이 화면에서만 바뀌어요.</span></div>`}
    </div>
    <datalist id="dl-people">${ppl.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`}`;
}

/* ---------- 더보기 ---------- */
function vMore(){
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const u = S.user;
  const setRow = (c, ic, t, s, right="", act="") => `<${act?"button":"div"} ${act?`type="button" ${act}`:""} class="row"><span class="set-ic" style="--c:${c}">${icon(ic)}</span><span class="main"><span class="t">${t}</span>${s?`<span class="s" style="white-space:normal">${s}</span>`:""}</span>${right}</${act?"button":"div"}>`;
  const noDept = !ALL_DEPTS.some(sees);
  return `${head("더보기")}${noDept?`<div class="banner">아직 볼 수 있는 부서가 없어요. 관리자에게 부서를 열어 달라고 해 주세요.</div>`:""}
    <div class="card"><div class="profile">${av(myName()||u?.email||"?","lg")}<div class="main"><div class="t">${esc(myName()||"러너스 멤버")}</div><div class="s">${esc(u?.email||"")}</div></div>${isOwnerUser()?`<span class="chip acc">최고 관리자</span>`:`<span class="chip ${S.member?.role==="member"?"mute":"acc"}">${ROLE_NAME[S.member?.role]||"멤버"}</span>`}</div></div>
    ${section("설정", `<div class="card list">
      ${setRow("#5B6CF0","moon","화면 모드","",`<div class="seg mini" role="group" aria-label="화면 모드"><button type="button" data-act="themeSet" data-v="light" aria-pressed="${!isDark()}">밝게</button><button type="button" data-act="themeSet" data-v="dark" aria-pressed="${isDark()}">어둡게</button></div>`)}
      ${standalone?"":setRow("#2F9E6B","phone","휴대폰에 앱 설치", ios?"Safari 아래쪽 공유 버튼 → 홈 화면에 추가":"Chrome 오른쪽 위 ⋮ 메뉴 → 앱 설치", S.installEvt?`<button class="btn sm pri" type="button" data-act="install">설치</button>`:"")}
      ${setRow("#F0A020","bell","알림", S.push.token?(S.push.prefs.all?(ALERTS.filter(a=>S.push.prefs[a.k].on && alertVisible(a)).map(a=>a.t).join(" · ")||"모든 종류 꺼짐"):"전체 알림 꺼짐"):"예배 준비·생일 소식을 이 휴대폰으로 알려 드려요", S.push.token?(S.push.prefs.all?`<span class="chip ok">켜짐</span>`:`<span class="chip mute">꺼짐</span>`):icon("chev","chev"),'data-act="notify"')}
      ${S.isAdmin?setRow("#7A5CE0","users","멤버 관리", pendingCount()?`승인 대기 <b>${pendingCount()}명</b>`:"가입 승인, 관리자 지정", pendingCount()?`<span class="chip warn plain">${pendingCount()}</span>`:icon("chev","chev"),'data-act="goMembers"'):""}
      ${setRow("#14A3A0","edit","수정 요청", S.isAdmin ? (openReqCount()?`새로 온 요청 <b>${openReqCount()}건</b>`:"멤버들이 보낸 요청 확인") : "불편한 점이나 바라는 기능을 관리자에게 보내요",
        S.isAdmin && openReqCount() ? `<span class="chip warn plain">${openReqCount()}</span>` : icon("chev","chev"), 'data-act="goRequests"')}
      ${sees("social")?setRow("#E0663E","heart","기도제목","대표기도자에게 보낼 기도 가이드",icon("chev","chev"),'data-act="topics"'):""}
      ${S.isAdmin?setRow("#2F78D0","upload","데이터 가져오기","받은 json 파일로 명단·배정·생일을 옮겨요",icon("chev","chev"),'data-act="importSheet"'):""}
    </div>`)}
    <div class="card list">${setRow("#C23A3F","logout",`<span style="color:var(--bad)">로그아웃</span>`,"","",'data-act="logout"')}</div>
    <p class="ver">러너스 버전 ${APP_VERSION}</p>`;
}

/* ---------- 시트 ---------- */
let sheetOpen = false, sheetReturn = null;
function openSheet(title, body, foot=""){
  sheetReturn = document.activeElement;
  const root=document.getElementById("sheet-root");
  root.className=""; root.innerHTML = `<div class="scrim" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="drag-zone"><div class="grab" aria-hidden="true"></div>
      <div class="sheet-h"><h2 id="sheet-title">${title}</h2><button class="btn icon sm" type="button" data-act="closeSheet" aria-label="닫기">${icon("x")}</button></div></div>
      <div class="sheet-b">${body}</div>${foot?`<div class="sheet-f">${foot}</div>`:""}</div>`;
  sheetOpen = true; document.body.style.overflow="hidden";
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ root.className="open"; root.querySelector(".sheet-b input:not([disabled]):not([type=file]), .sheet-b select")?.focus({preventScroll:true}); }));
  bindSheetDrag(root.querySelector(".sheet"), root.querySelector(".drag-zone"));
}
function closeSheet(){
  const root=document.getElementById("sheet-root"); if(!sheetOpen) return;
  sheetOpen=false; root.className="open closing"; document.body.style.overflow="";
  setTimeout(()=>{ if(!sheetOpen){ root.innerHTML=""; root.className=""; } }, 260);
  if(sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({preventScroll:true});
}
/* 손가락을 따라 1:1로 내려가고, 위로는 고무줄처럼 버티고, 놓을 때 거리·속도로 닫힘 결정 */
function bindSheetDrag(sheet, zone){
  if(!matchMedia("(max-width:720px)").matches) return;
  let y0=0, dy=0, hist=[], id=null;
  const rubber = (o,d) => (o*d*0.55)/(d+0.55*Math.abs(o));
  zone.addEventListener("pointerdown", e=>{
    if(e.target.closest("button")) return;
    id=e.pointerId; zone.setPointerCapture(id); y0=e.clientY; dy=0; hist=[{y:e.clientY,t:e.timeStamp}];
    sheet.classList.add("dragging");
  });
  zone.addEventListener("pointermove", e=>{
    if(e.pointerId!==id) return;
    dy = e.clientY - y0; hist.push({y:e.clientY,t:e.timeStamp}); if(hist.length>5) hist.shift();
    sheet.style.translate = `0 ${dy>0 ? dy : -rubber(-dy, sheet.offsetHeight)}px`;
  });
  const end = e=>{
    if(e.pointerId!==id) return; id=null;
    const a=hist[0], b=hist[hist.length-1]; const v = (b.y-a.y)/Math.max(1,b.t-a.t);
    sheet.classList.remove("dragging"); sheet.style.translate="";
    if(dy > sheet.offsetHeight*0.3 || (v > 0.5 && dy > 24)) closeSheet();
  };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
}
function weekSheet(date){
  const w = weekAt(date); const isStored = S.weeks.some(x=>x.date===date);
  const kind = w.event ? (EVENTS.includes(w.event)?w.event:"__other") : "";
  const ppl = S.people.filter(p=>!p.excluded).map(p=>p.name).sort((a,b)=>a.localeCompare(b,"ko"));
  openSheet(`${fmtKo(date)} 배정`, `
    <div class="fields">
      <label class="field"><span>구분</span><select id="w-kind" name="kind"><option value="">러너스 예배</option>${EVENTS.map(e=>`<option ${kind===e?"selected":""}>${e}</option>`).join("")}<option value="__other" ${kind==="__other"?"selected":""}>기타 행사</option></select></label>
      <label class="field" id="w-other-wrap" ${kind==="__other"?"":"hidden"}><span>행사 이름</span><input id="w-other" name="other" autocomplete="off" value="${kind==="__other"?esc(w.event):""}"></label>
      <div id="w-roles" ${w.event?"hidden":""}>
        <div class="field-row">
          <label class="field"><span>사회</span><input id="w-mc" name="mc" list="dl-mc" autocomplete="off" value="${esc(w.mc)}"></label>
          <label class="field"><span>대표기도</span><input id="w-prayer" name="prayer" list="dl-pp" autocomplete="off" value="${esc(w.prayer)}"></label>
        </div>
        <label class="field"><span>헌금찬송 (장)</span><input id="w-hymn" name="hymn" inputmode="numeric" autocomplete="off" value="${esc(w.hymn)}"></label>
        <div class="field"><span>본문</span><span class="readout">${w.book?`${esc(verseText(w))}${w.title?` · ${esc(w.title)}`:""}`:"게시판에 올라오면 자동으로 들어와요"}</span></div>
      </div>
    </div>
    <datalist id="dl-mc">${mcPool().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <datalist id="dl-pp">${ppl.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`,
    `${isStored?`<button class="btn danger" type="button" data-act="delWeek" data-date="${date}">지우기</button>`:""}<button class="btn pri" type="button" data-act="saveWeek" data-date="${date}">저장</button>`);
}
function personSheet(id){
  const p = S.people.find(x=>x.id===id) || {name:"",last:"",note:"",hold:false,excluded:false,priority:0};
  const s = status(p);
  openSheet(id?esc(p.name):"사람 추가", `
    <div class="fields">
      <div class="field-row">
        <label class="field"><span>이름</span><input id="p-name" name="name" autocomplete="off" spellcheck="false" value="${esc(p.name)}"></label>
        <label class="field"><span>추천 순위</span><select id="p-pri" name="priority">${[0,1,2,3].map(n=>`<option value="${n}" ${+p.priority===n?"selected":""}>${n?n+"순위":"지정 안 함"}</option>`).join("")}</select></label>
      </div>
      <div class="field"><span class="lab" id="lab-st">상태</span><div class="radios" role="radiogroup" aria-labelledby="lab-st">${[["ok","가능"],["hold","보류"],["excluded","제외"]].map(([k,l])=>`<label><input type="radio" name="p-st" value="${k}" ${s===k?"checked":""}>${l}</label>`).join("")}</div></div>
      <label class="field"><span>메모 · 사유</span><input id="p-note" name="note" placeholder="군대, 사회 담당 등" autocomplete="off" value="${esc(p.note)}"></label>
      <label class="field"><span>시트 기록상 마지막 대표기도</span><input id="p-last" name="last" type="date" value="${p.last||""}"><span class="hint">일정에 배정된 날짜가 더 최근이면 그 날짜가 마지막으로 잡혀요.</span></label>
    </div>`,
    `${id?`<button class="btn danger" type="button" data-act="delPerson" data-id="${id}">삭제</button>`:""}<button class="btn pri" type="button" data-act="savePerson" data-id="${id||""}">저장</button>`);
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
function pushSupportNote(){
  if(!vapidKey) return "알림 기능을 준비하는 중이에요. 운영자가 설정을 마치면 켤 수 있어요.";
  if(isIOS() && !isStandalone()) return "아이폰은 홈 화면에 추가한 러너스 앱에서만 알림을 켤 수 있어요. Safari 아래 공유 버튼 → '홈 화면에 추가' 후 그 앱으로 열어 주세요.";
  if(!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return "이 브라우저는 알림을 지원하지 않아요. 휴대폰 Chrome이나 홈 화면에 추가한 앱에서 열어 주세요.";
  if(Notification.permission==="denied") return "이 기기에서 러너스 알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 러너스(또는 브라우저)를 허용해 주세요.";
  return "";
}
function notifySheet(){
  const note = pushSupportNote(); const on = !!S.push.token; const pf = S.push.prefs;
  const list = ALERTS.filter(alertVisible);
  openSheet("알림", `<div class="fields">
      ${note?`<p class="hint" role="alert" style="color:var(--warn);margin:0 18px">${note}</p>`:""}
      <div class="card list toggles">
        <label class="row toggle master"><span class="set-ic" style="--c:#F0A020">${icon("bell")}</span><span class="main"><span class="t">전체 알림</span><span class="s">끄면 아래 설정은 그대로 두고 모든 알림을 멈춰요</span></span>
          <input type="checkbox" role="switch" class="switch" id="pref-all" ${pf.all?"checked":""}></label>
      </div>
      <div class="card list toggles alerts ${pf.all?"":"dim"}" id="alert-list">${list.map(a=>{ const v=pf[a.k]; return `
        <div class="alert" data-alert="${a.k}">
          <label class="row toggle"><span class="main"><span class="t">${a.t}</span><span class="s">${a.d}</span></span>
            <input type="checkbox" role="switch" class="switch" data-pref="${a.k}" ${v.on?"checked":""}></label>
          <div class="alert-cfg" ${v.on?"":"hidden"}>
            <div class="days" role="group" aria-label="${a.t} 요일">${DAY_ORDER.map(d=>`<button type="button" class="day ${d===0?"sun":""}" data-act="day" data-day="${d}" aria-pressed="${v.days.includes(d)}">${DAYS[d]}</button>`).join("")}</div>
            <div class="select-wrap hour"><select data-hour aria-label="${a.t} 시각">${HOURS.map(h=>`<option value="${h}" ${h===v.hour?"selected":""}>${fmtHour(h)}</option>`).join("")}</select>${icon("down")}</div>
          </div>
        </div>`; }).join("")}</div>
      <p class="hint" style="margin:4px 18px 8px">알림은 <b>${esc(myName()||"(이름 없음)")}</b> 이름으로 와요. 일정에 적힌 이름과 다르면 관리자에게 고쳐 달라고 해 주세요. 시각은 1시간 단위이고, 몇 분 늦게 올 수 있어요. 사회부 알림의 요일은 그 주 주일(일요일) 기준이에요.</p>
    </div>`,
    on ? `<button class="btn pri block" type="button" data-act="pushSave">저장</button>`
       : `<button class="btn pri block" type="button" data-act="pushOn" ${note?"disabled":""}>알림 켜기</button>`);
}
function readPrefs(){
  const p = { all: document.getElementById("pref-all")?.checked ?? S.push.prefs.all };
  for(const a of ALERTS){ const el = document.querySelector(`[data-alert="${a.k}"]`);
    p[a.k] = el ? { on: el.querySelector("[data-pref]").checked, days: [...el.querySelectorAll('.day[aria-pressed="true"]')].map(b=>+b.dataset.day), hour: +el.querySelector("[data-hour]").value } : S.push.prefs[a.k]; }
  return normPrefs(p);
}
async function pushToken(){
  const m = await import(SDK+"firebase-messaging.js");
  if(!(await m.isSupported())) throw new Error("unsupported");
  const reg = await navigator.serviceWorker.ready;
  return { m, messaging: m.getMessaging(FB.app), token: await m.getToken(m.getMessaging(FB.app), { vapidKey, serviceWorkerRegistration: reg }) };
}
async function saveToken(token, prefs){
  const { doc, setDoc, serverTimestamp } = FB.m;
  await setDoc(doc(FB.fs,"pushTokens",token), { token, name: myName(), email:S.user?.email||"", uid:S.user.uid, admin:!!S.isAdmin, prefs, updatedAt: serverTimestamp(), ua: navigator.userAgent.slice(0,120) });
}
function keepPush(token, prefs){ S.push = { token, prefs }; store.set("runners-push-token", token||null); store.set("runners-push-prefs", JSON.stringify(prefs)); }
async function pushOn(prefs){
  if(!FB || !S.user) return false;
  if(await Notification.requestPermission()!=="granted"){ toast("알림 권한을 허용해야 받을 수 있어요"); return false; }
  const { token } = await pushToken();
  await saveToken(token, prefs); keepPush(token, prefs);
  toast("알림을 켰어요"); return true;
}
async function pushOff(){
  const old = S.push.token;
  try{ const { m, messaging } = await pushToken(); await m.deleteToken(messaging); }catch{}
  try{ await FB.m.deleteDoc(FB.m.doc(FB.fs,"pushTokens",old)); }catch{}
  keepPush("", S.push.prefs); toast("알림을 껐어요");
}
// 로그인할 때마다 토큰을 새로 확인해 저장 (토큰은 가끔 바뀌고, 이름·권한이 바뀌었을 수도 있어서)
async function refreshPush(){
  if(!S.push.token || !vapidKey || !("Notification" in window) || Notification.permission!=="granted") return;
  try{ const { token } = await pushToken(); await saveToken(token, S.push.prefs);
    if(token!==S.push.token){ try{ await FB.m.deleteDoc(FB.m.doc(FB.fs,"pushTokens",S.push.token)); }catch{} keepPush(token, S.push.prefs); }
  }catch{}
}
function topicsSheet(){
  if(S.canEdit) openSheet("기도제목", `<div class="fields"><label class="field"><span class="sr-only">기도제목</span><textarea id="t-topics" name="topics" rows="16">${esc(S.topics||DEFAULT_TOPICS)}</textarea></label></div>`,
    `<button class="btn" type="button" data-act="copyTopics">${icon("copy")}복사</button><button class="btn pri" type="button" data-act="saveTopics">저장</button>`);
  else openSheet("기도제목", `<div class="plain-text">${esc(S.topics||DEFAULT_TOPICS)}</div>`, `<button class="btn pri" type="button" data-act="copyTopics">${icon("copy")}복사</button>`);
}
function importSheet(){
  openSheet("데이터 가져오기", `<div class="fields"><label class="field"><span>받은 json 파일 고르기 (데이터·생일 파일)</span><input id="imp-file" type="file" accept=".json,application/json"><span class="hint">같은 날짜·사람은 파일 내용으로 덮어써요. 처음 한 번만 하면 돼요.</span></label></div>`);
}
const val = id => document.getElementById(id)?.value.trim() ?? "";

/* ---------- 부서 · 탭 · 메뉴 ---------- */
const TAB_ICON = {
  dash:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fillable" d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
  schedule:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect class="fillable" x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  people:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle class="fillable" cx="9" cy="8" r="3.5"/><path class="fillable" d="M2.5 20c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6z"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20c-.5-2.5-1.8-4.1-3.6-4.9"/></svg>',
  script:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fillable" d="M6 3h8.5L19 7.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/></svg>',
  more:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle class="fillable" cx="12" cy="12" r="8.5"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
  birth:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fillable" d="M5 20.5v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7z"/><path d="M4 20.5h16M5 15.5c1.2 1 2.4 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 11.5v-3M12 5.6c.8-.6 1-1.5 0-2.6-1 1.1-.8 2 0 2.6z"/></svg>',
  births:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect class="fillable" x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v3M16 3v3M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/></svg>',
};
const DEPTS = {
  social: { name:"사회부", desc:"예배 사회·대표기도·원고", icon:"mic", color:"#2F78D0", home:"dash",
            tabs:[["dash","홈"],["schedule","일정"],["people","명단",true],["script","원고"],["more","더보기"]] },
  care:   { name:"챙김부", desc:"러너스 생일 챙기기", icon:"cake", color:"#E0663E", home:"birth",
            tabs:[["birth","생일"],["births","전체"],["more","더보기"]] },
};
const ROUTE_DEPT = { dash:"social", schedule:"social", people:"social", script:"social", birth:"care", births:"care" };
function setDept(d){ if(S.dept===d) return; S.dept=d; store.set("runners-dept", d); }
function renderTabs(r){
  const nav=document.getElementById("tabs"); const cur = (r==="members"||r==="requests") ? "more" : r;
  const key = S.dept+"|"+S.canEdit+"|"+S.isAdmin;
  if(nav.dataset.key!==key){
    nav.innerHTML = DEPTS[S.dept].tabs.filter(t=>!t[2]||S.canEdit).map(([k,l])=>`<a href="#${k}">${TAB_ICON[k]}<span>${l}</span></a>`).join("");
    nav.dataset.key = key;
  }
  nav.querySelectorAll("a").forEach(a=>{ a.getAttribute("href")==="#"+cur ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current"); });
  const dl=document.getElementById("dept"); if(dl) dl.textContent = DEPTS[S.dept].name;
}
let drawerOpen=false, drawerReturn=null;
function openDrawer(){
  drawerReturn=document.activeElement; const root=document.getElementById("drawer-root");
  const item = (k) => { const d=DEPTS[k]; const on=S.dept===k;
    return `<a class="dept-item ${on?"on":""}" href="#${d.home}" data-act="goDept" data-dept="${k}" ${on?'aria-current="true"':""}>
      <span class="set-ic" style="--c:${d.color}">${icon(d.icon)}</span><span class="main"><span class="t">${d.name}</span><span class="s">${d.desc}</span></span>${on?icon("check","ck"):""}</a>`; };
  root.innerHTML = `<div class="scrim" data-act="closeDrawer"></div>
    <nav class="drawer" id="drawer" aria-label="부서 메뉴">
      <div class="drawer-h"><span class="brand-sm"><img src="icons/icon-192.png" alt="" width="28" height="28">러너스</span>
        <button class="btn icon sm" type="button" data-act="closeDrawer" aria-label="메뉴 닫기">${icon("x")}</button></div>
      <p class="drawer-label">부서</p>
      ${ALL_DEPTS.filter(sees).map(item).join("")}
      <div class="drawer-sep"></div>
      <a class="dept-item" href="#more" data-act="closeDrawer"><span class="set-ic" style="--c:#6A7A95">${icon("bell")}</span><span class="main"><span class="t">더보기 · 설정</span><span class="s">알림, 화면 모드${S.isAdmin?", 멤버 관리":""}</span></span></a>
      <div class="drawer-foot">${av(myName()||S.user?.email||"?","sm")}<span>${esc(myName()||"")}</span></div>
    </nav>`;
  drawerOpen=true; document.body.style.overflow="hidden";
  document.querySelector(".menu-btn")?.setAttribute("aria-expanded","true");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ root.className="open"; root.querySelector(".dept-item.on, .dept-item")?.focus({preventScroll:true}); }));
}
function closeDrawer(){
  if(!drawerOpen) return; drawerOpen=false; const root=document.getElementById("drawer-root");
  root.className="open closing"; document.body.style.overflow="";
  document.querySelector(".menu-btn")?.setAttribute("aria-expanded","false");
  setTimeout(()=>{ if(!drawerOpen){ root.innerHTML=""; root.className=""; } }, 260);
  if(drawerReturn && document.contains(drawerReturn)) drawerReturn.focus({preventScroll:true});
}

/* ---------- 챙김부: 생일 ---------- */
const HONOR = { "목자":"목자님", "형제":"형제님", "자매":"자매님" };
const honor = b => `${b.name} ${HONOR[b.role]||"님"}`.replace(/ 님$/,"님");
function nextBday(b){
  const t=parse(TODAY); let y=t.getFullYear();
  const mk = y => { const last=new Date(y, b.month, 0).getDate(); return new Date(y, b.month-1, Math.min(b.day,last)); };
  let d=mk(y); if(d<t) d=mk(y+1);
  return d;
}
function births(){
  return S.births.filter(b=>b.month&&b.day&&b.name).map(b=>{ const n=nextBday(b); return {...b, next:n, dd:Math.round((n-parse(TODAY))/864e5)}; });
}
const ddChip = dd => dd===0 ? `<span class="chip warm plain">오늘</span>` : dd<=7 ? `<span class="chip acc plain tnum">D-${dd}</span>` : dd<=30 ? `<span class="chip mute plain tnum">D-${dd}</span>` : "";
const roleChip2 = r => r ? `<span class="chip plain role-${r==="목자"?"mok":r==="형제"?"bro":"sis"}">${esc(r)}</span>` : "";
const bdBox = b => `<span class="datebox"><span class="m">${b.month}월</span><span class="d">${b.day}</span></span>`;
function birthRow(b, opts={}){
  const tag = can("care") ? "button" : "div";
  return `<${tag} ${tag==="button"?`type="button" data-act="editBirth" data-id="${b.id}"`:""} class="row bday ${b.dd===0?"is-today":""} ${opts.past?"past":""}" aria-label="${b.month}월 ${b.day}일 ${esc(honor(b))}">
    ${bdBox(b)}<span class="main"><span class="t">${esc(b.name)} ${roleChip2(b.role)}</span>${opts.sub?`<span class="s">${opts.sub}</span>`:""}</span>${opts.chip??ddChip(b.dd)}${tag==="button"?icon("chev","chev"):""}</${tag}>`;
}
function monthText(m){
  const list = births().filter(b=>b.month===m).sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,"ko"));
  return `🎂 ${m}월 러너스 생일 (${list.length}명)\n` + list.map(b=>`${pad(b.month)}.${pad(b.day)} ${honor(b)}`).join("\n");
}
function vBirth(){
  const all = births(); const m = parse(TODAY).getMonth()+1; const nm = m%12+1;
  if(!all.length) return `${head("러너스 생일","","", "챙김부")}<div class="card">${empty("아직 생일 정보가 없어요", can("care")?(S.isAdmin?"더보기 → 데이터 가져오기에서 생일 파일을 올리거나, ":"")+"전체 탭에서 한 명씩 추가해 주세요.":"관리자가 생일 정보를 올리면 여기에 보여요.","wave", can("care")?`<a class="btn pri" href="#births">전체 탭으로</a>`:"")}</div>`;
  const today = all.filter(b=>b.dd===0);
  const soon = all.filter(b=>b.dd>0 && b.dd<=14).sort((a,b)=>a.dd-b.dd||a.name.localeCompare(b.name,"ko"));
  const nextDd = Math.min(...all.map(b=>b.dd).filter(d=>d>0));
  const nextGroup = all.filter(b=>b.dd===nextDd);
  const heroNames = list => `<div class="bd-names">${list.map(b=>`<span class="bd-name">${av(b.name,"sm")}${esc(b.name)}<small>${esc(HONOR[b.role]?b.role:"")}</small></span>`).join("")}</div>`;
  const hero = today.length ? `
    <section class="hero care" aria-label="오늘 생일">
      ${SPARK("50%","18px",22)}${SPARK("40%","80px",12)}${SPARK("14px","calc(100% - 70px)",14,.8)}
      <div class="hero-top"><div class="eyebrow">오늘은</div><div class="date">생일이에요!</div>
        <div class="meta"><span>${fmtKo(TODAY)}</span><span>${today.length}명</span></div>${sheep("heart","hero-sheep")}</div>
      ${heroNames(today)}
      <div class="hero-actions"><button class="btn pri" type="button" data-act="copyToday">${icon("copy")}축하 메시지 복사</button></div>
    </section>` : `
    <section class="hero care" aria-label="다음 생일">
      ${SPARK("50%","18px",20)}${SPARK("42%","78px",11)}
      <div class="hero-top"><div class="eyebrow">다음 생일</div><div class="date">${nextGroup[0].month}월 ${nextGroup[0].day}일</div>
        <div class="meta"><span>D-${nextDd}</span><span>${["일","월","화","수","목","금","토"][nextGroup[0].next.getDay()]}요일</span></div>${sheep("heart","hero-sheep")}</div>
      ${heroNames(nextGroup)}
    </section>`;
  const monthList = all.filter(b=>b.month===m).sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,"ko"));
  const nextList = all.filter(b=>b.month===nm).sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,"ko"));
  const copyBtn = mm => `<button class="link" type="button" data-act="copyMonth" data-m="${mm}">${icon("copy")}복사</button>`;
  return `${head("러너스 생일", `전체 ${all.length}명`, "", "챙김부")}${hero}
    <div class="cols"><div>
      ${section("2주 안에 다가오는 생일", soon.length?`<div class="card list">${soon.map(b=>birthRow(b,{sub:`${b.next.getMonth()+1}월 ${b.next.getDate()}일 ${["일","월","화","수","목","금","토"][b.next.getDay()]}요일`})).join("")}</div>`:`<div class="card"><p class="note" style="padding:16px">2주 안에는 생일이 없어요</p></div>`)}
    </div><div>
      ${section(`${m}월 생일 <span class="cnt">${monthList.length}</span>`, `<div class="card list">${monthList.map(b=>birthRow(b,{past:b.dd>300, chip:b.dd>300?`<span class="chip mute plain">지남</span>`:undefined})).join("")||`<p class="note" style="padding:16px">이번 달은 생일이 없어요</p>`}</div>`, copyBtn(m))}
      ${section(`${nm}월 생일 <span class="cnt">${nextList.length}</span>`, `<div class="card list">${nextList.map(b=>birthRow(b)).join("")||`<p class="note" style="padding:16px">생일이 없어요</p>`}</div>`, copyBtn(nm))}
    </div></div>`;
}
function vBirths(){
  const q = S.birthQ.trim(); const all = births();
  const cm = parse(TODAY).getMonth()+1;
  const list = all.filter(b=>!q || b.name.includes(q));
  const months = Array.from({length:12},(_,i)=>i+1);
  return `${head("전체 생일", `${all.length}명 · 목자 ${all.filter(b=>b.role==="목자").length} · 형제 ${all.filter(b=>b.role==="형제").length} · 자매 ${all.filter(b=>b.role==="자매").length}`,
      can("care")?`<button class="btn pri" type="button" data-act="editBirth">${icon("plus")}추가</button>`:"")}
    <div class="year-bar month-bar">
      <label class="sr-only" for="bq">이름 검색</label>
      <input id="bq" type="search" placeholder="이름으로 찾기…" autocomplete="off" autocapitalize="none" autocorrect="off" enterkeyhint="search" spellcheck="false" value="${esc(S.birthQ)}">
      ${q?"":`<div class="seg mini months" role="group" aria-label="월로 이동">${months.map(mm=>`<button type="button" data-act="jumpMonth" data-m="${mm}" aria-pressed="${mm===cm}">${mm}월</button>`).join("")}</div>`}
    </div>
    <div class="section" style="gap:0">${months.map(mm=>{ const ms=list.filter(b=>b.month===mm).sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,"ko"));
      if(!ms.length && q) return "";
      return `<div class="month-h" id="m-${mm}"><span>${mm}월 · ${ms.length}명</span></div>
        <div class="card list">${ms.map(b=>birthRow(b)).join("")||`<p class="note" style="padding:16px">생일이 없어요</p>`}</div>`; }).join("") || `<div class="card">${empty("찾는 사람이 없어요","이름을 다시 확인해 주세요.","wave",`<button class="btn" type="button" data-act="clearBirthQ">검색 지우기</button>`)}</div>`}</div>`;
}
function birthSheet(id){
  const b = S.births.find(x=>x.id===id) || {name:"",role:"형제",month:parse(TODAY).getMonth()+1,day:1};
  openSheet(id?esc(b.name):"생일 추가", `<div class="fields">
    <div class="field-row">
      <label class="field"><span>이름</span><input id="b-name" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(b.name)}"></label>
      <label class="field"><span>구분</span><select id="b-role">${["목자","형제","자매",""].map(r=>`<option value="${r}" ${b.role===r?"selected":""}>${r||"없음"}</option>`).join("")}</select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>월</span><select id="b-month">${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${+b.month===m?"selected":""}>${m}월</option>`).join("")}</select></label>
      <label class="field"><span>일</span><select id="b-day">${Array.from({length:31},(_,i)=>i+1).map(d=>`<option value="${d}" ${+b.day===d?"selected":""}>${d}일</option>`).join("")}</select></label>
    </div></div>`,
    `${id?`<button class="btn danger" type="button" data-act="delBirth" data-id="${id}">삭제</button>`:""}<button class="btn pri" type="button" data-act="saveBirth" data-id="${id||""}">저장</button>`);
}

/* ---------- 수정 요청 ---------- */
const REQ_CAT = { bug:["오류·불편","#C23A3F"], idea:["기능 제안","#2F78D0"], etc:["기타","#6A7A95"] };
const REQ_ST = { open:["접수","warn"], doing:["확인 중","acc"], done:["반영 완료","ok"], hold:["보류","mute"] };
const openReqCount = () => S.requests.filter(r=>r.status==="open").length;
const tsOf = r => r.createdAt?.toDate ? r.createdAt.toDate() : r.createdAt instanceof Date ? r.createdAt : null;
function ago(d){ if(!d) return "방금"; const m=Math.round((Date.now()-d)/6e4); if(m<1) return "방금"; if(m<60) return `${m}분 전`; const h=Math.round(m/60); if(h<24) return `${h}시간 전`; const dd=Math.round(h/24); if(dd<7) return `${dd}일 전`; return `${d.getMonth()+1}.${pad(d.getDate())}`; }
const stChip = r => { const [t,c]=REQ_ST[r.status]||REQ_ST.open; return `<span class="chip ${c} plain">${t}</span>`; };
const catChip = r => { const [t]=REQ_CAT[r.cat]||REQ_CAT.etc; return `<span class="chip mute plain">${t}</span>`; };
function reqRow(r, admin){
  const first = (r.text||"").split("\n")[0];
  return `<button type="button" class="row req" data-act="openReq" data-id="${r.id}">
    ${admin?av(r.name||r.email):`<span class="set-ic" style="--c:${(REQ_CAT[r.cat]||REQ_CAT.etc)[1]}">${icon("edit")}</span>`}
    <span class="main"><span class="t">${admin?esc(r.name||"(이름 없음)"):esc(first)} ${stChip(r)}</span>
      <span class="s">${admin?`${esc(first)}`:`${catChip(r).replace(/<[^>]+>/g,"")} · ${ago(tsOf(r))}${r.reply?" · 답변 있음":""}`}</span>
      ${admin?`<span class="s">${(REQ_CAT[r.cat]||REQ_CAT.etc)[0]} · ${r.where?esc(r.where)+" · ":""}${ago(tsOf(r))}${r.reply?" · 답변함":""}</span>`:""}</span>${icon("chev","chev")}</button>`;
}
function vRequests(){
  const admin = S.isAdmin; const tab = admin ? S.reqTab : "write";
  const mine = S.requests.filter(r=>r.uid===S.user?.uid);
  const sorted = list => [...list].sort((a,b)=>(tsOf(b)||new Date())-(tsOf(a)||new Date()));
  const compose = `<div class="card fields">
      <div class="field"><span class="lab" id="lab-cat">종류</span><div class="seg" role="group" aria-labelledby="lab-cat">${Object.entries(REQ_CAT).map(([k,[t]])=>`<button type="button" data-act="reqCat" data-v="${k}" aria-pressed="${S.reqCat===k}">${t}</button>`).join("")}</div></div>
      <label class="field"><span>어떤 화면에서요? (선택)</span><input id="rq-where" maxlength="40" autocomplete="off" placeholder="예: 챙김부 · 전체 생일"></label>
      <label class="field"><span>내용</span><textarea id="rq-text" rows="6" maxlength="2000" placeholder="불편했던 점, 고쳐 줬으면 하는 점, 있었으면 하는 기능을 자유롭게 적어 주세요"></textarea></label>
      <div class="field"><button class="btn pri block" type="button" data-act="sendReq">${icon("upload")}관리자에게 보내기</button><span class="hint">관리자(진규님 포함)만 볼 수 있어요. 답변이 달리면 아래 '내가 보낸 요청'에서 볼 수 있어요.</span></div>
    </div>`;
  const myList = section("내가 보낸 요청", mine.length?`<div class="card list">${sorted(mine).map(r=>reqRow(r,false)).join("")}</div>`:`<div class="card"><p class="note" style="padding:16px">아직 보낸 요청이 없어요</p></div>`);
  if(!admin) return `${head("수정 요청","불편한 점이나 바라는 기능을 관리자에게 보내요")}${compose}${myList}`;
  const groups = [["open","새로 온 요청"],["doing","확인 중"],["hold","보류"],["done","반영 완료"]];
  const inbox = S.requests.length ? groups.map(([st,t])=>{ const l=sorted(S.requests.filter(r=>(r.status||"open")===st)); return l.length?section(`${t} <span class="cnt">${l.length}</span>`, `<div class="card list">${l.map(r=>reqRow(r,true)).join("")}</div>`):""; }).join("")
    : `<div class="card">${empty("아직 받은 요청이 없어요","멤버들이 더보기 → 수정 요청에서 보내면 여기에 모여요.","wave")}</div>`;
  return `${head("수정 요청", openReqCount()?`새로 온 요청 ${openReqCount()}건`:"받은 요청을 확인하고 답해 주세요")}
    <div class="seg" role="group" aria-label="보기">
      <button type="button" data-act="reqTab" data-v="inbox" aria-pressed="${tab==="inbox"}">받은 요청${openReqCount()?` ${openReqCount()}`:""}</button>
      <button type="button" data-act="reqTab" data-v="write" aria-pressed="${tab==="write"}">요청 보내기</button>
    </div>
    ${tab==="inbox"?inbox:compose+myList}`;
}
function reqSheet(id){
  const r = S.requests.find(x=>x.id===id); if(!r) return;
  const admin = S.isAdmin; const own = r.uid===S.user?.uid;
  const d = tsOf(r);
  openSheet(admin&&!own?`${esc(r.name||"")}님의 요청`:"내 요청", `<div class="fields">
    <div class="field"><span>${(REQ_CAT[r.cat]||REQ_CAT.etc)[0]}${r.where?` · ${esc(r.where)}`:""} · ${d?`${d.getMonth()+1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`:"방금"}</span>
      <div class="req-text">${esc(r.text)}</div>${admin?`<span class="hint">${esc(r.email||"")}</span>`:""}</div>
    ${admin?`<div class="field"><span class="lab" id="lab-st">처리 상태</span><div class="seg" role="radiogroup" aria-labelledby="lab-st">${Object.entries(REQ_ST).map(([k,[t]])=>`<button type="button" role="radio" data-act="reqSt" data-v="${k}" aria-pressed="${(r.status||"open")===k}" aria-checked="${(r.status||"open")===k}">${t}</button>`).join("")}</div></div>
      <label class="field"><span>답변 (요청한 사람에게 보여요)</span><textarea id="rq-reply" rows="4" maxlength="2000" placeholder="예: 다음 업데이트에 반영할게요!">${esc(r.reply||"")}</textarea></label>`
    :`<div class="field"><span>처리 상태</span><span class="readout">${(REQ_ST[r.status]||REQ_ST.open)[0]}</span></div>
      <div class="field"><span>관리자 답변</span><div class="req-text ${r.reply?"":"muted"}">${r.reply?esc(r.reply):"아직 답변이 없어요"}</div></div>`}
    </div>`,
    admin ? `<button class="btn danger" type="button" data-act="delReq" data-id="${r.id}">삭제</button><button class="btn pri" type="button" data-act="saveReq" data-id="${r.id}">저장</button>`
    : (r.status||"open")==="open" ? `<button class="btn danger block" type="button" data-act="delReq" data-id="${r.id}">요청 취소</button>` : "");
}

/* ---------- 렌더 ---------- */
const ROUTES = {dash:vDash, schedule:vSchedule, people:vPeople, script:vScript, more:vMore, members:vMembers, birth:vBirth, births:vBirths, requests:vRequests};
function homeRoute(){ if(!sees(S.dept)){ const d=ALL_DEPTS.find(sees); if(d) setDept(d); else return "more"; } return DEPTS[S.dept].home; }
function route(){ const h=location.hash.slice(1);
  if(S.approved && !sees(S.dept)){ const d=ALL_DEPTS.find(sees); if(d) setDept(d); }
  if(h==="members" && !S.isAdmin) return homeRoute();
  if(h==="people" && !can("social")) return homeRoute();
  if(ROUTE_DEPT[h] && !sees(ROUTE_DEPT[h])) return homeRoute();
  if(ROUTES[h]){ if(ROUTE_DEPT[h]) setDept(ROUTE_DEPT[h]); return h; } return homeRoute(); }
function skeleton(){
  return `<div aria-busy="true" aria-label="불러오는 중…" style="display:flex;flex-direction:column;gap:24px;padding-top:12px">
    <div class="sk" style="width:140px;height:36px"></div><div class="sk" style="height:360px;border-radius:32px"></div>
    <div class="card">${Array.from({length:3},()=>`<div class="row"><div class="sk" style="width:52px;height:46px"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="sk" style="width:70%;height:24px;border-radius:999px"></div><div class="sk" style="width:50%;height:12px"></div></div></div>`).join("")}</div></div>`;
}
function render(){
  const main=document.getElementById("main");
  const gate = !S.authReady || !S.user;
  document.body.classList.toggle("gate", gate);
  if(gate){
    if(!S.authReady && S.mode!=="setup"){ main.innerHTML=""; return; } // 로그인 상태 확인 전엔 잠깐 빈 화면 (로그인 화면이 깜빡이지 않도록)
    main.innerHTML = vLogin(); syncThemeButtons(); return;
  }
  if(!S.memberReady){ document.body.classList.add("gate"); main.innerHTML=""; return; }
  if(!S.approved){ document.body.classList.add("gate"); const ae=document.activeElement?.id; main.innerHTML = vPending(); syncThemeButtons(); if(ae) document.getElementById(ae)?.focus({preventScroll:true}); return; }
  const r=route();
  renderTabs(r);
  const me=document.getElementById("me"); me.hidden=false; me.innerHTML=av(myName()||S.user.email,"");
  syncThemeButtons();
  S.all = mergedWeeks();
  // 그 화면에 필요한 데이터만 기다려요 (더보기·멤버 관리는 기다릴 것 없음)
  const need = ROUTE_DEPT[r];
  if(need==="care" && !S.got.b){ main.innerHTML=skeleton(); return; }
  if(r==="members" && !S.got.m){ main.innerHTML=skeleton(); return; }
  if(r==="requests" && !S.got.r){ main.innerHTML=skeleton(); return; }
  if(need==="social" && (!S.got.s || !S.got.w)){ main.innerHTML = S.mode==="slow" ? `<div class="card" style="margin-top:24px">${empty("아직 연결 중이에요","인터넷 연결을 확인해 주세요. 한 번 열어 본 내용은 오프라인에서도 보여요.","pray")}</div>` : skeleton(); return; }
  if(r==="people" && !S.got.p){ main.innerHTML=skeleton(); return; }
  const ae=document.activeElement; const aid=ae?.id && main.contains(ae) ? ae.id : null; const sel=aid&&"selectionStart" in ae?[ae.selectionStart,ae.selectionEnd]:null;
  main.innerHTML = (S.mode==="slow"?`<div class="banner">연결이 느려서 최신 내용이 아닐 수 있어요.</div>`:"") + ROUTES[r]();
  if(aid){ const el=document.getElementById(aid); if(el){ el.focus({preventScroll:true}); if(sel) try{el.setSelectionRange(...sel);}catch{} } }
  if(r==="schedule" && !S.schedScrolled){ S.schedScrolled=true; document.getElementById("next-row")?.scrollIntoView({block:"center"}); }
}
window.addEventListener("hashchange", ()=>{ closeSheet(); closeDrawer(); window.scrollTo(0,0); if(route()==="schedule") S.schedScrolled=false; render(); });
window.addEventListener("scroll", ()=>document.getElementById("top").classList.toggle("scrolled", scrollY>4), {passive:true});

/* ---------- 이벤트 ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if(!t) return;
  const a = t.dataset.act;
  if(a==="closeSheet"){ closeSheet(); return; }
  if(a==="menu"){ drawerOpen?closeDrawer():openDrawer(); return; }
  if(a==="closeDrawer"){ closeDrawer(); return; }
  if(a==="goDept"){ if(!sees(t.dataset.dept)) return; setDept(t.dataset.dept); closeDrawer(); if(location.hash==="#"+DEPTS[S.dept].home) render(); return; }
  if(a==="theme"){ setTheme(!isDark()); if(route()==="more"&&!document.body.classList.contains("gate")) render(); return; }
  if(a==="themeSet"){ setTheme(t.dataset.v==="dark"); render(); return; }
  if(a==="openScript"){ syncScript(t.dataset.date); S.scriptTab="script"; if(route()==="script") render(); else location.hash="#script"; return; }
  if(a==="schedYear"){ S.schedYear=t.dataset.v; render(); }
  if(a==="peopleFilter"){ S.peopleFilter=t.dataset.v; render(); }
  if(a==="resetPeople"){ S.peopleFilter="all"; S.peopleQ=""; render(); }
  if(a==="scriptTab"){ S.scriptTab=t.dataset.v; render(); }
  if(a==="topics") topicsSheet();
  if(a==="notify") notifySheet();
  if(a==="pushOn"){ if(!myName()){ toast("이름이 없어서 켤 수 없어요. 관리자에게 이름 등록을 부탁해 주세요"); return; }
    t.disabled=true; t.textContent="켜는 중…";
    try{ if(await pushOn(readPrefs())){ closeSheet(); render(); } else { t.disabled=false; t.textContent="알림 켜기"; } }
    catch(err){ t.disabled=false; t.textContent="알림 켜기"; toast(err?.message==="unsupported"?"이 기기는 알림을 지원하지 않아요":"알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요"); }
  }
  if(a==="pushSave"){ const p=readPrefs(); t.disabled=true;
    try{ await saveToken(S.push.token, p); keepPush(S.push.token, p); toast("알림 설정을 저장했어요"); closeSheet(); render(); }
    catch{ t.disabled=false; toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요"); } }
  if(a==="day"){ const on=t.getAttribute("aria-pressed")==="true";
    if(on && t.parentElement.querySelectorAll('[aria-pressed="true"]').length===1){ toast("요일을 하나 이상 골라 주세요"); return; }
    t.setAttribute("aria-pressed", String(!on)); return; }
  if(a==="goMembers") location.hash="#members";
  if(a==="goRequests") location.hash="#requests";
  if(a==="reqTab"){ S.reqTab=t.dataset.v; render(); }
  if(a==="reqCat"){ S.reqCat=t.dataset.v; t.parentElement.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", String(b===t))); return; }
  if(a==="reqSt"){ t.parentElement.querySelectorAll("button").forEach(b=>{ b.setAttribute("aria-pressed", String(b===t)); b.setAttribute("aria-checked", String(b===t)); }); return; }
  if(a==="openReq") reqSheet(t.dataset.id);
  if(a==="sendReq"){ const text=document.getElementById("rq-text")?.value.trim(); if(!text){ toast("내용을 적어 주세요"); return; }
    const ref = S.db.collection("requests").doc(); t.disabled=true;
    const body = { uid:S.user.uid, name:myName(), email:S.user.email||"", cat:S.reqCat, where:val("rq-where"), text, status:"open", reply:"", notified:false, createdAt:FB.m.serverTimestamp() };
    if(await write(()=>ref.set(body), "보냈어요. 고마워요!")){ document.getElementById("rq-text").value=""; document.getElementById("rq-where").value=""; }
    t.disabled=false; }
  if(a==="saveReq"){ const st=document.querySelector('[data-act="reqSt"][aria-pressed="true"]')?.dataset.v||"open";
    if(await write(()=>S.db.doc("requests/"+t.dataset.id).update({status:st, reply:val("rq-reply"), updatedAt:FB.m.serverTimestamp()}), "저장했어요")) closeSheet(); }
  if(a==="editMember") memberSheet(t.dataset.id);

  if(a==="rejectMember"){ const m=S.members.find(x=>x.id===t.dataset.id); const label = m?.status==="pending"?"거절":"내보내기";
    if(t.dataset.confirm!=="1"){ t.dataset.confirm="1"; t.textContent = m?.status==="pending"?"거절할까요?":"정말 내보낼까요?"; t.classList.add("solid");
      setTimeout(()=>{ if(document.contains(t)){ t.dataset.confirm=""; t.textContent=label; t.classList.remove("solid"); } }, 3000); return; }
    if(await write(()=>S.db.doc("members/"+t.dataset.id).update({status:"rejected", role:"member", depts:[]}), "처리했어요")) closeSheet(); }
  if(a==="deleteMember") await write(()=>S.db.doc("members/"+t.dataset.id).delete(), "기록을 지웠어요. 다시 로그인하면 새로 신청돼요");
  if(a==="saveMember"){ const name=val("m-name"); if(!name){ toast("이름을 적어 주세요"); return; }
    const role=document.querySelector('input[name="m-role"]:checked')?.value; const patch={name};
    if(role){ patch.role=role; patch.depts=[...document.querySelectorAll('input[name="m-dept"]:checked')].map(x=>x.value);
      if(role!=="admin" && !patch.depts.length){ toast("활동 부서를 하나 이상 골라 주세요"); return; } }
    if(t.dataset.approve) patch.status="approved";
    if(await write(()=>S.db.doc("members/"+t.dataset.id).update(patch), t.dataset.approve?`${name}님을 승인했어요`:"저장했어요")) closeSheet(); }
  if(a==="savePendName"){ const name=val("pend-name"); if(!name){ toast("이름을 적어 주세요"); return; }
    try{ await FB.m.updateDoc(FB.m.doc(FB.fs,"members",S.user.uid), {name}); toast("이름을 저장했어요"); }catch{ toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요"); } }
  if(a==="pushOff"){ t.disabled=true; await pushOff(); closeSheet(); render(); }
  if(a==="importSheet") importSheet();
  if(a==="assign"){ t.disabled=true; await assign(t.dataset.name, t.dataset.date); }
  if(a==="editWeek") weekSheet(t.dataset.date);
  if(a==="saveWeek"){
    const date=t.dataset.date; const k=val("w-kind"); const ev = k==="__other"?val("w-other"):k;
    if(k==="__other"&&!ev){ toast("행사 이름을 적어 주세요"); return; }
    const base = weekAt(date);
    const body = ev ? opsOf(base, {event:ev, mc:"", prayer:""}) : opsOf(base, {event:"", mc:val("w-mc"), prayer:val("w-prayer"), hymn:val("w-hymn")});
    t.disabled=true;
    if(await write(()=>S.db.doc("weeks/"+date).set(body), "저장했어요")){
      if(S.script.date===date) syncScript(date); closeSheet();
      await applyPriorities(S.people, [...S.weeks.filter(w=>w.date!==date), body]);
    } else t.disabled=false;
  }
  if(a==="cancelConfirm"){ const f=document.querySelector(".sheet-f"); f.innerHTML=f.dataset.orig; return; }
  if((a==="delWeek"||a==="delPerson"||a==="delBirth"||a==="delReq") && t.dataset.confirm!=="1"){
    const f=t.closest(".sheet-f"); f.dataset.orig=f.innerHTML;
    const what = a==="delWeek" ? ["배정을 지울까요?","사회·대표기도·찬송이 비워져요. 본문은 그대로예요."] : a==="delBirth" ? ["이 생일을 삭제할까요?","되돌릴 수 없어요."] : a==="delReq" ? ["이 요청을 지울까요?","되돌릴 수 없어요."] : ["이 사람을 명단에서 삭제할까요?","되돌릴 수 없어요. 순위는 자동으로 다시 정리돼요."];
    f.innerHTML = `<div class="confirm"><strong>${what[0]}</strong><span>${what[1]}</span></div><button class="btn" type="button" data-act="cancelConfirm">취소</button><button class="btn danger solid" type="button" data-act="${a}" data-confirm="1" ${a==="delWeek"?`data-date="${t.dataset.date}"`:`data-id="${t.dataset.id}"`}>${a==="delWeek"||a==="delReq"?"지우기":"삭제"}</button>`;
    f.querySelector('[data-confirm="1"]').focus(); return;
  }
  if(a==="delWeek"){
    const dd=t.dataset.date;
    if(await write(()=>S.db.doc("weeks/"+dd).delete(),"배정을 지웠어요")){ closeSheet(); await applyPriorities(S.people, S.weeks.filter(w=>w.date!==dd)); }
  }
  if(a==="editPerson") personSheet(t.dataset.id||null);
  if(a==="rankUp") moveRank(t.dataset.id,-1);
  if(a==="rankClear") clearRank(t.dataset.id);
  if(a==="rankFill") applyPriorities(S.people, S.weeks);
  if(a==="savePerson"){
    const name=val("p-name"); if(!name){ toast("이름을 적어 주세요"); return; }
    const id=t.dataset.id; if(S.people.some(p=>p.name===name && p.id!==id)){ toast("같은 이름이 이미 있어요"); return; }
    const st=document.querySelector('input[name="p-st"]:checked')?.value||"ok";
    const body={name, last:val("p-last"), note:val("p-note"), priority:+val("p-pri")||0, hold:st==="hold", excluded:st==="excluded"};
    const ref = id ? S.db.doc("people/"+id) : S.db.collection("people").doc();
    const prevRank = id ? (S.people.find(x=>x.id===id)?.priority||0) : 0;
    t.disabled=true;
    if(await write(()=>ref.set(body),"저장했어요")){
      closeSheet();
      const next = id ? S.people.map(x=>x.id===id?{...x,...body}:x) : [...S.people,{id:ref.id,...body}];
      await applyPriorities(next, S.weeks, ref.id, body.priority!==prevRank || body.priority ? body.priority : null);
    } else t.disabled=false;
  }
  if(a==="delReq"){ if(await write(()=>S.db.doc("requests/"+t.dataset.id).delete(),"지웠어요")) closeSheet(); }
  if(a==="delBirth"){ if(await write(()=>S.db.doc("birthdays/"+t.dataset.id).delete(),"삭제했어요")) closeSheet(); }
  if(a==="editBirth") birthSheet(t.dataset.id||null);
  if(a==="saveBirth"){ const name=val("b-name"); if(!name){ toast("이름을 적어 주세요"); return; }
    const body={name, role:val("b-role"), month:+val("b-month"), day:+val("b-day")};
    const ref = t.dataset.id ? S.db.doc("birthdays/"+t.dataset.id) : S.db.collection("birthdays").doc();
    t.disabled=true; if(await write(()=>ref.set(body),"저장했어요")) closeSheet(); else t.disabled=false; }
  if(a==="copyMonth") copy(monthText(+t.dataset.m));
  if(a==="copyToday"){ const td=births().filter(b=>b.dd===0); copy(`🎉 오늘은 ${td.map(honor).join(", ")} 생일이에요! 다 같이 축하해 주세요 🎂`); }
  if(a==="jumpMonth"){ const el=document.getElementById("m-"+t.dataset.m); if(el){ const bar=document.querySelector(".month-bar"); const y=el.getBoundingClientRect().top+scrollY-(bar?bar.offsetHeight+70:80); scrollTo({top:y, behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); }
    t.parentElement.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", String(b===t))); return; }
  if(a==="clearBirthQ"){ S.birthQ=""; render(); }
  if(a==="delPerson"){
    const did=t.dataset.id;
    if(await write(()=>S.db.doc("people/"+did).delete(),"삭제했어요")){ closeSheet(); await applyPriorities(S.people.filter(x=>x.id!==did), S.weeks); }
  }
  if(a==="copyScript") copy(scriptText());
  if(a==="saveLines"){ const sc=S.script; if(!sc.date) return;
    await write(()=>S.db.doc("weeks/"+sc.date).set(opsOf(weekAt(sc.date), {mukdo:sc.mukdo, offering:sc.offering})),"묵도·헌금기도를 저장했어요"); }
  if(a==="copyTopics") copy(document.getElementById("t-topics")?.value || S.topics || DEFAULT_TOPICS);
  if(a==="saveTopics"){ const v=document.getElementById("t-topics").value; if(await write(()=>S.db.doc("config/topics").set({text:v}),"기도제목을 저장했어요")) closeSheet(); }
  if(a==="login") login();
  if(a==="logout"){ await AUTH.signOut(); location.hash="#dash"; toast("로그아웃했어요"); }
  if(a==="install" && S.installEvt){ S.installEvt.prompt(); S.installEvt=null; render(); }
});
document.addEventListener("change", async e => {
  if(e.target.id==="s-date"){ syncScript(e.target.value); render(); return; }
  if(e.target.id!=="imp-file" || !e.target.files[0]) return;
  try{
    const data = JSON.parse(await e.target.files[0].text());
    if(!["people","weeks","birthdays"].some(k=>Array.isArray(data[k])) && typeof data.topics!=="string") throw new Error("bad");
    await IMPORT(data); closeSheet();
    toast("가져왔어요: " + [data.people&&`사람 ${data.people.length}명`, data.weeks&&`주일 ${data.weeks.length}주`, data.birthdays&&`생일 ${data.birthdays.length}명`, data.topics&&"기도제목"].filter(Boolean).join(", "));
  }catch(err){ toast(err?.message==="bad"?"이 파일은 러너스 데이터 파일이 아니에요":"가져오지 못했어요. 운영자로 로그인했는지 확인해 주세요"); }
  e.target.value="";
});
document.addEventListener("input", e => {
  const id=e.target.id;
  if(id==="pref-all"){ document.getElementById("alert-list")?.classList.toggle("dim", !e.target.checked); return; }
  if(e.target.matches?.("[data-pref]")){ const cfg=e.target.closest(".alert")?.querySelector(".alert-cfg"); if(cfg) cfg.hidden=!e.target.checked; return; }
  if(e.target.name==="m-role"){ syncDeptPick(); return; }
  if(id==="bq"){ S.birthQ=e.target.value; render(); return; }
  if(id==="pq"){ S.peopleQ=e.target.value; render(); return; }
  if(id==="w-kind"){ const k=e.target.value; document.getElementById("w-other-wrap").hidden = k!=="__other"; document.getElementById("w-roles").hidden = !!k; return; }
  const map={"s-prayer":"prayer","s-honor":"honor","s-book":"book","s-ch":"ch","s-v1":"v1","s-v2":"v2","s-hymn":"hymn","s-mukdo":"mukdo","s-offering":"offering"};
  if(map[id]) S.script[map[id]]=e.target.value;
});
document.addEventListener("keydown", e => { if(e.key==="Escape"){ if(sheetOpen) closeSheet(); else closeDrawer(); } });

/* ---------- 시작 ---------- */
async function login(){
  if(!FB) return;
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = FB.a;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
  try{ await signInWithPopup(FB.auth, provider); }
  catch(e){
    if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e?.code)){
      try{ await signInWithRedirect(FB.auth, provider); }catch{ toast("로그인하지 못했어요. Safari나 Chrome에서 다시 시도해 주세요"); }
    } else if(e?.code==="auth/unauthorized-domain") toast("이 주소가 Firebase 승인된 도메인에 없어요");
    else if(e?.code!=="auth/popup-closed-by-user") toast("로그인하지 못했어요. 잠시 후 다시 시도해 주세요");
  }
}
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); S.installEvt=e; if(route()==="more") render(); });
if("serviceWorker" in navigator){
  // 새 버전이 설치되면 한 번 자동으로 새로고침 (처음 설치 때는 제외)
  const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(hadSW && !reloaded && !sheetOpen){ reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js", {updateViaCache:"none"}).then(reg=>{
    reg.update().catch(()=>{});
    document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") reg.update().catch(()=>{}); });
  }).catch(()=>{});
}

async function loadSermons(){
  try{ const r = await fetch("data/sermons.json", {cache:"no-cache"}); if(r.ok) S.sermons = await r.json(); }catch{}
  S.got.s = true; render();
}
async function startFirebase(){
  if(!firebaseConfig || !firebaseConfig.apiKey){ S.mode="setup"; render(); return; }
  const [appM, authM, fsM] = await Promise.all([import(SDK+"firebase-app.js"), import(SDK+"firebase-auth.js"), import(SDK+"firebase-firestore.js")]);
  const app = appM.initializeApp(firebaseConfig);
  let fs;
  try{ fs = fsM.initializeFirestore(app, {localCache: fsM.persistentLocalCache({tabManager: fsM.persistentMultipleTabManager()})}); }
  catch{ fs = fsM.getFirestore(app); }
  const auth = authM.getAuth(app);
  FB = {app, fs, auth, m:fsM, a:authM};
  S.fbReady = true; S.mode="live"; render();
  const { doc, collection, setDoc, updateDoc, deleteDoc, onSnapshot, getDoc, writeBatch } = fsM;
  S.db = {
    doc(path){ const r=doc(fs, ...path.split("/")); return { id:r.id, set:d=>setDoc(r,d), update:d=>updateDoc(r,d), delete:()=>deleteDoc(r) }; },
    collection(name){ return { doc(){ const r=doc(collection(fs,name)); return { id:r.id, set:d=>setDoc(r,d) }; } }; }
  };
  AUTH = { signOut: ()=>authM.signOut(auth) };
  IMPORT = async (data) => {
    const ops = [
      ...(data.people||[]).map(p=>{ const {id,...rest}=p; return [doc(fs,"people",id), rest]; }),
      ...(data.weeks||[]).map(w=>[doc(fs,"weeks",w.date), w]),
      ...(data.birthdays||[]).map(b=>{ const {id,...rest}=b; return [doc(fs,"birthdays",id), rest]; }),
    ];
    if(data.topics) ops.push([doc(fs,"config","topics"), {text:data.topics}]);
    // 주일 배정은 합쳐 쓰기 (파일에 없는 칸은 그대로 둠)
    for(let i=0;i<ops.length;i+=400){ const b = writeBatch(fs); ops.slice(i,i+400).forEach(([r,d])=>r.parent.id==="weeks" ? b.set(r,d,{merge:true}) : b.set(r,d)); await b.commit(); }
  };
  let unsubs = [], memberUnsub = null, slow = null, started = false;
  const stopData = () => { unsubs.forEach(f=>f()); unsubs=[]; clearTimeout(slow); started=false;
    S.people=[]; S.weeks=[]; S.members=[]; S.births=[]; S.requests=[]; S.got.p=false; S.got.w=false; S.got.m=false; S.got.b=false; S.got.r=false; S.topics=null; };
  // 승인된 멤버만 데이터를 읽기 시작 (관리자는 명단·기도제목·멤버 목록까지)
  const startData = () => {
    if(started) return; started = true;
    slow = setTimeout(()=>{ if(!S.got.w && sees("social")){ S.mode="slow"; render(); } }, 10000);
    if(sees("social")) unsubs.push(onSnapshot(collection(fs,"weeks"), s=>{
      S.weeks = s.docs.map(d=>({...d.data(), date:d.data().date||d.id})); S.got.w=true;
      if(S.mode==="slow") S.mode="live"; clearTimeout(slow); render();
    }, ()=>{ S.got.w=true; render(); toast("일정을 불러오지 못했어요"); }));
    if(sees("care")) unsubs.push(onSnapshot(collection(fs,"birthdays"), s=>{ S.births=s.docs.map(d=>({id:d.id,...d.data()})); S.got.b=true; render(); }, ()=>{ S.got.b=true; render(); }));
    if(can("social")){
      unsubs.push(onSnapshot(collection(fs,"people"), s=>{ S.people=s.docs.map(d=>({id:d.id,...d.data()})); S.got.p=true; render(); }, ()=>{ S.got.p=true; render(); }));
    }
    if(sees("social")) unsubs.push(onSnapshot(doc(fs,"config","topics"), s=>{ S.topics = s.exists() ? (s.data().text||null) : null; }, ()=>{}));
    // 수정 요청: 관리자는 전부, 나머지는 내가 보낸 것만
    const reqQ = S.isAdmin ? collection(fs,"requests") : fsM.query(collection(fs,"requests"), fsM.where("uid","==",S.user.uid));
    unsubs.push(onSnapshot(reqQ, s=>{ S.requests=s.docs.map(d=>({id:d.id,...d.data()})); S.got.r=true; render(); }, ()=>{ S.got.r=true; render(); }));
    if(S.isAdmin) unsubs.push(onSnapshot(collection(fs,"members"), s=>{ S.members=s.docs.map(d=>({id:d.id,...d.data()})); S.got.m=true; render(); }, ()=>{ S.got.m=true; render(); }));
    refreshPush();
  };
  authM.getRedirectResult(auth).catch(()=>{});
  authM.onAuthStateChanged(auth, async u=>{
    stopData(); memberUnsub?.(); memberUnsub=null;
    S.user = u; S.canEdit = false; S.isAdmin = false; S.approved = false; S.isOwner = false; S.member = null; S.memberReady = false; S.authReady = true;
    render();
    if(!u) return;
    // 최고 관리자 확인: Firestore 보안 규칙에 등록된 계정만 이 문서를 읽을 수 있어요
    if(u.email){ try{ await getDoc(doc(fs,"admins",u.email)); S.isOwner = true; }catch{ S.isOwner = false; } }
    const ref = doc(fs,"members",u.uid);
    memberUnsub = onSnapshot(ref, async snap=>{
      if(!snap.exists()){
        // 처음 로그인: 가입 신청 (최고 관리자는 바로 승인된 관리자로)
        const owner = S.isOwner;
        try{ await setDoc(ref, { name:(u.displayName||"").replace(/\s+/g,"").slice(0,20) || (u.email||"").split("@")[0].slice(0,20), email:u.email||"", photo:u.photoURL||"",
          status: owner?"approved":"pending", role: owner?"admin":"member", depts: owner?[...ALL_DEPTS]:[], owner, createdAt: fsM.serverTimestamp() }); }
        catch{ S.memberReady=true; S.member={status:"pending"}; if(S.isOwner){ S.approved=true; S.isAdmin=true; S.canEdit=true; startData(); } else toast("가입 신청을 저장하지 못했어요. 다시 로그인해 주세요"); render(); }
        return;
      }
      const m = snap.data(); const before = [S.approved, S.isAdmin, S.member?.role, deptsOf(S.member).join()].join("|");
      S.member = m; S.memberReady = true;
      S.approved = S.isOwner || m.status==="approved";
      S.isAdmin = S.isOwner || (S.approved && m.role==="admin");
      S.canEdit = can("social");
      // 권한·부서가 바뀌면 읽는 데이터를 다시 정리
      if(before !== [S.approved, S.isAdmin, m.role, deptsOf(m).join()].join("|")) stopData();
      if(S.approved) startData();
      render();
    }, ()=>{ S.memberReady=true; S.member={status:"pending"}; if(S.isOwner){ S.approved=true; S.isAdmin=true; S.canEdit=true; startData(); } render(); });
  });
}

syncThemeButtons();
render();
loadSermons();
startFirebase().catch(()=>{ S.mode="setup"; S.authReady=true; render(); toast("데이터 서버에 연결하지 못했어요"); });
