import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
let FB = null;
let AUTH = { signOut: async () => {} };
let IMPORT = async () => { throw new Error("no-db"); };

const EVENTS = ["통합예배","전국학생수양회","봄수양회","여름수양회","가을수양회","겨울수양회","WMC"];
const DEFAULT_TOPICS = `1. 지난 주 주신 말씀에 대한 감사
- 무슨 말씀이었는지, 러너스에게 어떤 의미가 있는지 (안암UBF anamubf.org "주일말씀" 칸에서 설교 말씀 참고)

2. 세계선교
- 2041년까지 233개국에 10만명 선교사 파송할 수 있도록
- 세계 각 센터가 사랑의 공동체, 영적인 공동체 이룰 수 있도록
- 지혜를 주셔서 다음 세대 리더들을 세울 수 있도록
- 캠퍼스 미션의 불이 타오르고, 말씀의 역사가 충만할 수 있도록
- 세계 대표 '라널드' 목자님과 대륙별, 국가별 지부장들에게 지혜를 허락하여 주시도록
- 우크라이나의 평화와 선교사님들의 안전을 허락하여 주시도록

3. 성서한국
- 우리나라가 제사장 나라로 쓰임 받고, 한국교회와 우리 모임이 하나님께서 주신 사명을 잘 감당하도록
- 본국 5000팀의 일대일을 이루어 주시도록
- 전체 모임을 섬기시는 김느헤미야 목자님, 안암센타를 섬기시는 이창무, 이요한 목자님께 건강과 지혜를 주시도록

4. 러너스
- 100명의 제자들로 성장하고, 각 사람이 하나님 안에서 믿음으로 성장하도록
- 러너스를 섬기는 리더들과 모든 구성원에게 러너스 역사를 이뤄가는데 믿음과 지혜를 주시도록
- 직장생활, 논문, 취업, 대학 입시를 준비하는 분들과 함께하여 주시도록
- 군 선교사로 가 있는 최성준, 최진성, 김주명 형제님들을 보호하여 주시도록

5. 예배
- 예배 모든 순서 하나님 홀로 영광 받으시길
- 예배 말씀 섬기시는 이창무 목자님, 성령으로 함께하시길
- 참석하는 모든 이들에게 집중력과 들을 귀를 허락하셔서 말씀의 은혜가 풍성하게 있을 수 있길`;

const S = {
  db:null, fbReady:false, canEdit:false, mode:"loading", user:null, installEvt:null,
  sermons:{}, weeks:[], people:[], topics:null, all:[], got:{p:false,w:false,s:false},
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
const weeksAgo = s => s ? Math.round((parse(TODAY) - parse(s)) / (7*864e5)) : null;
const addDays = (s,n) => { const d=parse(s); d.setDate(d.getDate()+n); return iso(d); };
const dday = s => Math.round((parse(s)-parse(TODAY))/864e5);

const ICON = {
  chev:'<path d="m9 6 6 6-6 6"/>', down:'<path d="m6 9 6 6 6-6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  up:'<path d="m6 15 6-6 6 6"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>', copy:'<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', doc:'<path d="M6 3h8.5L19 7.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'
};
const icon = (n, cls="") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const SPARK = (x,y,s) => `<svg class="spark" style="left:${x};top:${y};width:${s}px;height:${s}px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c.9 6.4 5.6 11.1 12 12-6.4.9-11.1 5.6-12 12-.9-6.4-5.6-11.1-12-12C6.4 11.1 11.1 6.4 12 0z"/></svg>`;
const SHEEP = { heart:"img/sheep-heart.webp", wave:"img/sheep-wave.webp", pray:"img/sheep-pray.webp" };
const SHEEP_SIZE = { heart:[537,479], wave:[455,215], pray:[242,343] };
const sheep = (k, cls="mascot") => `<img class="${cls}" src="${SHEEP[k]}" alt="" width="${SHEEP_SIZE[k][0]}" height="${SHEEP_SIZE[k][1]}" decoding="async">`;

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

/* ---------- 데이터 ---------- */
const blankWeek = date => ({date, event:"", mc:"", prayer:"", book:"", ch:"", v1:"", v2:"", hymn:"", title:"", lecture:"", mukdo:"", offering:""});
const LAST_GEN = `${+TODAY.slice(0,4)+2}-12-31`;
/* 본문·제목·묵도·헌금기도는 data/sermons.json(매주 자동), 배정은 Firestore. 운영자가 저장한 묵도·헌금기도가 있으면 우선. */
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
function mcPool(){ const s=new Set(["김세한","김스테반","이다니엘","이성산","유진규"]); S.weeks.forEach(w=>w.mc&&s.add(w.mc)); return [...s]; }
function verseText(w){ if(!w||!w.book) return ""; let t=`${w.book}`; if(w.ch) t+=` ${w.ch}장`; if(w.v1) t+=` ${w.v1}절`; if(w.v2) t+=` – ${w.v2}절`; return t; }

/* ---------- 저장 ---------- */
async function write(fn, okMsg){
  if(!S.db || !S.canEdit){ toast("운영자로 로그인해야 바꿀 수 있어요"); return false; }
  try{ await fn(); if(okMsg) toast(okMsg); try{ navigator.vibrate?.(8); }catch{} return true; }
  catch(e){ toast(e?.code==="permission-denied" ? "이 계정은 운영자로 등록돼 있지 않아요" : "저장하지 못했어요. 잠시 후 다시 시도해 주세요"); return false; }
}
function opsOf(w, patch={}){
  const o = {date:w.date, event:w.event||"", mc:w.mc||"", prayer:w.prayer||"", hymn:w.hymn||""};
  const fsw = S.weeks.find(x=>x.date===w.date);
  if(fsw?.mukdo) o.mukdo=fsw.mukdo; if(fsw?.offering) o.offering=fsw.offering;
  return {...o, ...patch};
}
/* 1~3순위를 빈칸 없이 유지 */
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
const head = (title, sub="", right="") => `<div class="page-head"><div><h1>${title}</h1>${sub?`<p class="sub">${sub}</p>`:""}</div>${right}</div>`;
const section = (title, body, link="") => `<section class="section"><div class="section-h"><h2>${title}</h2>${link}</div>${body}</section>`;
const empty = (title, text, k="wave") => `<div class="empty">${sheep(k)}<strong>${title}</strong>${text.startsWith("<")?text:`<p style="margin:0">${text}</p>`}</div>`;
const datebox = d => `<span class="datebox"><span class="m">${parse(d).getMonth()+1}월</span><span class="d">${parse(d).getDate()}</span></span>`;

function weekRow(w, nx, opts={}){
  const past = w.date < TODAY, next = nx && w.date===nx.date;
  const t = w.event ? esc(w.event) : `사회 ${esc(w.mc)||"미정"} · 기도 ${esc(w.prayer)||"미정"}`;
  const s = w.book ? `${esc(verseText(w))}${w.title?` · ${esc(w.title)}`:""}` : (w.event ? "러너스 예배 없음" : "본문은 게시판에 올라오면 들어와요");
  const chip = w.event ? `<span class="chip mute">행사</span>` : past ? "" : (!w.mc||!w.prayer) ? `<span class="chip warn">미배정</span>` : `<span class="chip ok">준비됨</span>`;
  const act = S.canEdit ? `data-act="editWeek" data-date="${w.date}"` : (w.event ? "" : `data-act="openScript" data-date="${w.date}"`);
  const tag = act ? "button" : "div";
  return `<${tag} ${tag==="button"?'type="button"':""} class="row ${past?"past":""} ${next?"is-next":""} ${w.event?"event":""}" ${act} ${opts.id?`id="${opts.id}"`:""}
    aria-label="${fmtKo(w.date)} ${w.event?esc(w.event):`사회 ${esc(w.mc)||"미정"}, 대표기도 ${esc(w.prayer)||"미정"}`}">
    ${datebox(w.date)}<span class="main"><span class="t">${t}</span><span class="s">${s}</span></span>${chip}${act?icon("chev","chev"):""}</${tag}>`;
}

/* ---------- 홈 ---------- */
function vDash(){
  const nx = nextService();
  const up = sortedWeeks().filter(w=>w.date>=TODAY).slice(0,5);
  const year = TODAY.slice(0,4);
  const mc = {}; S.weeks.filter(w=>w.date.startsWith(year)&&w.mc&&!w.event).forEach(w=>mc[w.mc]=(mc[w.mc]||0)+1);
  const mcArr = Object.entries(mc).sort((a,b)=>b[1]-a[1]); const mcMax = Math.max(1,...mcArr.map(x=>x[1]));
  const cell = (k,v,full=false) => `<div class="hero-cell ${full?"full":""}"><div class="k">${k}</div><div class="v ${v?"":"none"}">${v||"미정"}</div></div>`;
  const hero = nx ? `
    <section class="hero" aria-label="다음 주일">
      ${SPARK("54%","14px",18)}${SPARK("46%","70px",11)}${SPARK("8px","calc(100% - 120px)",14)}
      <div class="hero-top">
        <div class="eyebrow">다음 주일 예배 · 14:00</div>
        <div class="date">${fmtKo(nx.date)}</div>
        <span class="dday">${dday(nx.date)===0?"오늘":`D-${dday(nx.date)}`}</span>
        ${sheep("heart","hero-sheep")}
      </div>
      <div class="hero-panel">
        ${cell("사회", esc(nx.mc))}${cell("대표기도", esc(nx.prayer))}
        ${cell("본문", nx.book?`${esc(verseText(nx))}${nx.title?`<small>${esc(nx.title)}</small>`:""}`:"", true)}
        ${cell("헌금찬송", nx.hymn?`<span class="tnum">${esc(nx.hymn)}</span>장`:"", true)}
      </div>
      <div class="hero-actions">
        <a class="btn pri" href="#script" data-act="openScript" data-date="${nx.date}">${icon("doc")}사회 원고</a>
        ${S.canEdit?`<button class="btn" type="button" data-act="editWeek" data-date="${nx.date}">${icon("edit")}배정 수정</button>`:""}
      </div>
    </section>` : `<div class="card">${empty("앞으로 잡힌 예배가 없어요",`<p style="margin:0 0 12px">모든 주일이 행사로 잡혀 있어요.</p><a class="btn" href="#schedule">일정 보기</a>`)}</div>`;

  const upcoming = section("다가오는 주일", `<div class="card list">${up.map(w=>weekRow(w,nx)).join("")}</div>`, `<a class="link" href="#schedule">전체 일정</a>`);
  const ranks = S.canEdit && S.got.p ? section("대표기도 순서", rankBoard(), `<a class="link" href="#people">명단</a>`) : "";
  const bars = section(`${year}년 사회 횟수`, `<div class="card"><div class="bars">${mcArr.map(([n,c])=>`<div class="bar"><span>${esc(n)}</span><div class="track" role="img" aria-label="${esc(n)} ${c}회"><div class="fill" style="width:${c/mcMax*100}%"></div></div><span class="n">${c}</span></div>`).join("")||`<div class="empty">기록이 없어요</div>`}</div></div>`);
  return `${head("홈", `오늘 ${fmtFull(TODAY)}`)}${hero}<div class="cols"><div class="section" style="gap:24px">${upcoming}</div><div class="section" style="gap:24px">${ranks}${bars}</div></div>`;
}

/* ---------- 일정 ---------- */
function vSchedule(){
  const nx=nextService(); const all=sortedWeeks();
  const years=[...new Set(all.map(w=>w.date.slice(0,4)))].sort();
  if(!S.schedYear || !years.includes(S.schedYear)) S.schedYear = years.includes(TODAY.slice(0,4)) ? TODAY.slice(0,4) : years[years.length-1];
  const y=S.schedYear; const ws=all.filter(w=>w.date.startsWith(y));
  const svc=ws.filter(isService); const filled=svc.filter(w=>w.mc&&w.prayer).length;
  const byMonth = {}; ws.forEach(w=>{ const m=+w.date.slice(5,7); (byMonth[m] ||= []).push(w); });
  return `${head("일정", `${y}년 예배 ${svc.length}회 중 ${filled}회 배정 완료`)}
    <div class="seg" role="group" aria-label="연도">${years.map(k=>`<button type="button" data-act="schedYear" data-v="${k}" aria-pressed="${y===k}">${k}</button>`).join("")}</div>
    <div class="section" style="gap:0">${Object.entries(byMonth).map(([m,list])=>`
      <div class="month-h"><span>${m}월</span></div>
      <div class="card list">${list.map(w=>weekRow(w,nx,{id:nx&&w.date===nx.date?"next-row":""})).join("")}</div>`).join("")}</div>`;
}

/* ---------- 명단 ---------- */
function rankBoard(){
  const st=stats(); const slot=openSlot();
  const ranked=[1,2,3].map(r=>S.people.find(p=>p.priority===r && status(p)==="ok" && !st[p.name].next)||null);
  const gaps = ranked.some(x=>!x) && candidates().length>ranked.filter(Boolean).length;
  return `<div class="rank-row">${ranked.map((p,i)=>{ const r=i+1;
      if(!p) return `<div class="rank empty"><span class="no">${r}</span><div class="main"><div class="nm">비어 있음</div><div class="s">추천할 사람이 없어요</div></div>
        ${S.canEdit&&gaps&&i===ranked.findIndex(x=>!x)?`<button class="btn sm" type="button" data-act="rankFill">채우기</button>`:""}</div>`;
      const last=st[p.name].last;
      return `<div class="rank ${r===1?"first":""}"><span class="no">${r}</span>
        <div class="main"><div class="nm">${esc(p.name)}</div><div class="s">${last?`마지막 ${fmtFull(last)}`:"대표기도 기록 없음"}</div></div>
        ${S.canEdit?`<div class="acts">
          ${r===1&&slot?`<button class="btn sm pri" type="button" data-act="assign" data-name="${esc(p.name)}" data-date="${slot.date}">${fmtShort(slot.date)} 배정</button>`:""}
          ${r>1?`<button class="btn icon sm" type="button" data-act="rankUp" data-id="${p.id}" aria-label="${esc(p.name)} 순위 올리기">${icon("up")}</button>`:""}
          <button class="btn icon sm" type="button" data-act="rankClear" data-id="${p.id}" aria-label="${esc(p.name)} 순위에서 빼기">${icon("x")}</button></div>`:""}
      </div>`;}).join("")}</div>
    ${slot?`<p class="sub" style="margin:0;padding-inline:4px;color:var(--muted);font-size:13px">1순위는 가장 가까운 빈 주일(${fmtKo(slot.date)})에 바로 배정할 수 있어요</p>`:""}`;
}
function vPeople(){
  const st=stats(); const f=S.peopleFilter; const q=S.peopleQ.trim();
  let ps=[...S.people].filter(p=>(f==="all"||status(p)===f)&&(!q||p.name.includes(q)));
  ps.sort((a,b)=>{ const sa={ok:0,hold:1,excluded:2}; return sa[status(a)]-sa[status(b)] || (st[a.name].last||"").localeCompare(st[b.name].last||"") || a.name.localeCompare(b.name,"ko"); });
  const cnt=k=>S.people.filter(p=>k==="all"||status(p)===k).length;
  return `${head("대표기도 명단", `가능 ${cnt("ok")}명 · 보류 ${cnt("hold")}명 · 제외 ${cnt("excluded")}명`,
      `<button class="btn icon pri" type="button" data-act="editPerson" aria-label="사람 추가">${icon("plus")}</button>`)}
    ${section("다음 대표기도 순서", rankBoard())}
    <section class="section">
      <label class="sr-only" for="pq">이름 검색</label>
      <input id="pq" type="search" name="q" placeholder="이름 검색…" autocomplete="off" autocapitalize="none" autocorrect="off" enterkeyhint="search" spellcheck="false" value="${esc(S.peopleQ)}">
      <div class="seg" role="group" aria-label="상태">${[["all","전체"],["ok","가능"],["hold","보류"],["excluded","제외"]].map(([k,l])=>`<button type="button" data-act="peopleFilter" data-v="${k}" aria-pressed="${f===k}">${l}</button>`).join("")}</div>
      <div class="card list">${ps.map(p=>{ const s=st[p.name]; return `
        <button type="button" class="row" data-act="editPerson" data-id="${p.id}" aria-label="${esc(p.name)} 편집">
          <span class="main"><span class="t">${esc(p.name)} ${p.priority?`<span class="chip acc">${p.priority}순위</span>`:""}</span>
          <span class="s">${s.next?`다음 ${fmtFull(s.next)}`:s.last?`마지막 ${fmtFull(s.last)}`:"기록 없음"}${p.note?` · ${esc(p.note)}`:""}</span></span>
          ${statusChip(p)}${icon("chev","chev")}</button>`;}).join("") || empty("해당하는 사람이 없어요",`<p style="margin:0 0 12px">검색어나 상태 필터에 맞는 사람이 없어요.</p><button class="btn" type="button" data-act="resetPeople">필터 지우기</button>`)}</div>
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
    {no:1,t:"묵도",cue:"14:00 정각 단상. 하이예스 연습 중이면 양해 구하고 중지",p:`다함께 묵도하심으로 예배를 준비하시겠습니다. (묵도 반주)\n감사하신 하나님 아버지, 한주간 은혜 베풀어 주시고 이렇게 한자리에 예배 드리러 오게 하심에 감사합니다. ${sc.mukdo||ph("지난주 말씀 기반 기도")}\n이 시간 예배를 통해 하나님 홀로 영광 받으시길 기도합니다. 감사하며 예수님의 이름으로 기도하였습니다. (퇴장)`},
    {no:2,t:"하이예스",cue:"사회자 역할 없음",p:""},
    {no:3,t:"사도신경",cue:"경배곡 끝날 즈음 단상 대기. 찬양 완전히 끝난 뒤 진행",p:"다함께 사도신경으로 신앙고백하시겠습니다. 시작"},
    {no:4,t:"대표기도",cue:"",p:`모두 자리에 앉으시겠습니다. 예배를 위해 ${sc.prayer||ph("대표기도자")} ${sc.honor}께서 대표기도해주시겠습니다.`},
    {no:5,t:"말씀봉독",cue:"",p:`오늘 본문 말씀을 읽겠습니다. 말씀은 ${verse}입니다. 저와 여러분이 한절씩 교독하겠습니다.`},
    {no:6,t:"메시지",cue:"",p:"이창무 목자님께서 말씀을 전해주시겠습니다."},
    {no:7,t:"헌금찬송",cue:"",p:`다함께 찬송가 ${sc.hymn||ph("OO")}장을 부르시겠습니다. 부르시는 가운데 준비하신 헌금을 드리겠습니다.`},
    {no:8,t:"헌금기도",cue:"",p:`드리신 헌금을 위해 잠시 기도하겠습니다. ${sc.offering||ph("오늘 말씀 참고 멘트")}\n이시간 지난 한주간 주신 은혜와 오늘 말씀에 감사하여 작은 예물을 드렸습니다. 이 예물을 기뻐 받아주시고 오병이어로 축사하셔서 성서한국과 세계선교 역사에 귀하게 사용되기를 기도합니다. 감사하며 예수님의 이름으로 기도하였습니다.`},
    {no:9,t:"광고",cue:"",p:"이창무 목자님께서 광고와 기도제목을 나눠주시겠습니다."},
  ];
}
const scriptText = () => buildScript().map(s=>`${s.no}. ${s.t}${s.cue?` (${s.cue})`:""}${s.p?"\n"+s.p:""}`).join("\n\n");
const hl = t => esc(t).replace(/\[([^\]]+)\]/g,'<mark>[$1]</mark>').replace(/\n/g,"<br>");
const stepsHtml = () => buildScript().map(s=>`<div class="step"><span class="no">${pad(s.no)}</span><div><h3>${s.t}</h3>${s.cue?`<div class="cue">${esc(s.cue)}</div>`:""}${s.p?`<p>${hl(s.p)}</p>`:""}</div></div>`).join("");
function vScript(){
  const nx = nextService();
  const services = sortedWeeks().filter(w=>isService(w) && w.date>=addDays(TODAY,-84) && w.date<=addDays(TODAY,182));
  if(!S.script.date){ if(nx) syncScript(nx.date); else if(services.length) syncScript(services[services.length-1].date); }
  const sc=S.script; const cw = sc.date?weekAt(sc.date):null;
  const prev = sc.date?sortedWeeks().filter(w=>w.date<sc.date && w.book).pop():null;
  const ppl = S.people.filter(p=>!p.excluded).map(p=>p.name).sort((a,b)=>a.localeCompare(b,"ko"));
  const blanks = (scriptText().match(/\[[^\]]+\]/g)||[]).length;
  const tab = S.scriptTab;
  return `${head("사회 원고", cw?.title?esc(cw.title):"주일을 고르면 원고가 채워져요", sheep("pray"))}
    <div class="toolbar">
      <label class="sr-only" for="s-date">주일 선택</label>
      <div class="select-wrap"><select id="s-date" name="date">${services.map(w=>`<option value="${w.date}" ${w.date===sc.date?"selected":""}>${fmtFull(w.date)}${w.date===nx?.date?" · 다음 예배":""}</option>`).join("")}</select>${icon("down")}</div>
    </div>
    <div class="seg" role="group" aria-label="보기">
      <button type="button" data-act="scriptTab" data-v="script" aria-pressed="${tab==="script"}">원고</button>
      <button type="button" data-act="scriptTab" data-v="input" aria-pressed="${tab==="input"}">내용 고치기</button>
    </div>
    ${tab==="script"?`
    <div class="card">
      <div class="copybar"><span class="s" id="blank-note">${blanks?`빈칸 ${blanks}곳은 노란색으로 보여요`:"빈칸 없이 모두 채워졌어요"}</span>
        <button class="btn sm pri" type="button" data-act="copyScript">${icon("copy")}전체 복사</button></div>
      <div class="steps" id="steps">${stepsHtml()}</div>
    </div>`:`
    <div class="card fields">
      <div class="field-row">
        <label class="field"><span>대표기도자</span><input id="s-prayer" name="prayer" list="dl-people" autocomplete="off" value="${esc(sc.prayer)}"></label>
        <label class="field"><span>호칭</span><select id="s-honor" name="honor">${["형제님","자매님","목자님"].map(h=>`<option ${sc.honor===h?"selected":""}>${h}</option>`).join("")}</select></label>
      </div>
      <div class="field"><span class="lab" id="lab-verse">본문 (책 · 장 · 시작절 · 끝절)</span><div class="verse" role="group" aria-labelledby="lab-verse">
        <input id="s-book" name="book" aria-label="책" placeholder="로마서" autocomplete="off" value="${esc(sc.book)}">
        <input id="s-ch" name="ch" aria-label="장" inputmode="numeric" placeholder="장" autocomplete="off" value="${esc(sc.ch)}">
        <input id="s-v1" name="v1" aria-label="시작 절" inputmode="numeric" placeholder="절" autocomplete="off" value="${esc(sc.v1)}">
        <input id="s-v2" name="v2" aria-label="끝 절" placeholder="절" autocomplete="off" value="${esc(sc.v2)}"></div></div>
      <div class="field-row">
        <label class="field"><span>헌금찬송 (장)</span><input id="s-hymn" name="hymn" inputmode="numeric" autocomplete="off" value="${esc(sc.hymn)}"></label>
        <div class="field"><span>지난주 본문</span><span style="font-size:14px">${prev?`${fmtShort(prev.date)} · ${esc(verseText(prev))}`:"기록 없음"}</span></div>
      </div>
      <label class="field"><span>묵도 · 지난주 말씀 기반 기도</span><textarea id="s-mukdo" name="mukdo" rows="6" placeholder="지난주 설교 원고가 올라오면 자동으로 채워져요">${esc(sc.mukdo)}</textarea>
        <span class="hint">${cw?.mukdoSrc?`${fmtShort(cw.mukdoSrc)} 설교 원고로 자동 작성`:"지난주 설교 원고가 게시판에 올라오면 자동 작성돼요"}</span></label>
      <label class="field"><span>헌금기도 · 오늘 말씀 참고 멘트</span><textarea id="s-offering" name="offering" rows="3" placeholder="이번 주 말씀공부 질문지가 올라오면 자동으로 채워져요">${esc(sc.offering)}</textarea>
        <span class="hint">${cw?.offering?"이번 주 말씀공부 질문지로 자동 작성":"이번 주 질문지가 올라오면 자동 작성돼요"}</span></label>
      ${S.canEdit?`<div class="field"><button class="btn block pri" type="button" data-act="saveLines">묵도·헌금기도 저장</button><span class="hint">저장하면 다른 운영자도 같은 문장을 봐요. 나머지 칸은 이 화면에서만 바뀌어요.</span></div>`
        :`<div class="field"><span class="hint">여기서 고친 내용은 이 화면에서만 바뀌어요.</span></div>`}
    </div>
    <datalist id="dl-people">${ppl.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`}`;
}

/* ---------- 더보기 ---------- */
function vMore(){
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const account = S.user
    ? `<div class="list"><div class="row"><span class="main"><span class="t">${esc(S.user.displayName||S.user.email)}</span><span class="s">${esc(S.user.email)}</span></span>${S.canEdit?`<span class="chip acc">운영자</span>`:`<span class="chip mute">보기 전용</span>`}</div>
       <button type="button" class="row" data-act="logout"><span class="main"><span class="t" style="color:var(--bad)">로그아웃</span></span></button></div>`
    : `<div class="welcome"><div class="txt"><strong>반가워요!</strong><p>일정과 원고는 로그인 없이 볼 수 있어요. 배정 수정은 운영자만 할 수 있어요.</p>
       ${S.fbReady?`<button class="btn pri" type="button" data-act="login">구글로 로그인</button>`:""}</div>${sheep("wave")}</div>`;
  return `${head("더보기")}
    ${section("계정", `<div class="card">${account}</div>`)}
    ${standalone?"":section("휴대폰에 설치", `<div class="card list"><div class="row"><span class="main"><span class="t">홈 화면에 러너스 아이콘 추가</span>
      <span class="s" style="white-space:normal">${ios?"Safari 아래쪽 공유 버튼 → 홈 화면에 추가":"Chrome 오른쪽 위 ⋮ 메뉴 → 앱 설치"}</span></span>
      ${S.installEvt?`<button class="btn sm pri" type="button" data-act="install">설치</button>`:""}</div></div>`)}
    ${section("기도제목", `<div class="card">${S.canEdit
        ?`<div class="fields"><label class="field"><span class="sr-only">기도제목</span><textarea id="t-topics" name="topics" rows="18">${esc(S.topics||DEFAULT_TOPICS)}</textarea></label>
           <div class="field" style="flex-direction:row;gap:8px"><button class="btn" type="button" data-act="copyTopics">${icon("copy")}복사</button><button class="btn pri" type="button" data-act="saveTopics" style="flex:1">저장</button></div></div>`
        :`<div class="copybar"><span class="s">대표기도자에게 보낼 기도 가이드</span><button class="btn sm" type="button" data-act="copyTopics">${icon("copy")}복사</button></div><div class="plain">${esc(S.topics||DEFAULT_TOPICS)}</div>`}</div>`)}
    ${S.canEdit?section("데이터 가져오기", `<div class="card fields"><label class="field"><span>받은 '러너스_데이터_가져오기.json' 파일 고르기</span><input id="imp-file" type="file" accept=".json,application/json"><span class="hint">같은 날짜·사람은 파일 내용으로 덮어써요. 처음 한 번만 하면 돼요.</span></label></div>`):""}`;
}

/* ---------- 시트 ---------- */
let sheepOpen = false, sheetReturn = null;
function openSheet(title, body, foot){
  sheetReturn = document.activeElement;
  const root=document.getElementById("sheet-root");
  root.className=""; root.innerHTML = `<div class="scrim" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="drag-zone"><div class="grab" aria-hidden="true"></div>
      <div class="sheet-h"><h2 id="sheet-title">${title}</h2><button class="btn icon sm" type="button" data-act="closeSheet" aria-label="닫기">${icon("x")}</button></div>
      </div><div class="sheet-b">${body}</div><div class="sheet-f">${foot}</div></div>`;
  sheepOpen = true; document.body.style.overflow="hidden";
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ root.className="open"; root.querySelector(".sheet-b input:not([disabled]), .sheet-b select")?.focus({preventScroll:true}); }));
  bindSheetDrag(root.querySelector(".sheet"), root.querySelector(".drag-zone"));
}
/* 손가락을 따라 1:1로 내려가고, 위로는 고무줄처럼 버티고, 놓을 때 속도·거리로 닫힘 여부 결정 */
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
    const shown = dy>0 ? dy : -rubber(-dy, sheet.offsetHeight);
    sheet.style.translate = `0 ${shown}px`;
  });
  const end = e=>{
    if(e.pointerId!==id) return; id=null;
    const a=hist[0], b=hist[hist.length-1]; const v = (b.y-a.y)/Math.max(1,b.t-a.t); // px/ms
    sheet.classList.remove("dragging"); sheet.style.translate="";
    if(dy > sheet.offsetHeight*0.3 || (v > 0.5 && dy > 24)) closeSheet();
  };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
}
function closeSheet(){
  const root=document.getElementById("sheet-root"); if(!sheepOpen) return;
  sheepOpen=false; root.className="open closing"; document.body.style.overflow="";
  setTimeout(()=>{ if(!sheepOpen){ root.innerHTML=""; root.className=""; } }, 260);
  if(sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({preventScroll:true});
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
        <div class="field"><span>본문</span><span style="font-size:14px">${w.book?`${esc(verseText(w))}${w.title?` · ${esc(w.title)}`:""}`:"게시판에 올라오면 자동으로 들어와요"}</span></div>
      </div>
    </div>
    <datalist id="dl-mc">${mcPool().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <datalist id="dl-pp">${ppl.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`,
    `${isStored?`<button class="btn danger" type="button" data-act="delWeek" data-date="${date}">배정 지우기</button>`:""}<button class="btn pri" type="button" data-act="saveWeek" data-date="${date}">저장</button>`);
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
const val = id => document.getElementById(id)?.value.trim() ?? "";

/* ---------- 렌더 ---------- */
const ROUTES = {dash:vDash, schedule:vSchedule, people:vPeople, script:vScript, more:vMore};
function route(){ const h=location.hash.slice(1); if(h==="people" && !S.canEdit) return "dash"; return ROUTES[h]?h:"dash"; }
function render(){
  const r=route();
  document.querySelectorAll("#tabs a").forEach(a=>{ const on=a.getAttribute("href")==="#"+r; on?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current"); });
  const roleEl=document.getElementById("role");
  roleEl.textContent = S.mode==="setup"?"연결 준비 중":S.canEdit?"운영자":S.user?"보기 전용":"둘러보는 중";
  roleEl.className = "pill"+(S.canEdit?" admin":"");
  document.getElementById("login").hidden = !S.fbReady || !!S.user;
  document.querySelectorAll("[data-admin]").forEach(el=>el.hidden=!S.canEdit);
  S.all = mergedWeeks();
  const main=document.getElementById("main");
  if(!S.got.s || (S.fbReady && !S.got.w)){
    main.innerHTML = S.mode==="slow"
      ? `<div class="card" style="margin-top:24px">${empty("아직 연결 중이에요","인터넷 연결을 확인해 주세요. 한 번 열어 본 내용은 오프라인에서도 보여요.","pray")}</div>`
      : `<div aria-busy="true" aria-label="불러오는 중…" style="display:flex;flex-direction:column;gap:24px;padding-top:12px">
          <div class="sk sk-line" style="width:90px;height:30px"></div><div class="sk sk-hero"></div>
          <div class="card">${Array.from({length:4},()=>`<div class="sk-row"><div class="sk" style="width:46px;height:40px"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="sk sk-line" style="width:60%"></div><div class="sk sk-line" style="width:85%;height:11px"></div></div></div>`).join("")}</div></div>`;
    return;
  }
  if(r==="people" && !S.got.p){ main.innerHTML=`<div class="card" style="margin-top:24px">${empty("명단을 불러오는 중…","잠시만 기다려 주세요.","pray")}</div>`; return; }
  const ae=document.activeElement; const aid=ae?.id && main.contains(ae) ? ae.id : null; const sel=aid&&"selectionStart" in ae?[ae.selectionStart,ae.selectionEnd]:null;
  const banner = S.mode==="setup"?`<div class="banner">아직 데이터 서버(Firebase)가 연결되지 않았어요. 본문과 원고만 보여요.</div>`:S.mode==="slow"?`<div class="banner">연결이 느려서 최신 내용이 아닐 수 있어요.</div>`:"";
  main.innerHTML = banner + ROUTES[r]();
  if(aid){ const el=document.getElementById(aid); if(el){ el.focus({preventScroll:true}); if(sel) try{el.setSelectionRange(...sel);}catch{} } }
  if(r==="schedule" && !S.schedScrolled){ S.schedScrolled=true; document.getElementById("next-row")?.scrollIntoView({block:"center"}); }
}
window.addEventListener("hashchange", ()=>{ closeSheet(); window.scrollTo(0,0); if(route()==="schedule") S.schedScrolled=false; render(); });
window.addEventListener("scroll", ()=>document.getElementById("top").classList.toggle("scrolled", scrollY>4), {passive:true});

/* ---------- 이벤트 ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if(!t) return;
  const a = t.dataset.act;
  if(a==="closeSheet"){ closeSheet(); return; }
  if(a==="openScript"){ syncScript(t.dataset.date); S.scriptTab="script"; if(route()==="script") render(); else location.hash="#script"; return; }
  if(a==="schedYear"){ S.schedYear=t.dataset.v; render(); }
  if(a==="peopleFilter"){ S.peopleFilter=t.dataset.v; render(); }
  if(a==="resetPeople"){ S.peopleFilter="all"; S.peopleQ=""; render(); }
  if(a==="scriptTab"){ S.scriptTab=t.dataset.v; render(); }
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
  if(a==="delWeek"||a==="delPerson"){
    if(t.dataset.confirm!=="1"){
      const f=t.closest(".sheet-f"); f.dataset.orig=f.innerHTML;
      const what = a==="delWeek" ? ["배정을 지울까요?","사회·대표기도·찬송이 비워져요. 본문은 그대로예요."] : ["이 사람을 명단에서 삭제할까요?","되돌릴 수 없어요. 순위는 자동으로 다시 정리돼요."];
      f.innerHTML = `<div class="confirm"><strong>${what[0]}</strong><span>${what[1]}</span></div><button class="btn" type="button" data-act="cancelConfirm">취소</button><button class="btn danger solid" type="button" data-act="${a}" data-confirm="1" ${a==="delWeek"?`data-date="${t.dataset.date}"`:`data-id="${t.dataset.id}"`}>${a==="delWeek"?"지우기":"삭제"}</button>`;
      f.querySelector('[data-confirm="1"]').focus(); return;
    }
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
  if(a==="delPerson"){
    const did=t.dataset.id;
    if(await write(()=>S.db.doc("people/"+did).delete(),"삭제했어요")){ closeSheet(); await applyPriorities(S.people.filter(x=>x.id!==did), S.weeks); }
  }
  if(a==="copyScript") copy(scriptText());
  if(a==="saveLines"){ const sc=S.script; if(!sc.date) return;
    await write(()=>S.db.doc("weeks/"+sc.date).set(opsOf(weekAt(sc.date), {mukdo:sc.mukdo, offering:sc.offering})),"묵도·헌금기도를 저장했어요"); }
  if(a==="copyTopics") copy(S.topics||DEFAULT_TOPICS);
  if(a==="saveTopics"){ const v=document.getElementById("t-topics").value; await write(()=>S.db.doc("config/topics").set({text:v}),"기도제목을 저장했어요"); }
  if(a==="login") login();
  if(a==="logout"){ await AUTH.signOut(); toast("로그아웃했어요"); }
  if(a==="install" && S.installEvt){ S.installEvt.prompt(); S.installEvt=null; render(); }
});
document.addEventListener("change", async e => {
  if(e.target.id==="s-date"){ syncScript(e.target.value); render(); return; }
  if(e.target.id!=="imp-file" || !e.target.files[0]) return;
  try{
    const data = JSON.parse(await e.target.files[0].text());
    if(!Array.isArray(data.people) || !Array.isArray(data.weeks)) throw new Error("bad");
    await IMPORT(data);
    toast(`가져왔어요: 사람 ${data.people.length}명, 주일 ${data.weeks.length}주`);
  }catch(err){ toast(err?.message==="bad"?"이 파일은 러너스 데이터 파일이 아니에요":"가져오지 못했어요. 운영자로 로그인했는지 확인해 주세요"); }
  e.target.value="";
});
document.addEventListener("input", e => {
  const id=e.target.id;
  if(id==="pq"){ S.peopleQ=e.target.value; render(); return; }
  if(id==="w-kind"){ const k=e.target.value; document.getElementById("w-other-wrap").hidden = k!=="__other"; document.getElementById("w-roles").hidden = !!k; return; }
  const map={"s-prayer":"prayer","s-honor":"honor","s-book":"book","s-ch":"ch","s-v1":"v1","s-v2":"v2","s-hymn":"hymn","s-mukdo":"mukdo","s-offering":"offering"};
  if(map[id]) S.script[map[id]]=e.target.value;
});
document.addEventListener("keydown", e => { if(e.key==="Escape") closeSheet(); });

/* ---------- 시작 ---------- */
async function login(){
  if(!FB) return;
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = FB.a;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
  try{ await signInWithPopup(FB.auth, provider); }
  catch(e){
    if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e?.code)){
      try{ await signInWithRedirect(FB.auth, provider); }catch{ toast("로그인하지 못했어요. Safari나 Chrome에서 다시 시도해 주세요"); }
    } else if(e?.code!=="auth/popup-closed-by-user") toast("로그인하지 못했어요. 잠시 후 다시 시도해 주세요");
  }
}
document.getElementById("login").addEventListener("click", login);
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); S.installEvt=e; if(route()==="more") render(); });
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});

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
  S.fbReady = true; S.mode="live";
  const { doc, collection, setDoc, updateDoc, deleteDoc, onSnapshot, getDoc, writeBatch } = fsM;
  S.db = {
    doc(path){ const r=doc(fs, ...path.split("/")); return { id:r.id, set:d=>setDoc(r,d), update:d=>updateDoc(r,d), delete:()=>deleteDoc(r) }; },
    collection(name){ return { doc(){ const r=doc(collection(fs,name)); return { id:r.id, set:d=>setDoc(r,d) }; } }; }
  };
  AUTH = { signOut: ()=>authM.signOut(auth) };
  IMPORT = async (data) => {
    const ops = [
      ...data.people.map(p=>{ const {id,...rest}=p; return [doc(fs,"people",id), rest]; }),
      ...data.weeks.map(w=>[doc(fs,"weeks",w.date), w]),
    ];
    if(data.topics) ops.push([doc(fs,"config","topics"), {text:data.topics}]);
    for(let i=0;i<ops.length;i+=400){ const b = writeBatch(fs); ops.slice(i,i+400).forEach(([r,d])=>b.set(r,d)); await b.commit(); }
  };
  const slow = setTimeout(()=>{ if(!S.got.w){ S.mode="slow"; render(); } }, 10000);
  onSnapshot(collection(fs,"weeks"), s=>{
    S.weeks = s.docs.map(d=>({...d.data(), date:d.data().date||d.id})); S.got.w=true;
    if(S.mode==="slow") S.mode="live"; clearTimeout(slow); render();
  }, ()=>{ S.got.w=true; render(); toast("일정을 불러오지 못했어요"); });
  let unsubs = [];
  authM.getRedirectResult(auth).catch(()=>{});
  authM.onAuthStateChanged(auth, async u=>{
    unsubs.forEach(f=>f()); unsubs=[];
    S.user = u; S.canEdit = false; S.people=[]; S.got.p=false; S.topics=null;
    if(u?.email){ try{ await getDoc(doc(fs,"admins",u.email)); S.canEdit = true; }catch{ S.canEdit = false; } }
    if(S.canEdit){
      unsubs.push(onSnapshot(collection(fs,"people"), s=>{ S.people=s.docs.map(d=>({id:d.id,...d.data()})); S.got.p=true; render(); }, ()=>{ S.got.p=true; render(); }));
      unsubs.push(onSnapshot(doc(fs,"config","topics"), s=>{ S.topics = s.exists() ? (s.data().text||null) : null; if(document.activeElement?.id==="t-topics") return; render(); }, ()=>{}));
    }
    render();
  });
}

render();
loadSermons();
startFirebase().catch(()=>{ S.mode="setup"; render(); toast("데이터 서버에 연결하지 못했어요"); });
