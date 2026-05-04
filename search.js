// ════════════════════════════════════════════════════════════════════════════
// search.js — 線上查詢頁面的所有功能
// 修改查詢功能只需編輯此檔案，不需要動 stock-tracker.html
// 依賴：stock-tracker.html 中定義的 proxyFetch, lookupName, TW_NAMES,
//       fmt, pc, ps, switchTab, openModal, onCodeInput, S (state), save
// ════════════════════════════════════════════════════════════════════════════

let sqSearching=false;
let sqState={sym:'',meta:null,allPoints:{},divHistory:[],divMonths:[],name:'',code:'',range:'1mo'};
const SQ_RANGES=[{k:'1mo',l:'1月'},{k:'3mo',l:'3月'},{k:'6mo',l:'6月'},{k:'1y',l:'1年'}];

// ── Saved holdings list ───────────────────────────────────────────────────────
function rSqSaved(){
  const el=document.getElementById('sq-saved');
  if(!el) return;
  if(!S.holdings.length){
    el.innerHTML='<div style="color:var(--text4);font-size:13px;padding:8px 0">尚無持股，新增後會顯示在這裡</div>';
    return;
  }
  el.innerHTML=S.holdings.map(h=>{
    const ts=(h.lots||[]).reduce((s,l)=>s+l.shares,0);
    const ap=ts?((h.lots||[]).reduce((s,l)=>s+l.shares*l.price,0)/ts):0;
    const price=S.stockInfo[h.code]?.price||0;
    const pnl=(price||ap)*ts-ap*ts;
    const pct=ap&&ts?pnl/(ap*ts)*100:0;
    return `<div class="card2" onclick="sqOpenSheet('${h.code}')" style="cursor:pointer">
      <div class="row">
        <div>
          <div style="font-weight:700;font-size:15px">${h.name}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${h.code}</div>
        </div>
        <div style="text-align:right">
          ${price?`<div class="mono" style="font-weight:700;font-size:15px">$${fmt(price,2)}</div>
          <div class="mono ${pc(pnl)}" style="font-size:12px">${ps(pct)}${fmt(pct,2)}%</div>`
          :`<div style="font-size:12px;color:var(--text4)">未查詢</div>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

function onSearchTabOpen(){ rSqSaved(); }

// ── Autocomplete ──────────────────────────────────────────────────────────────
function sqAutocomplete(){
  const val=(document.getElementById('sq-input')?.value||'').trim().toUpperCase();
  const ac=document.getElementById('sq-ac');
  if(!ac) return;
  if(!val){ac.style.display='none';return;}
  if(lookupName(val)){ac.style.display='none';return;}
  const matches=Object.entries(TW_NAMES).filter(([k])=>k.startsWith(val)).slice(0,6);
  if(!matches.length){ac.style.display='none';return;}
  ac.style.display='block';
  ac.innerHTML=matches.map(([k,v])=>`<div onclick="sqPick('${k}')" style="padding:11px 14px;font-size:14px;cursor:pointer;border-bottom:1px solid var(--border)"><b>${k}</b> ${v}</div>`).join('');
}

function sqPick(code){
  const inp=document.getElementById('sq-input');
  const ac=document.getElementById('sq-ac');
  if(inp) inp.value=code;
  if(ac) ac.style.display='none';
  sqSearch();
}

function sqOpenSheet(code){
  const inp=document.getElementById('sq-input');
  if(inp) inp.value=code;
  sqSearch();
}

// ── Sheet open/close ──────────────────────────────────────────────────────────
function sqShowSheet(content){
  const modal=document.getElementById('sq-modal');
  const sheet=document.getElementById('sq-sheet');
  if(!modal||!sheet) return;
  sheet.innerHTML=content;
  sheet.style.animation='none'; sheet.offsetHeight; sheet.style.animation='slideUp .3s ease';
  modal.style.display='block';
}

function sqCloseSheet(){
  const modal=document.getElementById('sq-modal');
  if(modal) modal.style.display='none';
  sqSearching=false;
}

// ── Main search ───────────────────────────────────────────────────────────────
async function sqSearch(){
  const code=(document.getElementById('sq-input')?.value||'').trim().toUpperCase();
  if(!code) return;
  document.getElementById('sq-input')?.blur();
  const ac=document.getElementById('sq-ac');
  if(ac) ac.style.display='none';
  if(sqSearching) return;
  sqSearching=true;

  sqShowSheet(`<div style="text-align:center;padding:60px 20px;color:var(--text3)">
    <span class="spin" style="font-size:32px">⟳</span>
    <div style="margin-top:14px;font-size:15px">查詢 ${code} 中...</div>
  </div>`);

  const cb=Date.now();
  let priceData=null,chartData=null,divData=null,sym='';

  for(const suf of['.TW','.TWO']){
    try{
      const txt=await proxyFetch(`https://query2.finance.yahoo.com/v8/finance/chart/${code}${suf}?interval=1d&range=1mo&events=dividends&_=${cb}`);
      const result=JSON.parse(txt)?.chart?.result?.[0];
      if(result?.meta?.regularMarketPrice){priceData=result.meta;chartData=result;sym=code+suf;break;}
    }catch{}
  }

  if(!priceData){
    sqShowSheet(`<div style="text-align:center;padding:48px 20px">
      <div style="font-size:44px;margin-bottom:14px">🔍</div>
      <div style="font-weight:800;font-size:18px;margin-bottom:8px">找不到「${code}」</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:24px">請確認股票代號是否正確</div>
      <button onclick="sqCloseSheet()" class="btn btn-gray" style="max-width:200px;margin:0 auto">關閉</button>
    </div>`);
    return;
  }

  // Fetch 2-year weekly for div history + range charts
  let allPoints={};
  try{
    const txt2=await proxyFetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1wk&range=2y&events=dividends&_=${cb}`);
    divData=JSON.parse(txt2)?.chart?.result?.[0];
    const ts2=divData?.timestamp||[], cl2=divData?.indicators?.quote?.[0]?.close||[];
    const all2=ts2.map((t,i)=>({x:t,y:cl2[i]})).filter(p=>p.y!=null);
    const now2=Date.now()/1000;
    const cuts={'3mo':91,'6mo':183,'1y':365};
    for(const [k,d] of Object.entries(cuts)) allPoints[k]=all2.filter(p=>p.x>=now2-d*86400);
  }catch{}
  const ts1=chartData?.timestamp||[], cl1=chartData?.indicators?.quote?.[0]?.close||[];
  allPoints['1mo']=ts1.map((t,i)=>({x:t,y:cl1[i]})).filter(p=>p.y!=null);
  for(const r of SQ_RANGES) if(!allPoints[r.k]?.length) allPoints[r.k]=allPoints['1mo'];

  // Parse meta
  const meta=priceData;
  const localName=lookupName(code);
  const name=localName||meta.shortName||meta.longName||code;
  const price=meta.regularMarketPrice;
  const prev=meta.chartPreviousClose||meta.regularMarketPreviousClose||price;
  const chg=price-prev, pct=prev?(chg/prev*100):0;
  const vol=meta.regularMarketVolume, mktCap=meta.marketCap;
  const currency=meta.currency||'TWD';
  const dayAvg=(meta.regularMarketDayHigh&&meta.regularMarketDayLow)?(meta.regularMarketDayHigh+meta.regularMarketDayLow)/2:null;
  const vals4w=(allPoints['1mo']||[]).map(p=>p.y);
  const hi4w=vals4w.length?Math.max(...vals4w):null;
  const lo4w=vals4w.length?Math.min(...vals4w):null;

  // Dividends
  const evts=divData?.events?.dividends||chartData?.events?.dividends;
  let divHistory=[];
  if(evts) divHistory=Object.values(evts).sort((a,b)=>b.date-a.date).slice(0,6).map(e=>({
    date:new Date(e.date*1000).toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'}),
    month:new Date(e.date*1000).getMonth()+1,
    amount:Math.round(e.amount*1000)/1000
  }));
  const divMonths=divHistory.length?[...new Set(divHistory.map(d=>d.month))].sort((a,b)=>a-b):[];

  sqState={sym,meta,allPoints,divHistory,divMonths,name,code,range:'1mo'};

  const posColor=chg>=0?'var(--green)':'var(--red)';
  const nameSafe=name.replace(/'/g,"\\'");

  sqShowSheet(`
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 16px"></div>

    <div style="padding:0 16px 14px;border-bottom:1px solid var(--border);margin-bottom:14px">
      <div class="row" style="align-items:flex-start">
        <div>
          <div style="font-size:20px;font-weight:900;line-height:1.2">${name}</div>
          <div style="font-size:13px;color:var(--text3);margin-top:3px">${code} · ${currency}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px">
          <div class="mono" style="font-size:26px;font-weight:900">$${fmt(price,2)}</div>
          <div class="mono" style="font-size:13px;color:${posColor}">${pct>=0?'+':''}${fmt(pct,2)}% (${chg>=0?'+':''}${fmt(chg,2)})</div>
        </div>
      </div>
    </div>

    <div style="padding:0 16px 14px">
      <div class="row" style="margin-bottom:8px">
        <div style="font-size:13px;color:var(--text3);font-weight:600">股價走勢</div>
        <div style="display:flex;gap:3px">
          ${SQ_RANGES.map(r=>`<button onclick="sqSetRange('${r.k}')" id="sqr-${r.k}" style="padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;border:none;cursor:pointer;font-family:inherit;background:${r.k==='1mo'?'var(--blue)':'var(--bg3)'};color:${r.k==='1mo'?'#fff':'var(--text3)'}">${r.l}</button>`).join('')}
        </div>
      </div>
      <div id="sq-tooltip" style="text-align:center;min-height:28px;margin-bottom:4px">
        <span style="font-size:11px;color:var(--text4)">長按後左右滑動查看各日價格</span>
      </div>
      <canvas id="sq-spark" style="cursor:crosshair;display:block"></canvas>
      <div id="sq-spark-dates" style="display:flex;justify-content:space-between;font-size:11px;color:var(--text4);margin-top:4px"></div>
    </div>

    <div style="padding:0 16px 14px">
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">基本資料</div>
      <div class="grid3">
        ${hi4w!=null?`<div><div class="sl">4週最高</div><div class="sv mono">$${fmt(hi4w,2)}</div></div>`:''}
        ${lo4w!=null?`<div><div class="sl">4週最低</div><div class="sv mono">$${fmt(lo4w,2)}</div></div>`:''}
        ${dayAvg!=null?`<div><div class="sl">均價</div><div class="sv mono">$${fmt(dayAvg,2)}</div></div>`:''}
        ${prev?`<div><div class="sl">昨收</div><div class="sv mono">$${fmt(prev,2)}</div></div>`:''}
        ${vol?`<div><div class="sl">成交量</div><div class="sv mono">${vol>=1e8?fmt(vol/1e8,1)+'億':vol>=1e4?fmt(vol/1e4,1)+'萬':fmt(vol)}</div></div>`:''}
        ${mktCap?`<div><div class="sl">市值</div><div class="sv mono">${mktCap>=1e12?fmt(mktCap/1e12,2)+'兆':mktCap>=1e8?fmt(mktCap/1e8,1)+'億':fmt(mktCap/1e4,0)+'萬'}</div></div>`:''}
        ${divMonths.length?`<div><div class="sl">配息月</div><div class="sv">${divMonths.join('、')}月</div></div>`:''}
      </div>
    </div>

    <div style="padding:0 16px 14px">
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">歷史配息紀錄</div>
      ${divHistory.length?divHistory.map((d,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:${i<divHistory.length-1?'1px solid var(--border)':'none'}">
          <div>
            <div style="font-size:14px;font-weight:${i===0?'700':'400'}">${d.date}</div>
            <div style="font-size:12px;color:var(--text3)">${d.month}月除息</div>
          </div>
          <div class="mono" style="font-size:16px;font-weight:700;color:var(--purple)">$${fmt(d.amount,3)}</div>
        </div>`).join('')
      :'<div style="color:var(--text4);font-size:14px;text-align:center;padding:8px 0">無配息記錄</div>'}
    </div>

    <div style="padding:0 16px 8px;display:flex;gap:8px">
      <button onclick="sqQuickAdd('${code}','${nameSafe}');sqCloseSheet()" class="btn btn-blue" style="flex:1">＋ 加入持股</button>
      <button onclick="sqCloseSheet()" class="btn btn-gray" style="flex:1">關閉</button>
    </div>
  `);

  sqSearching=false;
  sqDrawChart('1mo');
}

// ── Range switch ──────────────────────────────────────────────────────────────
function sqSetRange(range){
  sqState.range=range;
  SQ_RANGES.forEach(r=>{
    const b=document.getElementById('sqr-'+r.k);
    if(b){b.style.background=r.k===range?'var(--blue)':'var(--bg3)';b.style.color=r.k===range?'#fff':'var(--text3)';}
  });
  sqDrawChart(range);
}

// ── Draw chart ────────────────────────────────────────────────────────────────
function sqDrawChart(range){
  requestAnimationFrame(()=>{
    const canvas=document.getElementById('sq-spark');
    if(!canvas) return;
    const pricePoints=sqState.allPoints[range]||[];
    const datesEl=document.getElementById('sq-spark-dates');
    const tipEl=document.getElementById('sq-tooltip');
    if(datesEl&&pricePoints.length>=2){
      const d0=new Date(pricePoints[0].x*1000).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
      const d1=new Date(pricePoints[pricePoints.length-1].x*1000).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
      datesEl.innerHTML=`<span>${d0}</span><span>${d1}</span>`;
    }
    if(!pricePoints.length){canvas.style.display='none';return;}
    canvas.style.display='block';
    const W=(canvas.parentElement?.clientWidth||320);
    const H=110, dpr=Math.ceil(window.devicePixelRatio||1);
    if(canvas.width!==W*dpr||canvas.height!==H*dpr){
      canvas.width=W*dpr; canvas.height=H*dpr;
      canvas.style.width=W+'px'; canvas.style.height=H+'px';
    }
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    const vals=pricePoints.map(p=>p.y);
    const mn=Math.min(...vals)*0.999, mx=Math.max(...vals)*1.001, rng=mx-mn||1;
    const toX=i=>pricePoints.length>1?i/(pricePoints.length-1)*(W-4)+2:W/2;
    const toY=v=>H-4-(v-mn)/rng*(H-14);
    const pts=pricePoints.map((p,i)=>({x:toX(i),y:toY(p.y),ts:p.x,val:p.y}));
    const isUp=vals[vals.length-1]>=vals[0];
    const lc=isUp?'#30d158':'#ff453a';
    const fa=isUp?'rgba(48,209,88,0.2)':'rgba(255,69,58,0.2)';
    function drawBase(){
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
      const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,fa); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.lineTo(pts[pts.length-1].x,H); ctx.lineTo(pts[0].x,H); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.strokeStyle=lc; ctx.lineWidth=2; ctx.stroke();
      const last=pts[pts.length-1]; ctx.beginPath(); ctx.arc(last.x,last.y,4,0,Math.PI*2); ctx.fillStyle=lc; ctx.fill();
    }
    drawBase();
    function drawCrosshair(cx){
      const rect=canvas.getBoundingClientRect(); const x=(cx-rect.left)*(W/rect.width);
      let near=pts[0],nd=Infinity; pts.forEach(p=>{const d=Math.abs(p.x-x);if(d<nd){nd=d;near=p;}});
      drawBase();
      ctx.beginPath(); ctx.setLineDash([3,3]); ctx.moveTo(near.x,0); ctx.lineTo(near.x,H);
      ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(near.x,near.y,5,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(near.x,near.y,3,0,Math.PI*2); ctx.fillStyle=lc; ctx.fill();
      const ds=new Date(near.ts*1000).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
      if(tipEl) tipEl.innerHTML=`<span style="font-size:13px;font-weight:700;color:#fff">${ds}&nbsp;&nbsp;<span style="color:${lc}">$${fmt(near.val,2)}</span></span>`;
    }
    function clearCrosshair(){ drawBase(); if(tipEl) tipEl.innerHTML='<span style="font-size:11px;color:var(--text4)">長按後左右滑動查看各日價格</span>'; }
    let touching=false,lpt=null;
    canvas.ontouchstart=e=>{e.preventDefault();lpt=setTimeout(()=>{touching=true;drawCrosshair(e.touches[0].clientX);},280);};
    canvas.ontouchmove=e=>{e.preventDefault();if(touching)drawCrosshair(e.touches[0].clientX);};
    canvas.ontouchend=e=>{e.preventDefault();clearTimeout(lpt);if(touching){touching=false;setTimeout(clearCrosshair,1500);}};
    canvas.onmousedown=e=>{touching=true;drawCrosshair(e.clientX);};
    canvas.onmousemove=e=>{if(touching)drawCrosshair(e.clientX);};
    canvas.onmouseup=()=>{touching=false;setTimeout(clearCrosshair,1500);};
    canvas.onmouseleave=()=>{if(touching){touching=false;clearCrosshair();}};
  });
}

// ── Quick add ─────────────────────────────────────────────────────────────────
function sqQuickAdd(code,name){
  if(S.holdings.find(h=>h.code===code)){
    switchTab('holdings'); setTimeout(()=>openModal('addHolding',code),200);
  } else {
    switchTab('holdings'); setTimeout(()=>{
      openModal('addHolding');
      setTimeout(()=>{ const inp=document.getElementById('f-code'); if(inp){inp.value=code;onCodeInput();} },50);
    },200);
  }
}
