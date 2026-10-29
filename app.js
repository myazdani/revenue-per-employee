(() => {
  'use strict';
  const M = window.EfficiencyModel;
  // Presentation preferences do not change the source observations or downloads.
  const D = {
    ...window.EFFICIENCY_DATA,
    companies: window.EFFICIENCY_DATA.companies.map(c =>
      ['tubi', 'fox', 'roku', 'skydance'].includes(c.id) ? { ...c, featured: false, color: '#b6bebb' } : c)
  };
  const $ = id => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PAPER = '#f7f5ef', INK = '#1b292d', MUTED = '#718086', LINE = '#e3e5de';
  const companyById = new Map(D.companies.map(c => [c.id, c]));
  const cohorts = ['All companies', 'AI-native', 'Big Tech', 'Restructurers', 'Platforms', 'Software & infrastructure', 'Streaming & media'];
  const state = { year: 2026, cohort: 'All companies', selected: 'meta', trails: true, labels: true,
    basis: 'annual', playing: false, speed: 1, reportedOnly: false, showAll: false };
  let animationId = 0, resizeFrame = 0, toastTimer = 0, lastRankKey = '', lastSelectorCohort = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phoneLayout = window.matchMedia('(max-width: 700px)');
  let mobileDetailsOpen = false;
  const labelMeasure = document.createElement('canvas').getContext('2d');
  const labelWidths = new Map();
  const num = new Intl.NumberFormat('en-US');
  const dec = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const h = escapeHTML;
  const isWhole = y => Math.abs(y - Math.round(y)) < 1e-7;
  const yearLabel = y => Math.round(y) === 2026 ? '2026E' : String(Math.round(y));
  const moneyM = v => '$' + dec.format(v) + 'M';
  const moneyB = v => v === null ? 'Not encoded' : '$' + dec.format(v) + 'B';
  const headShort = v => v >= 1e6 ? dec.format(v / 1e6) + 'M' : v >= 1e3 ? dec.format(v / 1e3) + 'K' : String(v);
  const percent = (value, base) => { const change = (value / base - 1) * 100; return (change >= 0 ? '+' : '−') + num.format(Math.round(Math.abs(change))) + '%'; };
  const color = c => c.featured ? c.color : c.id === state.selected ? '#647e77' : c.color;
  const rpeText = p => (p.lowerBound ? '>' : p.revenueFloor ? '≈' : '') + moneyM(p.rpe);
  const employeeUnit = c => c.employeeUnit || 'employees';
  const isInCohort = (c, cohort) => cohort === 'All companies' || (cohort === 'Streaming & media' ? c.streaming : c.cohort === cohort);
  const pointStatus = p => p.comparison || p.company.supplemental ? p.status : p.kind === 'reported' ? 'Source-reported' : p.kind === 'projection' ? 'Projection' : 'Estimate / mixed';
  const sourceLinks = sources => (sources || []).map(s => `<a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.label)} ↗</a>`).join('');
  function el(tag, attrs = {}, text = null) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (text !== null) n.textContent = text;
    return n;
  }
  function append(parent, tag, attrs, text) { const n = el(tag, attrs, text); parent.appendChild(n); return n; }
  function visibleCompanies() { return D.companies.filter(c => isInCohort(c, state.cohort)); }
  function readURL() {
    const q = new URLSearchParams(location.search);
    const year = Number(q.get('year'));
    if (q.has('year') && Number.isInteger(year) && year >= 2019 && year <= 2026) state.year = year;
    if (companyById.has(q.get('company'))) state.selected = q.get('company');
    if (cohorts.includes(q.get('cohort'))) state.cohort = q.get('cohort');
    if (q.get('basis') === 'reference') state.basis = 'reference';
    if (!isInCohort(companyById.get(state.selected), state.cohort)) {
      state.selected = visibleCompanies()[0]?.id || 'meta';
    }
  }
  function saveURL() {
    const q = new URLSearchParams();
    q.set('year', Math.round(state.year)); q.set('company', state.selected);
    if (state.cohort !== 'All companies') q.set('cohort', state.cohort);
    if (state.basis !== 'annual') q.set('basis', state.basis);
    history.replaceState(null, '', location.pathname + '?' + q + location.hash);
  }
  function announce(text) { $('announcer').textContent = text; }
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
  function stopPlayback(snap = true) {
    cancelAnimationFrame(animationId); animationId = 0; state.playing = false;
    if (snap) state.year = Math.round(state.year);
    updatePlayButton();
  }
  function updatePlayButton() {
    $('play-text').textContent = state.playing ? 'Pause' : 'Play timeline';
    $('play-icon').textContent = state.playing ? 'Ⅱ' : '▶';
    $('play-button').setAttribute('aria-label', state.playing ? 'Pause timeline' : 'Play timeline');
  }
  function setYear(year, spoken = true) {
    stopPlayback(false); state.year = Math.max(2019, Math.min(2026, Math.round(year))); render(); saveURL();
    if (spoken) announce(`${yearLabel(state.year)}. ${visibleCompanies().filter(c => M.plottedPoint(c, state.year, state.basis)).length} companies shown.`);
  }
  function setCompany(id) {
    if (!companyById.has(id)) return;
    stopPlayback(); state.selected = id;
    if (!isInCohort(companyById.get(id), state.cohort)) {
      state.cohort = 'All companies'; toast('Showing all companies to include your selection.');
    }
    render(); saveURL(); announce(`${companyById.get(id).name} selected for ${yearLabel(state.year)}.`);
  }
  function setCohort(cohort) {
    stopPlayback(); state.cohort = cohort;
    if (!visibleCompanies().some(c => c.id === state.selected)) {
      state.selected = visibleCompanies().find(c => M.comparisonPoint(c, state.year))?.id || visibleCompanies()[0].id;
    }
    render(); saveURL(); announce(`${cohort}. ${visibleCompanies().length} companies in cohort.`);
  }
  function startPlayback() {
    if (state.playing) { stopPlayback(); render(); saveURL(); announce(`Paused at ${yearLabel(state.year)}.`); return; }
    state.year = Math.round(state.year);
    if (state.year >= 2026) state.year = 2019;
    state.playing = true; updatePlayButton(); render();
    let from = state.year, started = null, lastDraw = -Infinity;
    const frame = now => {
      if (!state.playing) return;
      if (started === null) started = now;
      const dwell = 600 / state.speed, duration = reducedMotion.matches ? 0 : 1000 / state.speed;
      const elapsed = now - started;
      const f = duration ? Math.max(0, Math.min(1, (elapsed - dwell) / duration)) : elapsed >= dwell ? 1 : 0;
      const next = from + f;
      if (Math.abs(state.year - next) > 1e-7 && (now - lastDraw > 35 || f === 1)) {
        state.year = next; render(); lastDraw = now;
      }
      if (f >= 1) {
        from += 1; state.year = from; started = now; announce(`${yearLabel(from)}.`);
        if (from >= 2026) { stopPlayback(); render(); saveURL(); return; }
      }
      animationId = requestAnimationFrame(frame);
    };
    animationId = requestAnimationFrame(frame);
  }
  function render() {
    updateControls(); drawFrontier(); renderDetails(); renderRanking();
  }
  function updateControls() {
    const whole = isWhole(state.year), round = Math.round(state.year), lower = Math.floor(state.year);
    $('year-display').classList.toggle('transition-year', !whole);
    $('year-display').innerHTML = whole ? `${round}${round === 2026 ? '<span>E</span>' : ''}` : `${lower} <span>→</span> ${yearLabel(lower + 1)}`;
    $('year-basis').textContent = !whole ? 'Visual transition · not an observation' : state.basis === 'reference' && round === 2026 ? 'Reference view · mixed observation periods' : round === 2026 ? 'Annual figures + dated comparisons' : 'Annual source observations';
    const n = visibleCompanies().filter(c => M.plottedPoint(c, state.year, state.basis)).length;
    $('chart-subtitle').textContent = `${n} ${n === 1 ? 'company' : 'companies'} in view · ${state.year > 2025 ? 'check each observation’s period' : 'annual source data'}`;
    $('company-count').textContent = String(D.companies.length);
    $('dataset-line').innerHTML = `${D.companies.length} COMPANIES <span>·</span> 2019–2026 <span>·</span> TECH, STREAMING &amp; MEDIA`;
    $('year-slider').value = String(round);
    $('mobile-year').value = String(round);
    $('year-slider').style.setProperty('--fill', (state.year - 2019) / 7 * 100 + '%');
    $('year-slider').setAttribute('aria-valuetext', whole ? yearLabel(round) + (round === 2026 ? ', includes projections' : '') : `Transition from ${lower} to ${lower + 1}`);
    $('prev-year').disabled = state.year <= 2019; $('next-year').disabled = state.year >= 2026;
    for (const button of $('year-ticks').children) {
      const active = whole && Number(button.dataset.year) === round;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
    document.querySelectorAll('[data-cohort]').forEach(b => { const yes = b.dataset.cohort === state.cohort; b.classList.toggle('active', yes); b.setAttribute('aria-pressed', String(yes)); });
    $('basis-select').value = state.basis;
    const reference = state.basis === 'reference';
    $('basis-note').classList.toggle('reference', reference);
    const mediaNote = state.year > 2025 && (state.cohort === 'All companies' || state.cohort === 'Streaming & media') ? ' Media comparisons: Skydance is FY2025 pro forma; Tubi uses a FY2025 revenue floor and a 2026 team estimate; Disney, Comcast, and Roku retain FY2025 values. Comcast uses FTEs. Select a company for sources.' : '';
    $('basis-note').textContent = (reference ? state.year > 2025 ? 'AI-lab reference view: OpenAI is held at its 2025 estimate. Anthropic is a separate Sep 2026 TTM lower bound; its hollow marker has no revenue-size meaning. AI-lab rankings retain annual CSV values.' : 'AI-lab reference annotations apply at 2026 only.' : '2026E includes reported fiscal years, estimates, and projections. Observation periods are shown in company details and rankings.') + mediaNote;
    $('time-description').textContent = !whole ? 'Movement interpolates revenue and headcount between annual rows.' : state.playing ? 'Following annual observations. Pause or drag to explore.' : 'Drag the slider or press play to follow the shift.';
    if (lastSelectorCohort !== 'initialized') {
      $('company-select').innerHTML = cohorts.slice(1).map(cohort => `<optgroup label="${h(cohort)}">${D.companies.filter(c => c.cohort === cohort).map(c => `<option value="${h(c.id)}">${h(c.name)}</option>`).join('')}</optgroup>`).join('');
      lastSelectorCohort = 'initialized';
    }
    $('company-select').value = state.selected;
  }
  function drawFrontier(exportSize = null) {
    const svg = $('frontier'), width = exportSize?.width || Math.max(270, $('chart-wrap').clientWidth);
    const compact = !exportSize && (width < 530 || phoneLayout.matches);
    const height = exportSize?.height || (compact ? Math.min(470, Math.max(360, Math.round(width * 1.16))) : Math.min(670, Math.max(575, width * .73)));
    const left = compact ? 41 : 62, right = compact ? 12 : 30, top = compact ? 24 : 14, bottom = compact ? 48 : 65;
    const pw = width - left - right, ph = height - top - bottom;
    const x = v => M.scaleX(v, left, pw), y = v => M.scaleY(v, top, ph);
    const maxRadius = compact ? 22 : 36;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
    svg.replaceChildren(el('title', {id:'chart-title'}, `Revenue per employee versus headcount, ${isWhole(state.year) ? yearLabel(state.year) : 'annual transition'}`), el('desc', {id:'chart-description'}, 'Horizontal axis: workforce size, logarithmic scale from 200 to 2.5 million. Vertical axis: revenue per employee, zero to 9 million US dollars. Comcast uses full-time equivalents. Filled bubble area is proportional to revenue; Tubi uses its disclosed revenue floor. Choose a company from the adjacent selector for periods, definitions, and source links.'));
    const g = append(svg, 'g', {'aria-hidden':'true'});
    for (const tick of [0, 2, 4, 6, 8]) {
      append(g, 'line', { x1:left, x2:width-right, y1:y(tick), y2:y(tick), stroke:LINE, 'stroke-width':1 });
      append(g, 'text', { x:left-12, y:y(tick)+4, 'text-anchor':'end', fill:MUTED, 'font-size':compact ? 11 : 12 }, '$' + tick + 'M');
    }
    const xticks = compact ? [1000, 10000, 100000, 1000000] : [300, 1000, 10000, 100000, 1000000];
    for (const tick of xticks) {
      append(g, 'line', {x1:x(tick), x2:x(tick), y1:top, y2:y(0), stroke:LINE, 'stroke-width':1, 'stroke-dasharray':'2 3'});
      append(g, 'text', {x:x(tick), y:y(0)+23, 'text-anchor':'middle', fill:MUTED, 'font-size':compact ? 11 : 12}, headShort(tick));
    }
    for (let decade = 100; decade <= 1000000; decade *= 10) for (let k=1;k<=9;k++) {
      const value = decade*k;
      if (value >= M.X_DOMAIN[0] && value <= M.X_DOMAIN[1]) append(g, 'line', {x1:x(value), x2:x(value), y1:y(0)+1, y2:y(0)+4, stroke:'#8b9590', 'stroke-width':.8});
    }
    if (compact) append(g, 'text', {x:left, y:12, fill:'#46575e', 'font-size':11, 'font-weight':600}, 'Revenue per employee ($)');
    else append(g, 'text', {x:14, y:top+ph/2, transform:`rotate(-90 14 ${top+ph/2})`, 'text-anchor':'middle', fill:'#46575e', 'font-size':11, 'font-weight':650, 'letter-spacing':'.4px'}, 'REVENUE PER EMPLOYEE');
    append(g, 'text', {x:left+pw/2, y:height-9, 'text-anchor':'middle', fill:'#46575e', 'font-size':11, 'font-weight':600}, compact ? 'Employees · log scale' : 'TOTAL EMPLOYEES · LOG SCALE');
    const companies = visibleCompanies();
    const points = companies.map(c => M.plottedPoint(c, state.year, state.basis)).filter(Boolean);
    $('chart-empty').hidden = points.length > 0;
    if (state.trails) {
      const trails = append(g, 'g', {});
      for (const c of companies) {
        if (!(c.featured || c.id === state.selected || companies.length <= 12)) continue;
        const rows = M.trailPoints(c, state.year, state.basis);
        for (let i=1;i<rows.length;i++) {
          const a=rows[i-1], b=rows[i];
          append(trails, 'path', {d:`M${x(a.headcount)},${y(a.rpe)} L${x(b.headcount)},${y(b.rpe)}`, fill:'none', stroke:color(c), 'stroke-opacity':c.id===state.selected ? .55 : compact ? .14 : .27, 'stroke-width':c.id===state.selected ? 2.2 : compact ? 1.3 : 1.8, 'stroke-linejoin':'round', 'stroke-linecap':'round', 'stroke-dasharray':a.kind!=='reported'||b.kind!=='reported' ? '4 4' : null});
        }
      }
    }
    const mapped = points.map(p => ({...p, cx:x(p.headcount), cy:y(p.rpe), radius:p.reference === 'ttm' ? 9 : M.radius(p.revenue,maxRadius)}));
    // Paint large circles first, then smaller ones, so every company remains selectable.
    mapped.sort((a,b)=>b.radius-a.radius);
    const circles = append(g,'g',{});
    for (const p of mapped) {
      const c=p.company, selected=c.id===state.selected, fill=color(c);
      const group=append(circles,'g',{'data-company':c.id,class:'company-mark'});
      if(selected) append(group,'circle',{cx:p.cx,cy:p.cy,r:p.radius+5,fill:'none',stroke:fill,'stroke-width':1.1,'stroke-opacity':.6});
      append(group,'circle',{cx:p.cx,cy:p.cy,r:p.radius,fill:p.reference==='ttm'?PAPER:fill,'fill-opacity':p.revenueFloor ? .45 : c.featured ? .94 : .86,stroke:p.reference==='ttm'||p.revenueFloor?fill:PAPER,'stroke-width':p.reference==='ttm'?2.5:p.revenueFloor?1.3:.6,'stroke-dasharray':p.revenueFloor?'2 2':null});
      append(group,'circle',{cx:p.cx,cy:p.cy,r:Math.max(compact ? 12 : 9,p.radius),fill:'transparent',stroke:'none'});
      append(group,'title',{},`${c.name}: ${rpeText(p)} per ${employeeUnit(c)==='FTEs'?'FTE':'employee'}; ${p.approximateHeadcount?'approximately ':''}${num.format(Math.round(p.headcount))} ${employeeUnit(c)}; ${p.status}`);
      group.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showTooltip(p,event);});
      group.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')moveTooltip(event);});
      group.addEventListener('pointerleave',hideTooltip);
      group.addEventListener('click',()=>{hideTooltip();setCompany(c.id);});
    }
    if (state.labels) drawLabels(g,mapped,{width,height,left,right,top,bottom,compact});
  }
  function drawLabels(g, points, box) {
    const {width,height,left,right,top,bottom,compact}=box;
    // Phone labels stay close to their own bubble; detail remains available on tap.
    const priority = ['openai','anthropic','nvidia','amazon','apple','netflix','microsoft','alphabet','block','coinbase','opendoor'];
    const candidates = points.filter(p=>p.company.featured || p.company.id===state.selected || (!compact && points.length<=12))
      .sort((a,b)=>(b.company.id===state.selected)-(a.company.id===state.selected) || (b.reference==='ttm')-(a.reference==='ttm') || (compact ? (priority.indexOf(a.company.id)<0?99:priority.indexOf(a.company.id))-(priority.indexOf(b.company.id)<0?99:priority.indexOf(b.company.id)) : b.rpe-a.rpe));
    const labelLimit = compact ? 6 : Infinity;
    const used=[];
    const intersects=(a,b)=>a.x<b.x+b.w+4 && a.x+a.w+4>b.x && a.y<b.y+b.h+4 && a.y+a.h+4>b.y;
    for(const p of candidates){
      if (used.length >= labelLimit) break;
      const reference = p.reference && state.year>2025;
      const comparisonLabel=p.comparisonType==='proforma'?' · pro forma':p.comparisonType==='mixed'?' · estimate':p.comparisonType==='carry'?' · FY'+p.sourceYear:'';
      const lines = p.reference==='ttm' ? ['Anthropic >$6.6M','Sep 2026 · S-1 TTM'] : p.reference==='carried' ? ['OpenAI · 2025 estimate','$5.65M · unverified'] : [(p.company.shortName || p.company.name)+comparisonLabel+(employeeUnit(p.company)==='FTEs'?' (FTE)':'')];
      if (compact && !reference) lines[0] = p.company.shortName || p.company.name;
      const fs = 12, font = getComputedStyle(document.body).fontFamily;
      const measure = text => {
        const key = `${font}|${fs}|${text}`;
        if (!labelWidths.has(key)) { labelMeasure.font = `650 ${fs}px ${font}`; labelWidths.set(key, labelMeasure.measureText(text).width); }
        return labelWidths.get(key);
      };
      const w = Math.ceil(Math.max(...lines.map(measure))) + (reference?12:2), hh = lines.length*15+(reference?9:0);
      const gap=Math.max(8,p.radius+5);
      const options=[];
      const offsets = compact ? [-hh/2, -hh-3, 5, -hh-14, 17] : [-hh-4,7,-hh/2,-hh-22,27,-hh-42,48,-hh-62,69,-hh-88,95,-hh-115];
      for(const dy of offsets){
        options.push({x:p.cx+gap,y:p.cy+dy,w,h:hh});
        options.push({x:p.cx-gap-w,y:p.cy+dy,w,h:hh});
      }
      options.push({x:p.cx-w/2,y:p.cy-p.radius-hh-6,w,h:hh});
      if (compact) options.push({x:p.cx-w/2,y:p.cy+p.radius+6,w,h:hh});
      const coversBubble=o=>points.some(q=>q!==p && Math.hypot(q.cx-Math.max(o.x,Math.min(q.cx,o.x+o.w)),q.cy-Math.max(o.y,Math.min(q.cy,o.y+o.h)))<q.radius+3);
      let choice=options.find(o=>o.x>=left+1 && o.x+o.w<=width-right+3 && o.y>=top && o.y+o.h<=height-bottom-3 && !used.some(u=>intersects(o,u)) && !coversBubble(o));
      if(!choice && !compact){
        choice=options.find(o=>o.x>=left+1 && o.x+o.w<=width-2 && o.y>=top && o.y+o.h<=height-bottom-2 && !used.some(u=>intersects(o,u)) && !coversBubble(o));
      }
      if(!choice) continue;
      used.push(choice);
      const anchorX=Math.max(choice.x,Math.min(p.cx,choice.x+w)), anchorY=Math.max(choice.y,Math.min(p.cy,choice.y+hh));
      if(reference||Math.hypot(anchorX-p.cx,anchorY-p.cy)>p.radius+20) append(g,'line',{x1:p.cx,y1:p.cy,x2:anchorX,y2:anchorY,stroke:color(p.company),'stroke-width':.8,'stroke-opacity':.6});
      if(reference) append(g,'rect',{x:choice.x,y:choice.y,width:w,height:hh,rx:3,fill:PAPER,stroke:color(p.company),'stroke-opacity':.38,'stroke-width':1});
      lines.forEach((line,i)=>append(g,'text',{x:choice.x+(reference?6:0),y:choice.y+(reference?14:11)+i*15,fill:p.company.featured?color(p.company):'#526a61','font-size':fs,'font-weight':i===0?650:500,class:reference?null:'bubble-label'},line));
    }
  }
  function showTooltip(point,event){
    if(state.playing)return;
    const t=$('tooltip');
    t.innerHTML=`<strong>${h(point.company.name)}</strong><span class="tip-value">${h(rpeText(point))}</span> / ${employeeUnit(point.company)==='FTEs'?'FTE':'employee'}<dl><div><dt>${point.revenueFloor?'Revenue floor':'Revenue'}</dt><dd>${point.reference==='ttm'?'TTM threshold only':(point.revenueFloor?'&gt;':'')+moneyB(point.revenue)}</dd></div><div><dt>${employeeUnit(point.company)==='FTEs'?'FTEs':'Employees'}</dt><dd>${point.approximateHeadcount?'≈ ':''}${num.format(Math.round(point.headcount))}</dd></div></dl><small>${h(point.status)}</small><small>${point.comparison?h(point.note):point.reference==='carried'?'2025 estimate shown in the 2026 reference view.':point.reference==='ttm'?'Sep 2026. Hollow marker has no revenue-size meaning.':point.observed?`Source year ${point.sourceYear}. Click to follow this company.`:'Interpolated position; not an observed data point.'}</small>`;
    t.hidden=false; moveTooltip(event);
  }
  function moveTooltip(event){
    const t=$('tooltip'); if(t.hidden)return;
    const rect=$('chart-wrap').getBoundingClientRect(),tw=t.offsetWidth,th=t.offsetHeight;
    let x=event.clientX-rect.left+14,y=event.clientY-rect.top-th-13;
    if(x+tw>rect.width-5)x=event.clientX-rect.left-tw-14;
    if(y<3)y=event.clientY-rect.top+18;
    t.style.left=Math.max(3,Math.min(rect.width-tw-3,x))+'px';t.style.top=Math.max(3,Math.min(rect.height-th-3,y))+'px';
  }
  function hideTooltip(){$('tooltip').hidden=true;}
  function updateMobileSummary(company, point) {
    $('mobile-company-name').textContent = company.name;
    $('mobile-company-rpe').textContent = point ? rpeText(point) : 'No observation';
    $('mobile-company-metrics').textContent = point ? `${point.revenueFloor ? '>' : ''}${moneyB(point.revenue)} revenue · ${point.approximateHeadcount ? '≈ ' : ''}${num.format(Math.round(point.headcount))} ${employeeUnit(company)}` : `No data for ${Math.floor(state.year)}. Choose another year.`;
    if (point?.reference === 'ttm') $('mobile-company-metrics').textContent = `${num.format(Math.round(point.headcount))} employees · revenue not encoded`;
    $('mobile-company-status').textContent = point ? `${point.status}${point.comparison || point.reference ? '' : ' · ' + point.sourceYear}` : '';
    $('mobile-detail-toggle').setAttribute('aria-expanded', String(mobileDetailsOpen));
    $('mobile-detail-toggle').textContent = mobileDetailsOpen ? 'Hide details ↑' : 'Details & sources ↓';
  }
  function applyPhoneLayout() {
    // Move the same native selector, not a duplicate, so state and keyboard access stay in sync.
    const picker = $('company-picker');
    if (phoneLayout.matches) $('mobile-company-slot').appendChild(picker);
    else $('desktop-company-slot').appendChild(picker);
    document.body.classList.toggle('mobile-details-open', mobileDetailsOpen);
    hideTooltip();
    render();
  }
  function renderDetails(){
    const c=companyById.get(state.selected),p=M.plottedPoint(c,state.year,state.basis);
    updateMobileSummary(c,p);
    $('company-name').textContent=c.name; $('company-color').style.background=color(c); $('company-group').textContent=c.group;
    $('detail-content').hidden=!p; $('detail-empty').hidden=!!p;
    if(!p){
      const firstYear=c.rows[0]?.year || c.comparisons?.[0]?.viewYear;
      $('detail-empty').innerHTML=`No observation for ${h(c.name)} in ${Math.floor(state.year)}. ${c.rows.length?'This annual series begins':'A dated comparison is available'} in ${firstYear}.<button id="jump-first">Jump to ${firstYear} →</button>`;
      $('jump-first').onclick=()=>setYear(firstYear);return;
    }
    $('detail-metric-label').textContent=employeeUnit(c)==='FTEs'?'REVENUE PER FTE':'REVENUE PER EMPLOYEE';
    $('detail-rpe').innerHTML=`${p.lowerBound?'&gt;':p.revenueFloor?'≈':''}$${dec.format(p.rpe)}<span>M</span>`;
    $('detail-status').textContent=p.status+(p.interpolated||p.reference||c.supplemental?'':` · ${p.sourceYear}`);
    $('detail-status').classList.toggle('reported',p.kind==='reported');
    $('revenue-label').textContent=p.revenueFloor?'Revenue floor':'Revenue';
    $('detail-revenue').textContent=(p.revenueFloor?'>':'')+moneyB(p.revenue);
    $('employee-label').textContent=employeeUnit(c)==='FTEs'?'FTEs':employeeUnit(c)==='full-time employees'?'Full-time employees':employeeUnit(c)==='team members'?'Team members':'Employees';
    $('detail-headcount').textContent=(p.approximateHeadcount?'≈ ':'')+num.format(Math.round(p.headcount));
    const basis=p.note || (p.reference==='ttm'?'Sep 2026 TTM disclosure. Revenue is not inferred from the lower-bound RPE. The annual CSV chart below is a separate series.':p.reference==='carried'?'2025 estimate carried into the 2026 reference view. The annual CSV’s 2026 estimate is $6.58M per employee.':p.interpolated?'Visual interpolation of revenue and headcount. Source observations exist only at whole-year positions.':p.kind==='reported'?'Source labels this row Actual. Period and currency qualifiers appear in the status above.':'Directional source estimate or projection; not an independently verified actual.');
    $('detail-basis').textContent=basis+(c.scopeNote?' '+c.scopeNote:'');
    const sources=p.sources || (p.interpolated?p.endpoints?.flatMap(r=>r.sources||[]):[]) || [];
    const uniqueSources=[...new Map(sources.map(s=>[s.url,s])).values()];
    $('detail-sources').innerHTML=sourceLinks(uniqueSources);
    $('detail-sources').hidden=!uniqueSources.length;
    $('trend-section').hidden=!c.rows.length;
    $('detail-content').classList.toggle('single-comparison',!c.rows.length);
    $('change-section').hidden=c.rows.length<2;
    $('events-section').hidden=!!c.supplemental;
    if(c.rows.length)drawTrend(c,p);
    const base=c.rows[0];
    if(base){
      $('change-heading').textContent=p.reference==='ttm'?'Annual comparison unavailable':`Change since ${base.year}${p.comparison?' · through '+p.sourceYear:''}`;
      for(const metric of ['revenue','headcount','rpe']) $('change-'+metric).textContent=p.reference==='ttm'?'Different basis':percent(p[metric],base[metric]);
    }
    const eventYear=Math.floor(state.year+1e-7),events=D.events.filter(e=>e.company===c.name&&e.year===eventYear);
    $('event-year').textContent=String(eventYear);
    $('company-events').innerHTML=events.length?events.map(e=>`<p><span class="event-mark"></span>${h(e.label)}</p>`).join(''):'<p class="no-events">No annotation in the source for this year.</p>';
  }
  function drawTrend(company,point){
    const svg=$('company-trend'),w=Math.max(125,svg.clientWidth),hh=122;
    const padL=3,padR=8,padT=19,padB=22;
    const max=Math.max(...company.rows.map(r=>r.rpe))*1.18;
    const x=year=>padL+(year-2019)/7*(w-padL-padR), y=v=>padT+(1-v/max)*(hh-padT-padB);
    svg.setAttribute('viewBox',`0 0 ${w} ${hh}`);svg.setAttribute('height',hh);svg.replaceChildren();
    $('trend-years').textContent=`${company.rows[0].year}–${company.rows.at(-1).year}`;
    append(svg,'title',{},`${company.name}, annual source revenue per employee from ${company.rows[0].year} to ${company.rows.at(-1).year}. Future annual observations are shown faintly for context.`);
    append(svg,'line',{x1:0,x2:w,y1:y(0),y2:y(0),stroke:LINE,'stroke-width':1});
    const rows=company.rows;
    for(let i=1;i<rows.length;i++){
      const a=rows[i-1],b=rows[i];
      append(svg,'path',{d:`M${x(a.year)},${y(a.rpe)}L${x(b.year)},${y(b.rpe)}`,fill:'none',stroke:color(company),'stroke-width':1.8,'stroke-opacity':b.year<=state.year?1:.22,'stroke-dasharray':a.kind!=='reported'||b.kind!=='reported'?'3 3':null});
    }
    const trendYear=point.comparison?point.sourceYear:state.year,annual=M.annualPoint(company,trendYear);
    if(annual){append(svg,'line',{x1:x(trendYear),x2:x(trendYear),y1:10,y2:y(0),stroke:'#cdd3c9','stroke-dasharray':'2 3'});append(svg,'circle',{cx:x(trendYear),cy:y(annual.rpe),r:3.5,fill:color(company),stroke:PAPER,'stroke-width':1});}
    append(svg,'text',{x:0,y:hh-3,fill:MUTED,'font-size':9},'2019');
    append(svg,'text',{x:w,y:hh-3,fill:MUTED,'font-size':9,'text-anchor':'end'},'2026E');
    append(svg,'text',{x:w,y:10,fill:MUTED,'font-size':9,'text-anchor':'end'},moneyM(Math.max(...rows.map(r=>r.rpe)))+' peak');
    $('trend-note').textContent=point.comparison?`FY${point.sourceYear} is the latest annual observation shown; there is no fabricated ${point.viewYear} data point.`:point.reference?'Annual CSV series; different from the reference annotation.':`Dashed: estimated/projected. Faint: later annual rows.${company.rows[0].year>2019?' Data begins in '+company.rows[0].year+'.':''}`;
  }
  function renderRanking(){
    const annualYear=Math.floor(state.year+1e-7),key=[annualYear,state.cohort,state.reportedOnly,state.showAll,state.selected].join('|');
    $('ranking-year').textContent=yearLabel(annualYear);
    const media=state.cohort==='All companies'||state.cohort==='Streaming & media';
    $('ranking-note').textContent=(!isWhole(state.year)?`During playback, ranking holds the last completed year (${yearLabel(annualYear)}). `:'')+'E = estimate / mixed; P = projection. '+(media?'Media rows identify fiscal years, carried values, and pro forma estimates. Comcast uses FTEs; Disney and other parent companies include businesses beyond streaming. Tubi is already part of Fox. ':'')+(state.basis==='reference'&&annualYear===2026?'AI-lab rankings retain annual CSV values. ':'')+'Source-reported follows the original dataset or linked company filing; approximate estimates do not establish a precise ordering.';
    if(key===lastRankKey)return;lastRankKey=key;
    const all=M.annualRanking(visibleCompanies(),state.year,state.reportedOnly),rows=state.showAll?all:all.slice(0,12);
    $('show-all').hidden=all.length<=12;$('show-all').textContent=state.showAll?'Show top 12':`Show all ${all.length} companies`;
    $('ranking-empty').hidden=rows.length>0;
    $('ranking-grid').innerHTML=rows.map((p,index)=>{
      const c=p.company,unit=employeeUnit(c)==='FTEs'&&!pointStatus(p).includes('FTE')?' · FTE basis':'';
      const scopes={disney:'Disney+ / Hulu parent',comcast:'Peacock parent',fox:'Tubi parent',roku:'Platform + devices',tubi:'Streaming service estimate'};
      const scope=scopes[c.id];
      return `<div role="listitem"><button class="rank-row${c.id===state.selected?' selected':''}" data-rank-company="${h(c.id)}" aria-label="${h(c.name)}, ${h(rpeText(p))} revenue per ${employeeUnit(c)==='FTEs'?'FTE':'employee'}, ${h(p.status)}. Select company."><span class="rank-index">${String(index+1).padStart(2,'0')}</span><span class="rank-body"><span class="rank-top"><span class="rank-name">${h(c.name)}</span><span class="rank-value">${h(rpeText(p))}${p.kind==='reported'?'':`<sup>${p.kind==='projection'?'P':'E'}</sup>`}</span></span><span class="rank-bar-track" style="display:block"><span class="rank-bar" style="display:block;width:${p.rpe/9*100}%;background:${color(c)}"></span></span><span class="rank-status">${h(pointStatus(p)+unit)}${scope?'<br>'+h(scope):''}</span></span></button></div>`;
    }).join('');
  }
  async function exportChart(){
    stopPlayback();render();hideTooltip();
    const button=$('export-chart');button.disabled=true;button.textContent='Preparing…';
    try{
      // Export at a stable, readable poster size on phones and desktops alike.
      drawFrontier({width:1000,height:960});
      const svg=$('frontier').cloneNode(true);
      const w=1000,hh=960,pad=28,header=125,footer=108,totalW=w+pad*2,totalH=hh+header+footer;
      drawFrontier();
      const out=el('svg',{xmlns:SVG_NS,width:totalW,height:totalH,viewBox:`0 0 ${totalW} ${totalH}`});
      append(out,'style',{},'text{font-family:Arial,sans-serif}.bubble-label{paint-order:stroke;stroke:#f7f5ef;stroke-width:4px;stroke-linejoin:round}');
      append(out,'rect',{width:totalW,height:totalH,fill:PAPER});
      append(out,'text',{x:pad,y:39,fill:INK,'font-size':Math.min(27,w/19),'font-weight':750},'Revenue per employee');
      append(out,'text',{x:pad,y:64,fill:MUTED,'font-size':12},'Revenue, headcount, and company scale over time.');
      const count=visibleCompanies().filter(c=>M.plottedPoint(c,state.year,state.basis)).length;
      append(out,'text',{x:pad,y:95,fill:'#b98932','font-size':13,'font-weight':700},state.cohort==='All companies'?`${count} COMPANIES · 2019–2026E · REVENUE PER EMPLOYEE`:`${state.cohort.toUpperCase()} · ${count} COMPANIES`);
      append(out,'text',{x:totalW-pad,y:100,fill:'#b98932','font-size':35,'font-weight':700,'text-anchor':'end'},yearLabel(state.year));
      const plot=append(out,'g',{transform:`translate(${pad} ${header})`});while(svg.firstChild)plot.appendChild(svg.firstChild);
      const media=state.cohort==='All companies'||state.cohort==='Streaming & media';
      const footerLines=[
        'Bubble area = revenue; Tubi uses a revenue floor. Comcast uses FTEs. Other workforce definitions vary.',
        media&&state.year===2026?'Skydance: FY2025 pro forma. Tubi: FY2025 floor / ~700-person 2026 team. Disney, Comcast, Roku: FY2025 carried.':'Annual observations, estimates and projections. No history is inferred for single comparison points.',
        state.basis==='reference'&&state.year===2026?'AI reference: Anthropic >$6.6M Sep 2026 TTM (unscaled hollow marker); OpenAI = 2025 estimate.':'Parent-company values include businesses beyond streaming. Select each company online for sources and scope.',
        'Sources: derrickongchin.com/analysis/ai-efficiency-era + company filings and disclosures · Oct 28, 2026'
      ];
      footerLines.forEach((line,i)=>append(out,'text',{x:pad,y:header+hh+18+i*18,fill:MUTED,'font-size':11},line));
      const svgBlob=new Blob([new XMLSerializer().serializeToString(out)],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(svgBlob);
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('The chart could not be rendered.'));img.src=url;});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(totalW*2);canvas.height=Math.ceil(totalH*2);
      const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG could not be created.');
      const fileURL=URL.createObjectURL(blob),a=document.createElement('a');a.href=fileURL;a.download=`revenue-per-employee-${Math.round(state.year)}-${state.basis}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(fileURL),1500);toast('Chart exported with year, basis, and source notes.');
    }catch(error){toast(error.message||'Export failed. Please try again.');}
    finally{button.disabled=false;button.innerHTML='Export PNG <span aria-hidden="true">↓</span>';}
  }
  readURL();
  $('mobile-year').innerHTML = D.meta.years.map(year => `<option value="${year}">${yearLabel(year)}</option>`).join('');
  $('mobile-year').addEventListener('change', event => setYear(Number(event.target.value)));
  $('mobile-detail-toggle').addEventListener('click', () => {
    mobileDetailsOpen = !mobileDetailsOpen;
    document.body.classList.toggle('mobile-details-open', mobileDetailsOpen);
    renderDetails();
    if (mobileDetailsOpen) $('company-panel').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'});
  });
  phoneLayout.addEventListener('change', applyPhoneLayout);
  $('year-ticks').innerHTML=D.meta.years.map(year=>`<button data-year="${year}" aria-label="Go to ${yearLabel(year)}" aria-pressed="false">${yearLabel(year)}</button>`).join('');
  $('year-ticks').addEventListener('click',event=>{const b=event.target.closest('[data-year]');if(b)setYear(Number(b.dataset.year));});
  document.querySelectorAll('[data-cohort]').forEach(b=>b.addEventListener('click',()=>setCohort(b.dataset.cohort)));
  $('year-slider').addEventListener('input',event=>setYear(Number(event.target.value),false));
  $('year-slider').addEventListener('change',()=>announce(`${yearLabel(state.year)} selected.`));
  $('prev-year').addEventListener('click',()=>setYear(Math.ceil(state.year)-1));
  $('next-year').addEventListener('click',()=>setYear(Math.floor(state.year)+1));
  $('play-button').addEventListener('click',startPlayback);
  $('play-speed').addEventListener('change',event=>{const wasPlaying=state.playing;stopPlayback();state.speed=Number(event.target.value);if(wasPlaying)startPlayback();else render();});
  $('trails-toggle').addEventListener('change',event=>{stopPlayback();state.trails=event.target.checked;render();});
  $('labels-toggle').addEventListener('change',event=>{stopPlayback();state.labels=event.target.checked;render();});
  $('basis-select').addEventListener('change',event=>{stopPlayback();state.basis=event.target.value;render();saveURL();announce(state.basis==='reference'?'Reference annotations enabled for the 2026 endpoint.':'Annual source dataset selected.');});
  $('company-select').addEventListener('change',event=>setCompany(event.target.value));
  $('clear-selection').addEventListener('click',()=>{stopPlayback();state.selected=visibleCompanies().find(c=>c.id==='meta')?.id||visibleCompanies()[0].id;render();saveURL();});
  $('reported-only').addEventListener('change',event=>{stopPlayback();state.reportedOnly=event.target.checked;render();});
  $('show-all').addEventListener('click',()=>{state.showAll=!state.showAll;renderRanking();});
  $('ranking-grid').addEventListener('click',event=>{const b=event.target.closest('[data-rank-company]');if(b){setCompany(b.dataset.rankCompany);$('company-select').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'center'});}});
  $('export-chart').addEventListener('click',exportChart);
  $('chart-wrap').addEventListener('pointerleave',hideTooltip);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing){stopPlayback();render();saveURL();}});
  new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{drawFrontier();renderDetails();});}).observe($('chart-wrap'));
  document.querySelectorAll('a[href="#reference-note"]').forEach(a=>a.addEventListener('click',()=>{$('reference-note').open=true;}));
  applyPhoneLayout();
  // Read-only access for reproducibility and numerical inspection.
  window.revenuePerEmployee={getState:()=>({...state}),getPoint:(id,year,basis='annual')=>M.plottedPoint(companyById.get(id),year,basis)};
})();
