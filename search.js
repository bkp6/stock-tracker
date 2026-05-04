// ════════════════════════════════════════════════════════════════════════════
// search.js — 線上查詢頁面的所有功能
// 修改查詢功能只需編輯此檔案，不需要動 stock-tracker.html
// 依賴：stock-tracker.html 中定義的 proxyFetch, lookupName, TW_NAMES,
//       fmt, switchTab, openModal, onCodeInput, S (state)
// ════════════════════════════════════════════════════════════════════════════

// ── Stock search page ────────────────────────────────────────────────────────
let sqSearching=false;

function sqAutocomplete(){
  const val=(document.getElementById('sq-input')?.value||'').trim().toUpperCase();
  const ac=document.getElementById('sq-ac');
  if(!ac) return;
  if(!val){ac.style.display='none';return;}
  const exact=lookupName(val);
  if(exact){ac.style.display='none';return;} // exact match, no dropdown needed
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

// sq state: store current search results for range switching
let sqState={sym:'',meta:null,allPoints:{},divHistory:[],divMonths:[],name:'',code:'',range:'1mo'};
const SQ_RANGES=[{k:'1mo',l:'1月'},{k:'3mo',l:'3月'},{k:'6mo',l:'6月'},{k:'1y',l:'1年'}];

async function sqSearch(){
  const code=(document.getElementById('sq-input')?.value||'').trim().toUpperCase();
  if(!code) return;
  // Dismiss keyboard
  document.getElementById('sq-input')?.blur();
  const ac=document.getElementById('sq-ac');
  if(ac) ac.style.display='none';
  const res=document.getElementById('sq-result');
  if(!res) return;
  if(sqSearching) return;
  sqSearching=true;
  res.innerHTML=`<div style="text-align:center;padding:40px 0;color:var(--text3)"><span class="spin" style="font-size:28px">⟳</span><div style="margin-top:12px;font-size:14px">查詢中...</div></div>`;

  const cb=Date.now();
  let priceData=null, chartData=null, divData=null, sym='';

  for(const suf of['.TW','.TWO']){
    try{
      const url=`https://query2.finance.yahoo.com/v8/finance/chart/${code}${suf}?interval=1d&range=1mo&events=dividends&_=${cb}`;
      const txt=await proxyFetch(url);
      const parsed=JSON.parse(txt);
      const result=parsed?.chart?.result?.[0];
      if(result?.meta?.regularMarketPrice){priceData=result.meta;chartData=result;sym=code+suf;break;}
    }catch{}
  }

  if(!priceData){
    res.innerHTML=`<div class="card" style="text-align:center;padding:32px 16px"><div style="font-size:40px;margin-bottom:12px">🔍</div><div style="font-weight:700;margin-bottom:6px">找不到「${code}」的資料</div><div style="font-size:13px;color:var(--text3)">請確認股票代號是否正確</div></div>`;
    sqSearching=false; return;
  }

  // Fetch 2-year weekly data for dividend history + long-range chart
  let allPoints={};
  try{
    const url2=`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1wk&range=2y&events=dividends&_=${cb}`;
    const txt2=await proxyFetch(url2);
    divData=JSON.parse(txt2)?.chart?.result?.[0];
    // Extract all timestamps+closes for range slicing
    const ts2=divData?.timestamp||[];
    const cl2=divData?.indicators?.quote?.[0]?.close||[];
    const all2=ts2.map((t,i)=>({x:t,y:cl2[i]})).filter(p=>p.y!=null);
    // Slice by range
    const now2=Date.now()/1000;
    const cutoffs={'1wk':7,'1mo':30,'3mo':91,'6mo':183,'1y':365};
    for(const [k,days] of Object.entries(cutoffs)){
      allPoints[k]=all2.filter(p=>p.x>=(now2-days*86400));
    }
    // For 1mo use the original 1d data (higher resolution)
    const ts1=chartData?.timestamp||[];
    const cl1=chartData?.indicators?.quote?.[0]?.close||[];
    allPoints['1mo']=ts1.map((t,i)=>({x:t,y:cl1[i]})).filter(p=>p.y!=null);
  }catch{
    const ts1=chartData?.timestamp||[];
    const cl1=chartData?.indicators?.quote?.[0]?.close||[];
    const pts1mo=ts1.map((t,i)=>({x:t,y:cl1[i]})).filter(p=>p.y!=null);
    for(const r of SQ_RANGES) allPoints[r.k]=pts1mo;
  }

  const meta=priceData;
  const localName=lookupName(code);
  const name=localName||meta.shortName||meta.longName||code;
  const price=meta.regularMarketPrice;
  const prev=meta.chartPreviousClose||meta.regularMarketPreviousClose||price;
  const chg=price-prev, pct=prev?(chg/prev*100):0;
  const vol=meta.regularMarketVolume;
  const mktCap=meta.marketCap;
  const currency=meta.currency||'TWD';
  const dayAvg=meta.regularMarketDayHigh&&meta.regularMarketDayLow?(meta.regularMarketDayHigh+meta.regularMarketDayLow)/2:null;
  // Next dividend date from meta
  let nextDivDate='未定';
  if(meta.dividendDate){
    const nd=new Date(meta.dividendDate*1000);
    nextDivDate=nd.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});
  }
  // 4-week high/low from 1mo points
  const pts4w=allPoints['1mo']||[];
  const vals4w=pts4w.map(p=>p.y);
  const hi4w=vals4w.length?Math.max(...vals4w):null;
  const lo4w=vals4w.length?Math.min(...vals4w):null;

  const evts=divData?.events?.dividends||chartData?.events?.dividends;
  let divHistory=[];
  if(evts){
    divHistory=Object.values(evts).sort((a,b)=>b.date-a.date).slice(0,6).map(e=>({
      date:new Date(e.date*1000).toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'}),
      month:new Date(e.date*1000).getMonth()+1,
      amount:Math.round(e.amount*1000)/1000
    }));
  }
  const divMonths=divHistory.length?[...new Set(divHistory.map(d=>d.month))].sort((a,b)=>a-b):[];

  // Save state for range switching
  sqState={sym,meta,allPoints,divHistory,divMonths,name,code,range:'1mo'};

  const posColor=chg>=0?'var(--green)':'var(--red)';
  res.innerHTML=`
    <div class="card">
      <div class="row" style="margin-bottom:4px">
        <div>
          <div style="font-size:20px;font-weight:900">${name}</div>
          <div style="font-size:13px;color:var(--text3)">${code} · ${currency}</div>
        </div>
        <div style="text-align:right">
          <div class="mono" style="font-size:28px;font-weight:900">$${fmt(price,2)}</div>
          <div class="mono" style="font-size:14px;color:${posColor}">${pct>=0?'+':''}${fmt(pct,2)}% (${chg>=0?'+':''}${fmt(chg,2)})</div>
        </div>
      </div>
    </div>

    <!-- Chart card with range buttons -->
    <div class="card" style="padding:14px 14px 10px" id="sq-chart-card">
      <div class="row" style="margin-bottom:8px">
        <div style="font-size:13px;color:var(--text3);font-weight:600">股價走勢</div>
        <div style="display:flex;gap:3px">
          ${SQ_RANGES.map(r=>`<button onclick="sqSetRange('${r.k}')" id="sqr-${r.k}" style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;border:none;cursor:pointer;font-family:inherit;background:${r.k==='1mo'?'var(--blue)':'var(--bg3)'};color:${r.k==='1mo'?'#fff':'var(--text3)'}">${r.l}</button>`).join('')}
        </div>
      </div>
      <!-- Crosshair tooltip -->
      <div id="sq-tooltip" style="text-align:center;min-height:32px;margin-bottom:4px">
        <span style="font-size:11px;color:var(--text4)">長按後左右滑動查看各日價格</span>
      </div>
      <canvas id="sq-spark" style="cursor:crosshair"></canvas>
      <div id="sq-spark-dates" style="display:flex;justify-content:space-between;font-size:11px;color:var(--text4);margin-top:4px"></div>
    </div>

    <div class="card">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">基本資料</div>
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

    ${divHistory.length?`
    <div class="card">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">歷史配息紀錄</div>
      ${divHistory.map((d,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:${i<divHistory.length-1?'1px solid var(--border)':'none'}">
          <div><div style="font-size:14px;font-weight:${i===0?'700':'400'}">${d.date}</div><div style="font-size:12px;color:var(--text3)">${d.month}月除息</div></div>
          <div class="mono" style="font-size:16px;font-weight:700;color:var(--purple)">$${fmt(d.amount,3)}</div>
        </div>`).join('')}
    </div>`:'<div class="card"><div style="color:var(--text4);font-size:14px;text-align:center;padding:8px 0">無配息記錄</div></div>'}

    <button onclick="sqQuickAdd('${code}','${name.replace(/'/g,'')}')" class="btn btn-blue" style="margin-bottom:8px">＋ 加入我的持股</button>
  `;

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

// ── Draw chart with crosshair support ────────────────────────────────────────
function sqDrawChart(range){
  requestAnimationFrame(()=>{
    const canvas=document.getElementById('sq-spark');
    if(!canvas) return;
    const pricePoints=sqState.allPoints[range]||[];
    const datesEl=document.getElementById('sq-spark-dates');
    const tipEl=document.getElementById('sq-tooltip');
    if(datesEl&&pricePoints.length>=2){
      datesEl.innerHTML=`<span>${new Date(pricePoints[0].x*1000).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'})}</span><span>${new Date(pricePoints[pricePoints.length-1].x*1000).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'})}</span>`;
    }
    if(!pricePoints.length){canvas.style.display='none';return;}
    canvas.style.display='block';
    const W=canvas.parentElement.clientWidth-28||300;
    const H=100;
    const dpr=Math.ceil(window.devicePixelRatio||1);
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
    const toY=v=>H-4-(v-mn)/rng*(H-12);
    const pts=pricePoints.map((p,i)=>({x:toX(i),y:toY(p.y),ts:p.x,val:p.y}));

    const isUp=vals[vals.length-1]>=vals[0];
    const lineColor=isUp?'#30d158':'#ff453a';
    const grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,isUp?'rgba(48,209,88,0.22)':'rgba(255,69,58,0.22)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.lineTo(pts[pts.length-1].x,H); ctx.lineTo(pts[0].x,H); ctx.closePath();
    ctx.fillStyle=grad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.strokeStyle=lineColor; ctx.lineWidth=2; ctx.stroke();
    const last=pts[pts.length-1];
    ctx.beginPath(); ctx.arc(last.x,last.y,4,0,Math.PI*2);
    ctx.fillStyle=lineColor; ctx.fill();

    // Store pts for crosshair
    canvas._pts=pts; canvas._ctx=ctx; canvas._W=W; canvas._H=H;
    canvas._lineColor=lineColor; canvas._mn=mn; canvas._rng=rng;
    canvas._dpr=dpr; canvas._pricePoints=pricePoints;
    canvas._vals=vals;

    // Crosshair handlers
    function drawCrosshair(clientX,clientY){
      const rect=canvas.getBoundingClientRect();
      const x=(clientX-rect.left)*(W/rect.width);
      // Find nearest point
      let nearest=pts[0], nd=Infinity;
      pts.forEach(p=>{const d=Math.abs(p.x-x);if(d<nd){nd=d;nearest=p;}});
      // Redraw
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,W,H);
      // Redraw fill + line
      const g2=ctx.createLinearGradient(0,0,0,H);
      g2.addColorStop(0,isUp?'rgba(48,209,88,0.22)':'rgba(255,69,58,0.22)');
      g2.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.lineTo(pts[pts.length-1].x,H); ctx.lineTo(pts[0].x,H); ctx.closePath();
      ctx.fillStyle=g2; ctx.fill();
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.strokeStyle=lineColor; ctx.lineWidth=2; ctx.stroke();
      // Vertical crosshair line
      ctx.beginPath(); ctx.setLineDash([3,3]);
      ctx.moveTo(nearest.x,0); ctx.lineTo(nearest.x,H);
      ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1; ctx.stroke();
      ctx.setLineDash([]);
      // Circle on nearest point
      ctx.beginPath(); ctx.arc(nearest.x,nearest.y,5,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(nearest.x,nearest.y,3,0,Math.PI*2);
      ctx.fillStyle=lineColor; ctx.fill();
      // Tooltip
      const d=new Date(nearest.ts*1000);
      const dateStr=d.toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
      if(tipEl) tipEl.innerHTML=`<span style="font-size:13px;font-weight:700;color:#fff">${dateStr} &nbsp; <span style="color:${lineColor}">$${fmt(nearest.val,2)}</span></span>`;
    }
    function clearCrosshair(){
      // Redraw cleanly
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,W,H);
      const g2=ctx.createLinearGradient(0,0,0,H);
      g2.addColorStop(0,isUp?'rgba(48,209,88,0.22)':'rgba(255,69,58,0.22)');
      g2.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.lineTo(pts[pts.length-1].x,H); ctx.lineTo(pts[0].x,H); ctx.closePath();
      ctx.fillStyle=g2; ctx.fill();
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.strokeStyle=lineColor; ctx.lineWidth=2; ctx.stroke();
      ctx.beginPath(); ctx.arc(last.x,last.y,4,0,Math.PI*2);
      ctx.fillStyle=lineColor; ctx.fill();
      if(tipEl) tipEl.innerHTML='<span style="font-size:11px;color:var(--text4)">長按後左右滑動查看各日價格</span>';
    }
    // Touch events for crosshair (long press + drag)
    let touching=false, longPressTimer=null;
    canvas.ontouchstart=e=>{
      e.preventDefault();
      longPressTimer=setTimeout(()=>{touching=true;drawCrosshair(e.touches[0].clientX,e.touches[0].clientY);},300);
    };
    canvas.ontouchmove=e=>{
      e.preventDefault();
      if(touching) drawCrosshair(e.touches[0].clientX,e.touches[0].clientY);
    };
    canvas.ontouchend=e=>{
      e.preventDefault();
      clearTimeout(longPressTimer);
      if(touching){touching=false;setTimeout(clearCrosshair,1500);}
    };
    // Mouse for desktop
    canvas.onmousedown=e=>{touching=true;drawCrosshair(e.clientX,e.clientY);};
    canvas.onmousemove=e=>{if(touching)drawCrosshair(e.clientX,e.clientY);};
    canvas.onmouseup=()=>{touching=false;setTimeout(clearCrosshair,1500);};
    canvas.onmouseleave=()=>{if(touching){touching=false;clearCrosshair();}};
  });
}

function sqQuickAdd(code,name){
  // Pre-fill the add holding modal and switch to holdings page
  S.holdings.find(h=>h.code===code)
    ? (switchTab('holdings'), setTimeout(()=>openModal('addHolding',code),200))
    : (switchTab('holdings'), setTimeout(()=>{
        openModal('addHolding');
        setTimeout(()=>{
          const inp=document.getElementById('f-code');
          if(inp){ inp.value=code; onCodeInput(); }
        },50);
      },200));
}
