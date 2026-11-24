"use strict";
const $ = id => document.getElementById(id);
const ages = [1,3,7,14,28,56,90,180];
const materials = ["Cement","Slag","Fly ash","Silica fume","Calcined clay","Limestone","Other SCM"];
const data = new Map(), loading = new Map();
const defaultFilters = () => ({age:28, target:40, wb:"", paper:"", scm:1});
const filters = {a:defaultFilters(), b:defaultFilters()};
let study="a", rows=[], points=[], page=0, generation=0, busy=true;
const pins = [], pageSize=12;
const fmt = (value, digits=1) => value == null ? "—" : value.toLocaleString("en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits});
const count = v => fmt(v,0);
const el = (tag, text) => {const n=document.createElement(tag); if(text!==undefined)n.textContent=text; return n;};
const recipeKey = r => [r.na,r.ms,r.wb,r.react].join("|");
const mixName = r => "Mix "+String(r.id).padStart(5,"0");
function fraction(r,index) {
  if(r.binder.some(v=>v==null))return null;
  const total=r.binder.reduce((a,b)=>a+b,0);
  return total>0 ? 100*r.binder[index]/total : null;
}
function seriesValues(r) {
  return study==="a" ? [r.co2,r.cost] : [fraction(r,filters.b.scm),r.strength];
}
window.loadDataset = (name,[columns,records]) => {
  data.set(name,records.map(values=>Object.fromEntries(columns.map((col,i)=>[col,values[i]]))));
};
function load(name) {
  if(data.has(name))return Promise.resolve(data.get(name));
  if(!loading.has(name)){
    const promise=new Promise((resolve,reject)=>{
      const script=el("script");
      script.onload=()=>data.has(name)?resolve(data.get(name)):reject(Error("Invalid data file: "+name));
      script.onerror=()=>reject(Error("Could not open data/"+name+".js"));
      script.src="data/"+name+".js"; document.head.append(script);
    }).finally(()=>loading.delete(name));
    loading.set(name,promise);
  }
  return loading.get(name);
}
function addSelect(id,label,options,value,onChange){
  const box=el("div"); box.className="field";
  const name=el("label",label);name.htmlFor=id;
  const select=el("select"); select.id=id;
  for(const [key,title] of options)select.add(new Option(title,String(key)));
  select.value=String(value);
  select.onchange=()=>onChange(select.value);
  box.append(name,select);$("fields").append(box);
}
function buildFilters(){
  const f=filters[study], a=study==="a";
  $("fields").replaceChildren();
  const lit=data.get("literature")||[];
  const ageList=a?ages:[...new Set(lit.map(r=>r.age).filter(v=>v!=null))].sort((x,y)=>x-y);
  const ageOptions=ageList.map(v=>[v,v+" days"]);
  if(!a)ageOptions.unshift(["","All ages"]);
  addSelect("age","Curing age",ageOptions,f.age,v=>{
    f.age=v===""?"":Number(v); updateStudy();
  });
  if(a){
    const box=el("div");box.className="field";
    const label = el("label", "Minimum strength (MPa)");
    label.htmlFor = "target-exact";
    const exact = el("input");
    exact.type = "number"; exact.id = "target-exact"; exact.min = "0"; exact.step = "any";
    exact.value = f.target; exact.placeholder = "0";
    const slider = el("input");
    slider.type = "range"; slider.id = "target"; slider.min = "0"; slider.max = "150"; slider.step = "1";
    slider.value = Math.min(150, f.target);
    slider.setAttribute("aria-label", "Minimum strength in whole MPa, up to 150");
    const message = el("small");
    message.setAttribute("role", "status");
    message.hidden = true;
    exact.oninput = () => {
      if (!exact.validity.valid) {
        message.textContent = "Enter a nonnegative strength. Current filter: " + f.target + " MPa.";
        message.hidden = false;
        return;
      }
      f.target = Number(exact.value);
      slider.value = Math.min(150, f.target);
      message.hidden = true;
      applyFilters();
    };
    slider.oninput = () => {
      f.target = Number(slider.value);
      exact.value = f.target;
      message.hidden = true;
      applyFilters();
    };
    box.append(label, exact, slider, message);
    $("fields").append(box);
    const choices=[...new Set((data.get("aas-"+f.age)||[]).map(r=>r.wb))].sort((x,y)=>x-y);
    if(f.wb!==""&&!choices.includes(Number(f.wb)))f.wb="";
    addSelect("wb","Water/binder ratio",[["","All ratios"],...choices.map(v=>[v,fmt(v,2)])],f.wb,v=>{f.wb=v;applyFilters();});
  }else{
    addSelect("scm","Binder constituent",materials.slice(1).map((v,i)=>[i+1,v]),f.scm,v=>{f.scm=Number(v);applyFilters();});
    addSelect("wb","Water/binder ratio",[["","All ratios"],["low","Below 0.40"],["mid","0.40 to below 0.60"],["high","0.60 or higher"]],f.wb,v=>{f.wb=v;applyFilters();});
    const dois=[...new Set(lit.map(r=>r.doi).filter(Boolean))].sort();
    addSelect("paper","Source paper",[["","All papers"],...dois.map(v=>[v,v])],f.paper,v=>{f.paper=v;applyFilters();});
  }
}
async function updateStudy(){
  const current=++generation, a=study==="a";
  $("aas-modes").hidden = !a;
  $("blended-modes").hidden = a;
  showFindView();
  $("filter-heading").textContent = a ? "Find mixes" : "Filters";
  busy=true;rows=[];points=[];page=0;
  $("tab-a").setAttribute("aria-pressed",String(a));$("tab-b").setAttribute("aria-pressed",String(!a));
  $("kind").textContent=a?"Design space · GPR predictions":"Literature data · Measured strength";
  $("title").textContent=a?"Alkali-activated slag":"Blended cement";
  $("summary").textContent=a?"Explore the cost and carbon trade-offs of mixes that meet your strength target.":"Explore how measured compressive strength varies with binder composition across published studies.";
  $("plot-title").textContent=a?"Carbon and cost":"Binder fraction and strength";
  $("table-title").textContent=a?"Candidate mixes":"Reported measurements";
  $("compare").hidden=!a||!pins.length;
  $("fields").replaceChildren();$("metrics").replaceChildren();$("legend").replaceChildren();
  $("empty").textContent="Loading study data…";draw();renderTable();
  try{
    await load(a?"aas-"+filters.a.age:"literature");
    if(current!==generation)return;
    busy=false;buildFilters();applyFilters();
  }catch(error){if(current===generation)$("empty").textContent=error.message+". Use Reset to retry.";}
}
function applyFilters(){
  const f=filters[study],a=study==="a";
  if(a){
    rows=data.get("aas-"+f.age).filter(r=>r.strength>=f.target&&(f.wb===""||r.wb===Number(f.wb)));
    rows.sort((x,y)=>x.cost-y.cost||x.co2-y.co2||y.strength-x.strength);
  }else{
    rows=data.get("literature").filter(r=>{
      if((f.age!==""&&r.age!==f.age)||(f.paper&&f.paper!==r.doi)||fraction(r,f.scm)==null)return false;
      if(!f.wb)return true;
      if(r.wb==null)return false;
      if(f.wb==="low")return r.wb<0.4;
      return f.wb==="mid"?r.wb>=0.4&&r.wb<0.6:r.wb>=0.6;
    });
  }
  page=0;
  let minCost=Infinity,minCarbon=Infinity,sum=0;
  for(const r of rows){if(a){minCost=Math.min(minCost,r.cost);minCarbon=Math.min(minCarbon,r.co2);}sum+=r.strength;}
  const metrics=a?[["Qualifying mixes",count(rows.length)],["Lowest cost",rows.length?"$"+fmt(minCost,2)+" / t":"—"],["Lowest CO₂",rows.length?fmt(minCarbon)+" kg/t":"—"]]:
    [["Measurements",count(rows.length)],["Source papers",count(new Set(rows.map(r=>r.doi).filter(Boolean)).size)],["Mean strength",rows.length?fmt(sum/rows.length)+" MPa":"—"]];
  renderMetrics($("metrics"), metrics);
  $("legend").replaceChildren();
  if(a){const bar=el("span");bar.className="gradient";$("legend").append("Strength (MPa)   0",bar,"100+");}
  else $("legend").textContent=materials[f.scm]+" as % of total binder";
  $("empty").textContent=rows.length?"":"No results match these filters. Try another age or reset the filters.";
  $("plot-note").textContent=a?"Each point is a predicted mix. Select a point or table row to inspect the recipe.":"Each point is a reported measurement. Select one to inspect the mix and its source paper.";
  renderTable();draw();
}
function renderMetrics(container, metrics) {
  container.replaceChildren(...metrics.map(([label, value]) => {
    const item = el("div");
    item.className = "metric";
    item.append(el("span", label), el("strong", value));
    return item;
  }));
}

function showFindView() {
  $("performance-view").hidden = true;
  $("measure-mode").setAttribute("aria-pressed", "true");
  $("performance-mode").setAttribute("aria-pressed", "false");
  if (study === "b") {
    $("kind").textContent = "Literature data · Measured strength";
    $("summary").textContent = "Explore how measured compressive strength varies with binder composition across published studies.";
  }
  $("find-view").hidden = false;
  $("recipe-view").hidden = true;
  $("find-mode").setAttribute("aria-pressed", "true");
  $("recipe-mode").setAttribute("aria-pressed", "false");
  if (study === "a") $("summary").textContent = "Explore the cost and carbon trade-offs of mixes that meet your strength target.";
}

function adjustButton(record) {
  const button = el("button", "Adjust recipe");
  button.className = "slim";
  button.onclick = () => {
    if ($("detail").open) $("detail").close();
    openRecipe(record);
    $("recipe-mode").focus();
  };
  return button;
}
function niceAxis(min,max,fromZero){
  if(fromZero)min=0;
  if(min===max){const pad=Math.max(1,Math.abs(max)*0.05);min=fromZero?0:min-pad;max+=pad;}
  const raw=(max-min)/5, power=10**Math.floor(Math.log10(raw)), scale=raw/power;
  const step=(scale<=1?1:scale<=2?2:scale<=5?5:10)*power;
  const low=Math.floor(min/step)*step, high=Math.ceil(max/step)*step;
  return {low,high,step};
}
const palette=["#a8c76a","#82ba71","#59aa7f","#35978a","#187f86","#096a77","#125766","#164455","#14374e"];
function draw(){
  const c=$("plot"), w=c.clientWidth,h=c.clientHeight;
  if(!w||!h)return;
  const dpr=window.devicePixelRatio||1;c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);
  const ctx=c.getContext("2d");ctx.scale(dpr,dpr);points=[];
  if(!rows.length)return;
  const a=study==="a",left=60,right=w-23,top=20,bottom=h-52;
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  const coords=rows.map(r=>{const [x,y]=seriesValues(r);xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);return [x,y];});
  const X=niceAxis(xmin,xmax,!a),Y=niceAxis(ymin,ymax,!a);
  const px=x=>left+(x-X.low)/(X.high-X.low)*(right-left),py=y=>bottom-(y-Y.low)/(Y.high-Y.low)*(bottom-top);
  ctx.font='13px "Segoe UI", sans-serif';ctx.lineWidth=1;ctx.fillStyle="#52675e";ctx.strokeStyle="#e2e8e3";
  const ticks=(axis,callback)=>{for(let i=0;i<=Math.round((axis.high-axis.low)/axis.step);i++)callback(Number((axis.low+i*axis.step).toPrecision(10)));};
  ticks(X,v=>{const x=px(v);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.textAlign="center";ctx.fillText(String(v),x,bottom+19);});
  ticks(Y,v=>{const y=py(v);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign="right";ctx.fillText(String(v),left-7,y+4);});
  ctx.textAlign="center";ctx.fillStyle="#304c42";ctx.font='14px "Segoe UI", sans-serif';
  ctx.fillText(a?"Embodied CO₂ (kg per tonne of mix)":materials[filters.b.scm]+" (% of total binder)",(left+right)/2,h-8);
  ctx.save();ctx.translate(15,(top+bottom)/2);ctx.rotate(-Math.PI/2);ctx.fillText(a?"Cost (USD per tonne of mix)":"Measured strength (MPa)",0,0);ctx.restore();
  ctx.globalAlpha=a?0.68:0.52;
  coords.forEach(([x,y],i)=>{x=px(x);y=py(y);points.push({x,y,r:rows[i]});ctx.fillStyle=a?palette[Math.max(0,Math.min(8,Math.round(rows[i].strength/100*8)))]: "#167664";ctx.beginPath();ctx.arc(x,y,rows.length<80?4:2.7,0,Math.PI*2);ctx.fill();});
  ctx.globalAlpha=1;
}
function nearest(e){
  const box=$("plot").getBoundingClientRect(), x=e.clientX-box.left,y=e.clientY-box.top;
  let best=null,dist=81;for(const p of points){const value=(p.x-x)**2+(p.y-y)**2;if(value<=dist){dist=value;best=p.r;}}
  return best;
}
// Use a common MPa scale within each view, including the full whisker endpoints.
function strengthScale(records) {
  let low = 0, high = 0;
  for (const record of records) {
    if (!record) continue;
    low = Math.min(low, record.strength - record.sd);
    high = Math.max(high, record.strength + record.sd);
  }
  return {low: 10 * Math.floor(low / 10), high: Math.max(10, 10 * Math.ceil(high / 10))};
}

function strengthBar(record, scale) {
  const display = el("span");
  display.className = "strength-estimate";
  const {strength, sd} = record;
  display.append(el("span", fmt(strength) + " ± " + fmt(sd)));

  const track = el("span");
  track.className = "strength-track";
  track.setAttribute("aria-hidden", "true");
  const whisker = el("span");
  whisker.className = "strength-whisker";
  const width = scale.high - scale.low;
  whisker.style.left = (100 * (strength - sd - scale.low) / width) + "%";
  whisker.style.width = (200 * sd / width) + "%";
  const marker = el("span");
  marker.className = "strength-marker";
  marker.style.left = (100 * (strength - scale.low) / width) + "%";
  track.append(whisker, marker);
  display.append(track);
  display.title = "Predicted strength ± mean GPR predictive SD (MPa): " +
    fmt(strength - sd) + " to " + fmt(strength + sd);
  return display;
}

function strengthCaption(scale) {
  return "Dots show predicted strength. Bars span ±1 predictive standard deviation, averaged across ten GPR fits. Shared scale: " +
    scale.low + " to " + scale.high + " MPa.";
}
function renderTable(){
  const a=study==="a",headers=a?["Mix","Age (days)","Prediction ± SD (MPa)","CO₂ (kg/t)","Cost (USD/t)","Water/binder","Recipe"]:["Mix","Age (days)",materials[filters.b.scm]+" (%)","Strength (MPa)","Water/binder","Source DOI"];
  const head=el("tr");headers.forEach(h=>head.append(el("th",h)));$("thead").replaceChildren(head);
  const scale = a ? strengthScale(data.get("aas-"+filters.a.age) || []) : null;
  const caption = $("strength-note");
  caption.hidden = !a || busy || !rows.length;
  if (!caption.hidden) caption.textContent = strengthCaption(scale);
  const start=page*pageSize;
  const body=rows.slice(start,start+pageSize).map(r=>{
    const tr=el("tr"),td=el("td"),button=el("button",a?mixName(r):r.mix&&r.mix!=="null"?r.mix:"Record "+r.id);
    button.className="linkbtn";button.onclick=()=>inspect(r);td.append(button);tr.append(td);
    const values=a?[r.age,strengthBar(r,scale),fmt(r.co2),fmt(r.cost,2),fmt(r.wb,2)]:[r.age,fmt(fraction(r,filters.b.scm)),fmt(r.strength),fmt(r.wb,2),r.doi];
    for (const value of values) {
      const cell = el("td");
      cell.append(value);
      tr.append(cell);
    }
    if (a) {
      const action = el("td");
      action.append(adjustButton(r));
      tr.append(action);
    }
    return tr;
  });
  $("tbody").replaceChildren(...body);
  $("prev").disabled=page===0;$("next").disabled=start+pageSize>=rows.length;
  $("page-info").textContent=busy?"Loading…":rows.length?count(start+1)+"–"+count(Math.min(start+pageSize,rows.length))+" of "+count(rows.length):"0 results";
}
function openDetail(type,title){
  $("dialog-type").textContent=type;const body=$("detail-body");
  const heading=el("h2",title);heading.id="detail-title";body.replaceChildren(heading);
  if(!$("detail").open)$("detail").showModal();
  return body;
}
function details(pairs){
  const dl=el("dl");for(const [name,v] of pairs)dl.append(el("dt",name),el("dd",v));return dl;
}
function inspect(r){
  if(study==="a"){
    const body=openDetail("Predicted mix · "+r.age+" days",mixName(r));
    body.append(adjustButton(r));
    body.append(details([["Predicted strength",fmt(r.strength)+" MPa"],["Mean GPR predictive SD",fmt(r.sd)+" MPa"],["Embodied CO₂",fmt(r.co2)+" kg/t"],["Cost","$"+fmt(r.cost,2)+"/t"],["Water/binder",fmt(r.wb,2)],["Na₂O",fmt(r.na)],["Silicate modulus",fmt(r.ms,2)],["Slag reactivity",fmt(r.react,0)]]));
    body.append(el("h3","Ingredients per tonne"),details([["Slag",r.slag],["NaOH solution (50%)",r.naoh],["Silicate solution",r.silicate],["Extra silica",r.silica],["Added water",r.water],["Sodium metasilicate pentahydrate",r.penta]].map(([k,v])=>[k,fmt(v,2)+" kg"])));
    const key=recipeKey(r),index=pins.findIndex(p=>recipeKey(p)===key),btn=el("button");
    btn.textContent=index>=0?"Remove pinned recipe":pins.length===2?"Two recipes pinned":"Pin recipe for comparison";btn.className="slim";btn.disabled=index<0&&pins.length===2;
    btn.onclick=()=>{if(index>=0)pins.splice(index,1);else pins.push(r);updatePins();inspect(r);};body.append(btn);
    if(pins.length){const view=el("button","View comparison");view.className="text-btn";view.onclick=compare;body.append(view);}
  }else{
    const body=openDetail("Published measurement",r.mix&&r.mix!=="null"?"Mix "+r.mix:"Record "+r.id);
    body.append(details([["Curing age",r.age+" days"],["Measured strength",fmt(r.strength)+" MPa"],["Water/binder",fmt(r.wb,2)],["Curing temperature",r.temp==null?"Unreported":fmt(r.temp)+" °C"],["Relative humidity",r.humidity==null?"Unreported":fmt(r.humidity)+"%"]]));
    body.append(el("h3","Binder composition"),details(r.binder.map((v,i)=>[i===6&&r.other&&r.other!=="null"?r.other:materials[i],v==null?"Unreported":fmt(v,2)+" kg/m³"])));
    if(r.doi){const link=el("a","Source paper · "+r.doi);link.href="https://doi.org/"+r.doi;link.target="_blank";link.rel="noopener noreferrer";body.append(link);}
  }
}
function updatePins(){const btn=$("compare");btn.hidden=study!=="a"||!pins.length;btn.textContent="Compare pinned ("+pins.length+"/2)";}
async function compare(){
  const body=openDetail("Pinned recipes","Strength by curing age");const active=pins.slice();
  const loadingText=el("p","Loading predictions…");body.append(loadingText);
  try{
    const datasets=await Promise.all(ages.map(age=>load("aas-"+age)));
    if(!loadingText.isConnected)return;
    loadingText.remove();
    const predictions = datasets.map(dataset => active.map(recipe =>
      dataset.find(other => recipeKey(other) === recipeKey(recipe))));
    const scale = strengthScale(predictions.flat());
    body.append(el("p", strengthCaption(scale) + " A dash marks an age without a prediction."));
    const table = el("table"), head = el("tr");
    head.append(el("th","Age"));
    active.forEach(r => head.append(el("th",mixName(r))));
    table.append(head);
    predictions.forEach((records, i) => {
      const tr = el("tr");
      tr.append(el("td", ages[i] + " days"));
      for (const record of records) {
        const cell = el("td");
        cell.append(record ? strengthBar(record, scale) : "—");
        tr.append(cell);
      }
      table.append(tr);
    });
    body.append(table);
    for(const r of active){const btn=el("button","Unpin "+mixName(r));btn.className="text-btn";btn.onclick=()=>{pins.splice(pins.indexOf(r),1);updatePins();if(pins.length)compare();else $("detail").close();};body.append(btn);}
  }catch(error){loadingText.textContent=error.message;}
}
$("tab-a").onclick=()=>{study="a";updateStudy();};$("tab-b").onclick=()=>{study="b";updateStudy();};
$("reset").onclick=()=>{filters[study]=defaultFilters();updateStudy();};
$("prev").onclick=()=>{if(page>0){page--;renderTable();}};
$("next").onclick=()=>{if((page+1)*pageSize<rows.length){page++;renderTable();}};
$("plot").onclick=e=>{const r=nearest(e);if(r)inspect(r);};
$("plot").onmousemove=e=>{const r=nearest(e);$("plot").style.cursor=r?"pointer":"default";$("plot").title=r?(study==="a"?mixName(r):r.mix)+" · "+fmt(r.strength)+" MPa":"";};
$("close").onclick=()=>$("detail").close();$("compare").onclick=compare;
new ResizeObserver(draw).observe($("plot").parentElement);
updateStudy();
