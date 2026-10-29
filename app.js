(function(){
'use strict';
var prefs=window.appPrefs.p;
var $=function(s){return document.querySelector(s)};
/* Todos los importes de la app van en céntimos enteros. Solo se pasan a euros al mostrarlos (fmt) o al escribirlos en un campo (inStr). */
var Calc=window.Calc;
function fmt(c){return Calc.formatEUR(c)}
function inStr(c){return Calc.toInputString(c)}
function rc(n){return Math.round(n)}
function amountOf(v){return Calc.parseAmount(v)}
/* Explica por qué no vale un importe de gasto. */
function amountMsg(raw,amt){
  var s=String(raw||'').trim();
  if(!s)return 'Escribe el importe, por ejemplo 7,50.';
  if(s.charAt(0)==='-')return 'El importe no puede ser negativo.';
  if(amt===0)return 'El importe tiene que ser mayor que 0.';
  if(amt!=null&&amt>MAXEXP)return 'Como mucho '+fmt(MAXEXP)+' por gasto.';
  return 'No entiendo ese importe. Escríbelo así: 7,50.';
}
function pad(n){return String(n).padStart(2,'0')}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function uid8(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function dstr(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}

var now=new Date();
var nowYM=now.getFullYear()+'-'+pad(now.getMonth()+1);
var todayStr=dstr(now);

var MAXX=6,MAXG=5,MAXF=30,TAXR=0.19;
/* Topes en céntimos: un gasto hasta 9.999 €, el reparto hasta 99.999 € y el ahorro hasta 9.999.999 €. */
var MAXEXP=999900,MAXALLOC=9999900,MAXSAVE=999999900;
var BASE=[
  {id:'nec',name:'Necesarios',edit:true,verb:'gastado',spend:true,desc:'Transporte, móvil, material de clase.'},
  {id:'oci',name:'Ocio',verb:'gastado',spend:true,desc:'Salidas, cafés, caprichos.'},
  {id:'pro',name:'Proyectos',edit:true,verb:'gastado',spend:true,desc:'Dominio, herramientas y material para ganar dinero.'}
];
var AHO={id:'aho',name:'Ahorro',verb:'apartado',spend:false,desc:'Colchón para imprevistos. Se aparta el día 1.'};
var CATS=[],CAT={};
function rebuildCats(){
  CATS=BASE.concat(state.extras.map(function(x){
    return {id:x.id,name:'Sección',edit:true,extra:true,ci:x.ci,verb:'gastado',spend:true,desc:'Sección personalizada.'};
  }),[AHO]);
  CAT={};CATS.forEach(function(c){CAT[c.id]=c});
}
function cname(id){return (state.names&&state.names[id])||(CAT[id]?CAT[id].name:'Sección')}
function cv(id){var c=CAT[id];return 'var(--c-'+(c&&c.extra?'x'+c.ci:id)+')'}
function spendIds(){return CATS.filter(function(c){return c.spend}).map(function(c){return c.id})}
function allocSum(){var t=0;CATS.forEach(function(c){t+=state.alloc[c.id]||0});return rc(t)}

var DEMO=[[2,'aho',2000,'Aportación al colchón'],[2,'nec',1500,'Recarga del bus'],[3,'nec',650,'Fotocopias de clase'],[5,'oci',900,'Cine'],[9,'oci',750,'Cafés'],[12,'nec',1000,'Recarga del móvil'],[14,'oci',800,'Cena con amigos'],[16,'pro',890,'Dominio web']].map(function(r,i){
  return {id:'demo'+i,cat:r[1],amt:r[2],note:r[3],date:nowYM+'-'+pad(Math.min(r[0],now.getDate()))};
});

var state={names:{},extras:[],goals:[],fixed:[],fixedDone:{},fixEdit:null,lastCat:null,qcat:null,goalAdd:null,goalDel:null,delAsk:null,editing:null,adding:false,confirmDel:null,alert:null,fired:{},showAll:false,tab:'money',chat:[],asking:false,total:10000,alloc:{nec:4500,oci:2500,pro:1000,aho:2000},rate:2,months:36,saved0:0,goal:0,tax:true,ym:nowYM,cache:{},demo:false,loaded:true,mode:'local',pending:0,error:false,undo:null};
rebuildCats();

/* ---------- datos ---------- */
function list(){return (state.demo&&state.ym===nowYM)?DEMO:(state.cache[state.ym]||[])}
function sums(L){var s={};CATS.forEach(function(c){s[c.id]=0});L.forEach(function(e){if(s[e.cat]!=null)s[e.cat]=rc(s[e.cat]+e.amt)});return s}
function validExp(e){return e&&typeof e.id==='string'&&CAT[e.cat]&&Number.isInteger(e.amt)&&e.amt>0&&e.amt<=MAXEXP&&/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')}
/* Números que no son dinero (TAE en %, meses): se aceptan con coma o punto. */
function parsePlain(v){var n=parseFloat(String(v).trim().replace(',','.'));return isFinite(n)&&n>=0?n:null}

/* ---------- persistencia (en este dispositivo) ---------- */
/* El dinero (plan y meses) vive en «presupuesto:v2:», en céntimos. Lo demás (ajustes, avisos, copias) sigue en «presupuesto:v1:».
   Las claves «presupuesto:v1:plan» y «presupuesto:v1:m-…» del formato antiguo no se tocan: son la copia del original. */
var KEY='presupuesto:v1:',DKEY='presupuesto:v2:',storageOK=true,saveLocked=false;
function num(x){return typeof x==='number'&&isFinite(x)}
function cents(x){return Number.isInteger(x)}
function keyFor(k){return (k==='plan'||k.indexOf('m-')===0||k==='meta')?DKEY+k:KEY+k}
function lsGet(k){
  var mem=saveLocked&&migration.memory;
  if(mem&&keyFor(k).indexOf(DKEY)===0){
    if(k==='plan')return mem.plan?JSON.stringify(mem.plan):null;
    if(k.indexOf('m-')===0)return mem.months[k.slice(2)]?JSON.stringify(mem.months[k.slice(2)]):null;
    return null;
  }
  try{return window.localStorage.getItem(keyFor(k))}catch(e){storageOK=false;return null}
}
function lsSet(k,v){
  if(saveLocked&&keyFor(k).indexOf(DKEY)===0)return false;
  try{window.localStorage.setItem(keyFor(k),v);return true}catch(e){storageOK=false;return false}
}
function nextCi(){
  var used={};state.extras.forEach(function(x){used[x.ci]=1});
  for(var i=1;i<=6;i++)if(!used[i])return i;
  return 1+(state.extras.length%6);
}
function planObj(){
  var al={};CATS.forEach(function(c){al[c.id]=state.alloc[c.id]||0});
  return {schemaVersion:Calc.SCHEMA,total:state.total,alloc:al,rate:state.rate,months:state.months,saved0:state.saved0,goal:state.goal,tax:state.tax,names:state.names,
    extras:state.extras.map(function(x){return {id:x.id,ci:x.ci}}),
    goals:state.goals.map(function(g){return {id:g.id,name:g.name,target:g.target,saved:g.saved}}),
    fixed:state.fixed.map(function(f){return {id:f.id,cat:f.cat,amt:f.amt,note:f.note,day:f.day}}),
    lastCat:state.lastCat};
}
function applyPlan(d){
  if(!d||typeof d!=='object')return;
  if(Array.isArray(d.extras)){
    var ex=[];
    d.extras.forEach(function(x){
      if(x&&typeof x.id==='string'&&/^x[a-z0-9]{3,12}$/.test(x.id)&&ex.length<MAXX&&!ex.some(function(y){return y.id===x.id}))
        ex.push({id:x.id,ci:(x.ci>=1&&x.ci<=6)?Math.floor(x.ci):1});
    });
    state.extras=ex;rebuildCats();
  }
  var a=d.alloc||{};
  if(d.names&&typeof d.names==='object'){
    CATS.forEach(function(c){
      if(!c.edit)return;
      var v=d.names[c.id];
      if(typeof v==='string'){v=v.trim().slice(0,24);if(v)state.names[c.id]=v;else delete state.names[c.id]}
    });
  }
  CATS.forEach(function(c){if(cents(a[c.id])&&a[c.id]>=0&&a[c.id]<=MAXALLOC)state.alloc[c.id]=a[c.id]});
  if(cents(d.total)&&d.total>0&&d.total<=MAXALLOC)state.total=d.total;
  if(num(d.rate)&&d.rate>=0&&d.rate<=30)state.rate=d.rate;
  if(num(d.months)&&d.months>=1&&d.months<=120)state.months=Math.round(d.months);
  if(cents(d.saved0)&&d.saved0>=0&&d.saved0<=MAXSAVE)state.saved0=d.saved0;
  if(cents(d.goal)&&d.goal>=0&&d.goal<=MAXSAVE)state.goal=d.goal;
  if(typeof d.tax==='boolean')state.tax=d.tax;
  /* Los planes guardados antes de existir los objetivos no traen "goals": se quedan con la lista vacía. */
  if(Array.isArray(d.goals)){
    var gs=[];
    d.goals.forEach(function(g){
      if(!g||typeof g.id!=='string'||!/^g[a-z0-9]{3,16}$/.test(g.id)||gs.length>=MAXG||gs.some(function(y){return y.id===g.id}))return;
      var nm=typeof g.name==='string'?g.name.trim().slice(0,40):'';
      if(!nm||!cents(g.target)||!(g.target>0)||g.target>MAXSAVE)return;
      gs.push({id:g.id,name:nm,target:g.target,saved:(cents(g.saved)&&g.saved>=0&&g.saved<=MAXSAVE)?g.saved:0});
    });
    state.goals=gs;
  }
  /* Igual con los gastos fijos y la última sección usada: si no vienen, se quedan en su valor por defecto. */
  if(Array.isArray(d.fixed)){
    var fs=[];
    d.fixed.forEach(function(f){
      if(!f||typeof f.id!=='string'||!/^f[a-z0-9]{3,16}$/.test(f.id)||fs.length>=MAXF||fs.some(function(y){return y.id===f.id}))return;
      if(!cents(f.amt)||!(f.amt>0)||f.amt>MAXEXP)return;
      fs.push({id:f.id,cat:CAT[f.cat]?f.cat:'nec',amt:f.amt,note:typeof f.note==='string'?f.note.trim().slice(0,60):'',
        day:(num(f.day)&&f.day>=1&&f.day<=31)?Math.floor(f.day):1});
    });
    state.fixed=fs;
  }
  if(typeof d.lastCat==='string'&&CAT[d.lastCat])state.lastCat=d.lastCat;
}
/* Si un gasto apunta a una partida propia que ya no está en el plan, se recupera en vez de perderlo. */
function adoptCats(arr){
  var ch=false;
  (arr||[]).forEach(function(e){
    if(e&&typeof e.cat==='string'&&!CAT[e.cat]&&/^x[a-z0-9]{3,12}$/.test(e.cat)){
      state.extras.push({id:e.cat,ci:nextCi()});state.names[e.cat]='Sección recuperada';state.alloc[e.cat]=0;rebuildCats();ch=true;
    }
  });
  if(ch)savePlan();
}
function loadPlan(){
  var raw=lsGet('plan');if(!raw)return;
  try{applyPlan(JSON.parse(raw))}catch(e){}
}
function loadMonth(ym){
  if(ym in state.cache)return;
  var raw=lsGet('m-'+ym),l=[];
  try{
    var d=raw?JSON.parse(raw):null;
    if(d&&Array.isArray(d.expenses)){adoptCats(d.expenses);l=d.expenses.filter(validExp)}
    if(d&&Array.isArray(d.fixedDone))state.fixedDone[ym]=d.fixedDone.filter(function(x){return typeof x==='string'});
  }catch(e){}
  state.cache[ym]=l;
}
/* Gastos fijos: al abrir la app en un mes nuevo se apuntan solos. «fixedDone» recuerda los que ya se apuntaron ese mes,
   para no volver a ponerlos si el usuario borró el de este mes. */
function applyFixed(ym){
  loadMonth(ym);
  var L=state.cache[ym],done=state.fixedDone[ym]=state.fixedDone[ym]||[],p=ym.split('-').map(Number),dim=new Date(p[0],p[1],0).getDate(),n=0;
  state.fixed.forEach(function(f){
    if(done.indexOf(f.id)>=0||L.some(function(e){return e.fixed===f.id}))return;
    L.push({id:uid8(),cat:CAT[f.cat]?f.cat:'nec',amt:f.amt,note:f.note,date:ym+'-'+pad(Math.min(f.day,dim)),fixed:f.id});
    done.push(f.id);n++;
  });
  if(n)saveMonth(ym);
  return n;
}
function savePlan(){
  lsSet('plan',JSON.stringify(planObj()));
  renderStatus();
}
function saveMonth(ym){
  var l=(state.cache[ym]||[]).map(function(e){
    var o={id:e.id,cat:e.cat,amt:e.amt,note:e.note||'',date:e.date};
    if(e.fixed)o.fixed=e.fixed;
    return o;
  });
  var d={schemaVersion:Calc.SCHEMA,expenses:l};
  if(state.fixedDone[ym]&&state.fixedDone[ym].length)d.fixedDone=state.fixedDone[ym];
  lsSet('m-'+ym,JSON.stringify(d));
  renderStatus();
}
function allMonthKeys(){
  var yms={};
  Object.keys(state.cache).forEach(function(ym){yms[ym]=1});
  if(saveLocked&&migration.memory)Object.keys(migration.memory.months).forEach(function(ym){yms[ym]=1});
  try{
    for(var i=0;i<window.localStorage.length;i++){
      var k=window.localStorage.key(i);
      if(k&&k.indexOf(DKEY+'m-')===0)yms[k.slice(DKEY.length+2)]=1;
    }
  }catch(e){}
  return Object.keys(yms).filter(function(ym){return /^\d{4}-\d{2}$/.test(ym)});
}
/* Copia de seguridad en JSON: formato actual (céntimos) con su versión. */
function exportAll(){
  var out={app:'presupuesto-mensual',schemaVersion:Calc.SCHEMA,exportedAt:new Date().toISOString(),plan:planObj(),months:{}};
  allMonthKeys().forEach(function(ym){
    loadMonth(ym);
    if(state.cache[ym].length)out.months[ym]={expenses:state.cache[ym],fixedDone:state.fixedDone[ym]||[]};
  });
  return out;
}
/* Importa una copia (texto JSON). Devuelve {ok,months,expenses,skipped} o {ok:false,error}. Antes de tocar nada lo valida todo. */
function importAll(text){
  var d;try{d=JSON.parse(text)}catch(e){return {ok:false,error:'El archivo no es un JSON válido.'}}
  var r=Calc.readBackup(d);
  if(!r.ok)return r;
  var st=r.store;
  if(st.plan)applyPlan(st.plan);
  savePlan();
  Object.keys(st.months).forEach(function(ym){
    var m=st.months[ym];
    adoptCats(m.expenses);
    state.cache[ym]=m.expenses.filter(validExp).map(function(e){
      var o={id:e.id,cat:e.cat,amt:e.amt,note:String(e.note||'').slice(0,60),date:e.date};
      if(typeof e.fixed==='string')o.fixed=e.fixed;
      return o;
    });
    if(Array.isArray(m.fixedDone))state.fixedDone[ym]=m.fixedDone.filter(function(x){return typeof x==='string'});
    saveMonth(ym);resetFired(ym);
  });
  applyFixed(nowYM);
  state.demo=false;state.editing=null;state.confirmDel=null;
  renderSettings();getFired(nowYM);renderAll();
  return r;
}

function importSummary(r){
  return 'Copia importada: '+plural(r.months,'mes','meses')+' y '+plural(r.expenses,'gasto','gastos')+'.'+
    (r.skipped?' Se descartaron '+plural(r.skipped,'dato dañado','datos dañados')+'.':'');
}

/* ---------- migración del formato guardado ----------
   Se ejecuta al abrir, antes de leer nada. Si hay datos del formato antiguo (v1, en euros) y aún no del nuevo:
   1) los lee tal cual, 2) los convierte con Calc.migrateStore, 3) comprueba que no se pierde nada,
   4) escribe el formato nuevo, 5) lo vuelve a leer y compara. Si algo falla, borra solo lo nuevo que haya escrito,
   deja intacto el original y la app funciona sin guardar (saveLocked) avisando al usuario. */
var migration={status:'none'};
function rawGet(k){try{return window.localStorage.getItem(k)}catch(e){return null}}
function v1Keys(){
  var ks=[];
  try{for(var i=0;i<window.localStorage.length;i++){var k=window.localStorage.key(i);if(k===KEY+'plan'||(k&&k.indexOf(KEY+'m-')===0))ks.push(k)}}catch(e){}
  return ks;
}
function runMigration(){
  var meta=null;try{meta=JSON.parse(rawGet(DKEY+'meta')||'null')}catch(e){}
  if(meta&&meta.schemaVersion===Calc.SCHEMA){migration={status:'ok',meta:meta};return}
  var keys=v1Keys();
  if(!keys.length){lsSet('meta',JSON.stringify({schemaVersion:Calc.SCHEMA,createdAt:Date.now()}));migration={status:'new'};return}
  var before={schemaVersion:1,plan:null,months:{}},written=[],after=null;
  try{
    keys.forEach(function(k){
      var v=JSON.parse(rawGet(k));
      if(k===KEY+'plan')before.plan=v;else before.months[k.slice(KEY.length+2)]=v&&typeof v==='object'?v:{expenses:[]};
    });
    var conv=Calc.migrateStore(before),errs=Calc.verifyMigration(before,conv);
    if(errs.length)throw new Error(errs.join('; '));
    after=conv;
    if(after.plan){window.localStorage.setItem(DKEY+'plan',JSON.stringify(after.plan));written.push(DKEY+'plan')}
    Object.keys(after.months).forEach(function(ym){window.localStorage.setItem(DKEY+'m-'+ym,JSON.stringify(after.months[ym]));written.push(DKEY+'m-'+ym)});
    var back={schemaVersion:2,plan:after.plan?JSON.parse(rawGet(DKEY+'plan')):null,months:{}};
    Object.keys(after.months).forEach(function(ym){back.months[ym]=JSON.parse(rawGet(DKEY+'m-'+ym))});
    if(JSON.stringify(back)!==JSON.stringify(after))throw new Error('lo guardado no coincide con lo convertido');
    meta={schemaVersion:Calc.SCHEMA,migratedFrom:1,migratedAt:Date.now(),originalKeys:keys};
    window.localStorage.setItem(DKEY+'meta',JSON.stringify(meta));
    migration={status:'migrated',meta:meta};
  }catch(e){
    written.forEach(function(k){try{window.localStorage.removeItem(k)}catch(x){}});
    /* Si la conversión salió bien pero no se pudo guardar, la app trabaja con ella en memoria (sin guardar). */
    saveLocked=true;migration={status:'error',error:String(e&&e.message||e),keys:keys,memory:after};
  }
}
/* Copia literal de los datos antiguos, por si el usuario quiere guardarla antes de borrarla. */
function originalRaw(){
  var out={};(migration.meta&&migration.meta.originalKeys||migration.keys||v1Keys()).forEach(function(k){var v=rawGet(k);if(v!=null)out[k]=v});
  return {app:'presupuesto-mensual',kind:'raw',exportedAt:new Date().toISOString(),raw:out};
}

/* ---------- vistas ---------- */
function monthName(ym){
  var p=ym.split('-').map(Number);
  return new Date(p[0],p[1]-1,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
}
function renderStatus(){
  var el=$('#status'),t,c;
  if(saveLocked){t='Los cambios no se están guardando: mira el aviso de abajo';c='bad'}
  else if(!storageOK){t='Este navegador no permite guardar: los datos se pierden al cerrar';c='bad'}
  else{t='Guardado en este dispositivo';c='ok'}
  el.className='status '+c;el.querySelector('span').textContent=t;
}
function renderHeader(){
  $('.monthnav').hidden=(state.tab!=='money');
  $('#monthLabel').textContent=monthName(state.ym);
  $('#today').hidden=(state.ym===nowYM);
  $('#banner').hidden=!(state.demo&&state.ym===nowYM);
  $('#movesTitle').textContent='Movimientos de '+monthName(state.ym);
}
function renderSummary(){
  var L=list(),s=sums(L),A=state.alloc,ids=spendIds();
  var gastable=0,gastado=0;
  ids.forEach(function(id){gastable+=A[id]||0;gastado+=s[id]});
  gastable=rc(gastable);gastado=rc(gastado);
  var left=rc(gastable-gastado),over=left<0;
  var segs=ids.map(function(k){
    var w=gastable>0?Math.min(100,s[k]/gastable*100):0;
    return '<span class="seg" style="width:'+w+'%;background:'+cv(k)+'"></span>';
  }).join('');
  var leg=ids.map(function(k){
    return '<span><i style="background:'+cv(k)+'"></i>'+esc(cname(k))+' '+fmt(s[k])+'</span>';
  }).join('');
  var p=state.ym.split('-').map(Number),dim=Calc.daysInMonth(p[0],p[1]),pace='',head,sub,eyebrow='Para gastar en '+monthName(state.ym);
  if(state.ym===nowYM){
    var expected=A.oci*(now.getDate()/dim),cap=Calc.ocioWeeklyCap(A.oci,dim);
    var mon=new Date(now);mon.setDate(now.getDate()-((now.getDay()+6)%7));
    var ms=dstr(mon),wk=0;
    L.forEach(function(e){if(e.cat==='oci'&&e.date>=ms&&e.date<=todayStr)wk=rc(wk+e.amt)});
    var pill;
    if(s.oci>A.oci)pill='<span class="pill bad">Ocio: '+fmt(rc(s.oci-A.oci))+' por encima</span>';
    else if(s.oci>expected+100)pill='<span class="pill warn">Ocio por delante del ritmo</span>';
    else pill='<span class="pill ok">Ocio en ritmo</span>';
    pace=pill+'<p>Ocio '+fmt(s.oci)+' de '+fmt(A.oci)+' · tope semanal '+fmt(cap)+' (esta semana '+fmt(wk)+')</p>';
    /* Lo de esta semana (de lunes a domingo, sin salirse del mes): lo que quedaba al empezar la semana,
       repartido por días entre lo que falta de mes, menos lo ya gastado esta semana. */
    var wk7=Calc.weekWindow(now.getDate(),now.getDay(),dim),d0=wk7.d0,d1=wk7.d1;
    var ws=state.ym+'-'+pad(d0),we=state.ym+'-'+pad(d1),sem=0;
    L.forEach(function(e){if(e.date>=ws&&e.date<=we&&CAT[e.cat]&&CAT[e.cat].spend)sem+=e.amt});
    var can=Calc.weekBudget(left,sem,d0,d1,dim).can;
    var mo=now.toLocaleDateString('es-ES',{month:'long'}),lastWeek=d1===dim;
    eyebrow='Semana del '+d0+' al '+d1+' de '+mo;
    var hasta=lastWeek?'hasta fin de mes (día '+dim+')':'hasta el domingo '+d1;
    if(over){
      head='<span class="lbl">Vas</span> '+fmt(-left)+' <span class="lbl">por encima</span>';
      sub='de los '+fmt(gastable)+' para gastar este mes. No pasa nada: abajo tienes ideas para compensarlo.';
    }else if(can>0){
      head='<span class="lbl">Puedes gastar</span> '+fmt(can)+' <span class="lbl">esta semana</span>';
      sub='Es tu margen '+hasta+(sem>0?' · esta semana llevas '+fmt(sem):'')+'.'+(lastWeek?'':' Para todo el mes te quedan '+fmt(left)+'.');
    }else if(left>0){
      head='<span class="lbl">Esta semana ya has gastado</span> lo previsto';
      sub='Llevas '+fmt(sem)+' esta semana'+(can<0?', '+fmt(-can)+' más de lo previsto':'')+'. '+(lastWeek?'Lo que no gastes irá al mes que viene.':'La semana que viene tendrás unos '+fmt(Math.floor(left*Math.min(7,dim-d1)/(dim-d1)))+'.');
    }else{
      head='<span class="lbl">Esta semana puedes gastar</span> '+fmt(0);
      sub='Ya has gastado todo el dinero para gastar de este mes.';
    }
  }else if(state.ym<nowYM){
    pace='<span class="pill neutral">Mes cerrado</span><p>Del ocio sobraron '+fmt(Math.max(0,rc(A.oci-s.oci)))+' (al colchón)</p>';
    head=over?'<span class="lbl">Gastaste</span> '+fmt(-left)+' <span class="lbl">de más</span>':'<span class="lbl">Te sobraron</span> '+fmt(left);
    sub='de '+fmt(gastable)+' para gastar · '+fmt(A.aho)+' al ahorro.';
  }else{
    pace='<span class="pill neutral">Mes futuro</span><p>Aún no hay gastos.</p>';
    head='<span class="lbl">Tendrás</span> '+fmt(left)+' <span class="lbl">para gastar</span>';
    sub=fmt(A.aho)+' irán al ahorro.';
  }
  var pct=gastable>0?gastado/gastable*100:(gastado>0?100:0);
  $('#sumEyebrow').textContent=eyebrow;$('#summary').removeAttribute('aria-busy');
  $('#summary').innerHTML=
    '<p class="big'+(over?' bad':'')+'">'+head+'</p>'+
    '<p class="sub">'+sub+'</p>'+
    '<div class="stack" role="img" aria-label="Gastado '+fmt(gastado)+' de '+fmt(gastable)+'">'+segs+'<i class="tick" style="left:50%"></i><i class="tick" style="left:75%"></i></div>'+
    '<div class="scale" aria-hidden="true"><span style="left:50%">50 %</span><span style="left:75%">75 %</span></div>'+
    '<div class="legend">'+leg+'</div>'+
    '<p class="fine lvl">Gastado: '+Math.round(pct)+' %'+(pct>=100?' · límite '+(left<0?'superado':'alcanzado'):pct>=75?' · ojo, queda poco':pct>=50?' · vas por la mitad':'')+'</p>'+
    '<div class="pace">'+pace+'</div>';
}
var CICO={nec:'🧾',oci:'🎉',pro:'🚀',aho:'🐷'};
/* Icono según el nombre de la sección: la primera palabra clave que encaje gana, así que lo más concreto va antes
   (por ejemplo «amazon music» antes que «prime video» y este antes que «amazon» a secas). */
var NICO=[
  /* plataformas y entretenimiento digital */
  ['🎵',['musica','spotify','apple music','amazon music','youtube music','tidal','deezer','soundcloud','concierto']],
  ['📺',['serie','pelicula','peli','streaming','plataforma','netflix','hbo','max','disney','prime video','amazon prime','filmin','movistar plus','movistar+',
    'skyshowtime','sky showtime','apple tv','atresplayer','atres player','rakuten','dazn','crunchyroll','mubi','pluto','paramount','flixole','rtve play',
    'mitele','youtube','twitch','tivify','lovestv','fubo','hulu','peacock','acorn','starzplay','lionsgate','television']],
  ['🎮',['juego','videojuego','gaming','playstation','ps plus','ps5','xbox','game pass','nintendo','switch','consola','steam','epic','fortnite','roblox','twitch drops']],
  ['🤖',['chatgpt','openai','claude','gemini','copilot','midjourney','inteligencia artificial']],
  ['☁️',['icloud','google one','dropbox','onedrive','nube','almacenamiento']],
  ['🔁',['suscripci','membresia','cuota mensual']],
  /* deporte y cuidado personal */
  ['🧘',['yoga','pilates','meditacion','mindfulness']],['🏊',['piscina','natacion','nadar']],
  ['🏋️',['gym','gimnasio','deporte','crossfit','fitness','pesas','entreno','basic fit','basic-fit','mcfit','altafit','vivagym','anytime']],
  ['⚽',['futbol','padel','tenis','baloncesto','basket','voley','rugby','boxeo','escalada','running','correr']],['⛷️',['esqui','snow','nieve']],
  ['💇',['peluqueria','barberia','barbero','belleza','estetica','maquillaje','cosmetic','unas','manicura','pedicura','depilacion','perfume']],
  ['👓',['gafas','optica','lentillas']],['💊',['salud','medic','farmacia','dentista','psicolog','fisio','hospital','seguro medico','sanitas','adeslas']],
  /* personas */
  ['💍',['boda','bodas','anillo']],['❤️',['mujer','marido','novia','novio','pareja','amor','esposa','esposo','cita','san valentin']],
  ['🧸',['hijo','hija','bebe','nino','nina','peque','guarderia','juguete','panal']],['👨‍👩‍👧',['familia','padres','madre','padre','abuel','hermano','hermana']],
  ['🐾',['mascota','perro','gato','veterinario','pienso']],
  /* comida y bebida */
  ['🍕',['pizza','telepizza','dominos']],['🍔',['hamburguesa','burger','mcdonald','kfc','comida rapida','fast food']],['🍣',['sushi','japones']],
  ['🛵',['uber eats','just eat','glovo','delivery','a domicilio']],
  ['🛒',['super','mercadona','lidl','carrefour','aldi','alcampo','eroski','consum','hipercor','compra','comida','alimenta']],
  ['🍽️',['restaurante','cena','comer fuera','menu','tapas']],['☕',['cafe','desayuno','starbucks','merienda']],
  ['🍷',['vino','bodega']],['🍻',['fiesta','copas','bar','bares','cerveza','salir','discoteca','botellon']],
  ['🚬',['tabaco','vaper','vapeo','cigarro']],['🎰',['apuesta','loteria','casino','quiniela']],
  /* casa */
  ['🛋️',['mueble','ikea','decoracion','sofa']],['🔧',['reparacion','arreglo','bricolaje','leroy','ferreteria','fontanero']],
  ['🧹',['limpieza','drogueria','asistenta']],['🌱',['planta','jardin','huerto']],['💐',['flores','floristeria']],
  ['🏠',['casa','alquiler','hogar','piso','hipoteca','comunidad','habitacion']],['💡',['luz','electricidad','agua','butano','factura','suministro','calefaccion']],
  ['📱',['movil','telefono','internet','fibra','tarifa','vodafone','orange','movistar','yoigo','pepephone','lowi','simyo']],
  /* moverse y viajar */
  ['🚕',['taxi','uber','cabify','bolt','freenow']],['🚆',['renfe','ouigo','iryo','cercanias']],
  ['🚌',['transporte','bus','autobus','metro','tren','abono','alsa','tranvia']],
  ['⛽',['gasolina','gasoil','diesel','combustible','repsol','cepsa']],['🚗',['coche','parking','aparcamiento','taller','itv','peaje']],
  ['🏍️',['moto']],['🚲',['bici','patinete']],
  ['🏖️',['playa','verano']],['🏕️',['camping','excursion','acampada','senderismo']],
  ['✈️',['viaje','vacacion','vuelo','avion','hotel','escapada','ryanair','vueling','airbnb','booking']],
  /* compras y ocio */
  ['📦',['amazon','aliexpress','shein','temu','wallapop','vinted','envio','paquete']],
  ['👕',['ropa','zapatilla','calzado','moda','zara','primark','pull','bershka','mango']],
  ['🎬',['cine','teatro','espectaculo','entrada','musical']],['🎟️',['festival','evento','feria']],
  ['🎸',['guitarra','piano','instrumento','bateria']],['📷',['foto','camara']],['🎨',['arte','pintura','manualidad','dibujo','hobby','aficion']],
  ['📖',['libro','comic','manga','kindle','audible','revista','periodico','prensa']],
  ['📚',['estudio','clase','universidad','matricula','curso','academia','colegio','instituto','master','idioma','ingles','autoescuela','carnet']],
  ['🎁',['regalo','cumple','navidad','reyes','amigo invisible']],
  /* dinero */
  ['🧾',['impuesto','hacienda','irpf','autonomo','gestoria','multa']],['🏦',['banco','comision']],
  ['🐷',['hucha','colchon','emergencia','imprevisto']],
  ['💳',['deuda','prestamo','tarjeta','credito','plazo','financiacion','klarna']],['📈',['inversion','invertir','bolsa','cripto','bitcoin','fondo','indexado','etf']],
  ['🛡️',['seguro']],['🤝',['donacion','ong','solidari','cruz roja']],['💼',['trabajo','negocio','empresa','freelance']],
  ['💻',['ordenador','portatil','tecnologia','software','dominio','web','hosting','app']]
].map(function(e){return {i:e[0],re:e[1].map(kwRegex)}});
function nameIcon(name,fallback){
  var n=norm(name);
  for(var j=0;j<NICO.length;j++)if(NICO[j].re.some(function(r){return r.test(n)}))return NICO[j].i;
  return fallback;
}
function catIcon(c){
  return c.edit?nameIcon(cname(c.id),CICO[c.id]||'📌'):CICO[c.id];
}
function renderCats(){
  var s=sums(list()),A=state.alloc;
  var html=CATS.map(function(c){
    var sp=s[c.id],al=A[c.id]||0,pct=al>0?sp/al:(sp>0?1:0),rem=rc(al-sp),msg,cls='';
    if(c.spend){if(rem<0){msg=fmt(-rem)+' por encima de lo previsto';cls='over'}else msg='Quedan '+fmt(rem)}
    else{if(rem<=0){msg='Completo';cls='done'}else msg='Faltan '+fmt(rem)+' por apartar'}
    var nm=cname(c.id);
    var title=!c.edit?esc(nm):(state.editing===c.id
      ?'<input class="nameinput" id="nameInput" data-cat="'+c.id+'" maxlength="24" value="'+esc(nm)+'" aria-label="Nombre de la sección">'
      :'<button class="namebtn" type="button" data-edit="'+c.id+'" aria-label="Cambiar el nombre de la sección '+esc(nm)+'">'+esc(nm)+' <span aria-hidden="true">✎</span></button>');
    var rm=(c.extra&&state.editing!==c.id&&state.confirmDel!==c.id)
      ?'<button class="rm" type="button" data-rm="'+c.id+'" aria-label="Quitar la sección '+esc(nm)+'">Quitar</button>':'';
    var body;
    if(state.confirmDel===c.id){
      body='<p class="desc">¿Quitar «'+esc(nm)+'»? Sus gastos y sus '+fmt(al)+' pasarán a «'+esc(cname('nec'))+'».</p>'+
        '<div class="btnrow"><button class="btn" type="button" data-rmyes="'+c.id+'">Sí, quitar</button><button class="btn" type="button" data-rmno="1">Cancelar</button></div>';
    }else{
      body='<p class="nums"><strong>'+fmt(sp)+'</strong> '+c.verb+' de '+fmt(al)+'</p>'+
        '<div class="bar"><span style="width:'+Math.min(pct,1)*100+'%"></span></div>'+
        '<p class="rem '+cls+'">'+msg+'</p>'+
        (c.id==='aho'?'<button class="linkbtn" type="button" data-go="save">Ver cuánto crecerá →</button>':'');
    }
    return '<article class="cat'+(cls==='over'?' isover':'')+'" style="--cc:'+cv(c.id)+'"><header><span class="cico" aria-hidden="true">'+catIcon(c)+'</span><h3>'+title+'</h3>'+rm+'</header>'+body+'</article>';
  }).join('');
  if(state.extras.length<MAXX)html+='<button class="cat add" type="button" id="addCatBtn"><span aria-hidden="true">＋</span> Añadir sección</button>';
  $('#cats').innerHTML=html;
  if(state.editing){var inp=$('#nameInput');if(inp){inp.focus();inp.select()}}
  renderCompensa(s);
}
/* Si una sección se pasa, propone recortar el resto en proporción a lo que le queda a cada una.
   El ahorro no entra salvo que se desproteja en Ajustes. */
function renderCompensa(s){
  var A=state.alloc,el=$('#compensa'),overs=[],pool=[],over=0,R=0;
  CATS.forEach(function(c){
    var rem=rc((A[c.id]||0)-s[c.id]);
    if(c.spend&&rem<0){overs.push(c.id);over=rc(over-rem)}
    else if(rem>0&&(c.spend||(c.id==='aho'&&!prefs.protectSavings))){pool.push({id:c.id,rem:rem});R=rc(R+rem)}
  });
  if(!overs.length){el.hidden=true;el.innerHTML='';return}
  var names=overs.map(function(id){return '«'+esc(cname(id))+'»'}).join(' y ');
  var html='<p class="ctitle"><span aria-hidden="true">🧭</span> '+names+(overs.length>1?' van':' va')+' '+fmt(over)+' por encima. Así puedes compensarlo</p>';
  if(!(R>0)){
    html+='<p>Ya no queda margen en las otras secciones. Lo que falte puede salir del colchón o del mes que viene, sin agobios.</p>';
  }else{
    var pc=Calc.proportionalCuts(over,pool);
    html+='<p>Para seguir dentro de tu dinero del mes, recorta en el resto lo que te queda en proporción:</p><ul>'+
      pool.map(function(p){
        var cut=pc.cuts[p.id];
        return cut>0?'<li><span>'+esc(cname(p.id))+'</span><strong>−'+fmt(cut)+'</strong><small>te quedarían '+fmt(p.rem-cut)+'</small></li>':'';
      }).join('')+'</ul>';
    if(pc.short>0)html+='<p>Aun recortando todo, faltarían '+fmt(pc.short)+'. Puedes cubrirlos con el colchón o con el mes que viene.</p>';
  }
  html+='<p class="fine">'+(prefs.protectSavings?'Tu ahorro queda fuera: no se toca. ':'Incluye lo que te queda por apartar al ahorro. ')+'Puedes cambiarlo en Ajustes.</p>';
  el.innerHTML=html;el.hidden=false;
}
function renderMoves(){
  var L=list().slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0});
  var isDemo=state.demo&&state.ym===nowYM;
  if(!L.length){
    $('#moves').innerHTML='<div class="empty"><span class="eico" aria-hidden="true">🧾</span><p>Todavía no hay gastos en '+esc(monthName(state.ym))+'. Cuando pagues algo, apúntalo y verás cuánto te queda.</p>'+
      '<div class="btnrow" style="justify-content:center;margin:0"><button class="btn primary" id="emptyAdd" type="button">＋ Apuntar mi primer gasto</button>'+
      (state.ym===nowYM?'<button class="btn" id="showDemo" type="button">Ver un ejemplo</button>':'')+'</div></div>';
    return;
  }
  var total=L.length,vis=state.showAll?L:L.slice(0,5);
  $('#moves').innerHTML='<ul class="moves">'+vis.map(function(e){
    var q=e.date.split('-').map(Number);
    var dd=new Date(q[0],q[1]-1,q[2]).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
    var name=e.note?esc(e.note):esc(cname(e.cat));
    return '<li class="move"><span class="d">'+esc(dd)+'</span>'+
      '<span class="n">'+name+'<span class="chip"><i style="background:'+cv(e.cat)+'"></i>'+esc(cname(e.cat))+(e.fixed?' · 🔁 fijo':'')+'</span></span>'+
      '<span class="a">'+fmt(e.amt)+'</span>'+
      (state.delAsk===e.id
        ?'<span></span><span class="ask" role="group" aria-label="Confirmar borrado"><span>¿Borrar este gasto?</span><button class="btn" type="button" data-delyes="'+esc(e.id)+'">Sí, borrar</button><button class="btn" type="button" data-delno="1">No</button></span>'
        :'<button class="x" type="button" data-del="'+esc(e.id)+'" aria-label="Eliminar '+fmt(e.amt)+' de '+esc(e.note||cname(e.cat))+'"'+(isDemo?' hidden':'')+'>×</button>')+'</li>';
  }).join('')+'</ul>'+(total>5?'<button class="linkbtn" id="moreMoves" type="button" style="margin-top:8px">'+(state.showAll?'Ver menos':'Ver todos ('+total+')')+'</button>':'');
}
function renderCheck(){
  var st=Calc.splitStatus(state.total,allocMap(),{totalChanged:state.checkWhy==='total'}),el=$('#sumCheck');
  if(st.kind==='exact')state.checkWhy=null;
  /* Si no cuadra, se ofrece ajustar la última sección (nunca el ahorro), diciendo cuál y de cuánto a cuánto. */
  var b=$('#fixSplit'),fx=Calc.fixProposal(state.total,allocMap(),fixTarget()),text=st.text;
  if(st.kind==='over'&&!fx)text+=' Baja alguna sección para que cuadre.';
  el.className='splitmsg '+st.kind;el.textContent=text;
  b.hidden=!fx;
  if(fx)b.textContent='Cuadrar: '+(fx.up?'subir':'bajar')+' «'+cname(fx.key)+'» de '+fmt(fx.from)+' a '+fmt(fx.to);
}
function allocMap(){var m={};CATS.forEach(function(c){m[c.id]=state.alloc[c.id]||0});return m}
/* La última sección de gasto de la lista (no el ahorro). */
function fixTarget(){var ids=spendIds();return ids[ids.length-1]||null}
$('#fixSplit').addEventListener('click',function(){
  var fx=Calc.fixProposal(state.total,allocMap(),fixTarget());
  if(!fx)return;
  var k=fx.key,prev=fx.from,inp=document.getElementById('s-'+k);
  if(inp)clearFieldError(inp);
  state.alloc[k]=fx.to;state.checkWhy=null;savePlan();syncInputs();renderAll();
  state.undo={fn:function(){state.alloc[k]=prev;savePlan();syncInputs();renderAll()}};
  toast('«'+cname(k)+'» ajustada a '+fmt(fx.to)+' para que el reparto sume '+fmt(state.total)+'.',true,'ok');
});

/* ---------- ahorro ---------- */
var PRESETS=[[6,'6 meses'],[12,'1 año'],[24,'2 años'],[36,'3 años'],[60,'5 años']];
function plural(n,s,p){return n+' '+(n===1?s:p)}
function span(m){
  if(m<12)return plural(m,'mes','meses');
  var y=Math.floor(m/12),r=m%12;
  return plural(y,'año','años')+(r?' y '+plural(r,'mes','meses'):'');
}
function monthRate(){return Calc.monthlyRate(state.rate,state.tax,TAXR)}
var growth=Calc.projectSavings,monthsTo=Calc.monthsToGoal;
function renderPresets(){
  $('#presets').innerHTML=PRESETS.map(function(p){
    var on=state.months===p[0];
    return '<button class="chip-btn'+(on?' on':'')+'" type="button" data-m="'+p[0]+'" aria-pressed="'+on+'">'+p[1]+'</button>';
  }).join('');
}
function renderSaveCalc(){
  var dep=state.alloc.aho||0,n=state.months,s0=state.saved0||0,el=$('#saveCalc');
  if(!(dep>0)&&!(s0>0)){el.innerHTML='<p class="fine">Escribe arriba cuánto apartas al mes y verás cuánto ahorrarías.</p>';return}
  var total=rc(s0+dep*n);
  var goal='';
  if(state.goal>0){
    var m=monthsTo(state.goal,dep,s0,0);
    if(s0>=state.goal)goal='<p class="goal ok">¡Ya tienes tu meta de '+fmt(state.goal)+'!</p>';
    else if(m==null)goal='<p class="goal">Para llegar a tu meta de '+fmt(state.goal)+' necesitas apartar algo cada mes.</p>';
    else goal='<p class="goal">Para tu meta de <strong>'+fmt(state.goal)+'</strong> te hacen falta <strong>'+span(m)+'</strong> apartando '+fmt(dep)+' al mes.</p>';
  }
  var marks=[6,12,24,36,60].map(function(mm){
    return '<div class="stat"><p class="l">En '+span(mm)+'</p><p class="v">'+fmt(s0+dep*mm)+'</p></div>';
  }).join('');
  el.innerHTML='<div class="stats four">'+
    '<div class="stat"><p class="l">Cada mes</p><p class="v">'+fmt(dep)+'</p></div>'+
    '<div class="stat"><p class="l">Cada año</p><p class="v">'+fmt(dep*12)+'</p></div>'+
    '<div class="stat"><p class="l">Durante</p><p class="v">'+esc(span(n))+'</p></div>'+
    '<div class="stat hl"><p class="l">Tendrías ahorrado</p><p class="v">'+fmt(total)+'</p></div></div>'+
    (s0>0?'<p class="fine">Incluye los '+fmt(s0)+' que ya tienes.</p>':'')+
    goal+
    '<p class="sub3">Con otros plazos</p><div class="stats five">'+marks+'</div>';
}
function renderRecoCalc(){
  var dep=state.alloc.aho||0,n=state.months,s0=state.saved0||0,el=$('#recoCalc');
  if(!(dep>0)&&!(s0>0)){el.innerHTML='<p class="fine">Escribe arriba cuánto apartas al mes y verás cuánto ganarías con una cuenta de ahorro.</p>';return}
  var i=monthRate(),pts=growth(dep,n,s0,i),fin=pts[n-1],plain=s0+dep*n,gain=fin-plain;
  var cps=[],seen={};
  for(var j=1;j<=6;j++){var m=Math.max(1,Math.round(n*j/6));if(!seen[m]){seen[m]=1;cps.push(m)}}
  var max=fin>0?fin:1;
  var rows=cps.map(function(m){
    var c=s0+dep*m,tot=pts[m-1],it=Math.max(0,tot-c);
    return '<div class="brow"><span>'+esc(span(m))+'</span><span class="bv">'+fmt(tot)+'</span>'+
      '<div class="btrack" role="img" aria-label="Aportado '+fmt(c)+' e intereses '+fmt(it)+'"><span class="bseg p" style="width:'+(c/max*100)+'%"></span><span class="bseg i" style="width:'+(it/max*100)+'%"></span></div></div>';
  }).join('');
  var gainHtml=gain>0
    ?'<div class="gain"><span>Solo por tenerlo en una cuenta de ahorro ganarías</span><strong>+'+fmt(gain)+'</strong></div>'
    :'<div class="gain zero"><span>Con un interés del 0 % no ganas nada. Pon arriba la TAE que te da tu banco.</span></div>';
  var goalHtml='';
  if(state.goal>0&&s0<state.goal){
    var m1=monthsTo(state.goal,dep,s0,0),m2=monthsTo(state.goal,dep,s0,i);
    if(m2!=null&&m1!=null&&m2<m1)goalHtml='<p class="goal ok">Con la cuenta llegas a tu meta de '+fmt(state.goal)+' en '+span(m2)+', '+span(m1-m2)+' antes que guardándolo sin más.</p>';
    else if(m2!=null&&m1!=null)goalHtml='<p class="goal">Con tu plazo y tu interés llegas a la meta de '+fmt(state.goal)+' en '+span(m2)+', casi igual que sin cuenta.</p>';
  }
  el.innerHTML=gainHtml+
    '<div class="stats">'+
    '<div class="stat"><p class="l">Sin cuenta</p><p class="v">'+fmt(plain)+'</p></div>'+
    '<div class="stat"><p class="l">Intereses</p><p class="v">'+fmt(gain)+'</p></div>'+
    '<div class="stat hl"><p class="l">Con cuenta</p><p class="v">'+fmt(fin)+'</p></div></div>'+
    goalHtml+
    '<div class="keyline" aria-hidden="true"><span><i style="background:var(--ink-2);opacity:.55"></i>Lo que apartas</span><span><i style="background:var(--accent)"></i>Intereses</span></div>'+
    '<div class="bars">'+rows+'</div>'+
    '<p class="fine">Estimación con TAE del '+state.rate.toLocaleString('es-ES',{maximumFractionDigits:2})+' %, '+
    (state.tax?'descontando el 19 % de impuestos':'sin descontar impuestos')+
    '. El tipo real depende de tu banco.</p>';
}
/* ---------- objetivos de ahorro ---------- */
function goalById(id){return state.goals.find(function(g){return g.id===id})}
function renderGoals(){
  var dep=state.alloc.aho||0,el=$('#goals'),full=state.goals.length>=MAXG;
  $('#goalForm').hidden=full;$('#goalMax').hidden=!full;
  if(!state.goals.length){el.innerHTML='<div class="empty" style="margin-bottom:14px"><span class="eico" aria-hidden="true">🎯</span><p>Aún no tienes objetivos. Ponle nombre y precio a algo para lo que ahorras, como un viaje o un móvil.</p><button class="btn primary" id="emptyGoal" type="button">＋ Crear mi primer objetivo</button></div>';return}
  var html=state.goals.map(function(g){
    var rem=rc(g.target-g.saved),pct=Math.min(1,g.saved/g.target),nm=esc(g.name),body;
    if(state.goalDel===g.id){
      body='<p class="fine">¿Borrar «'+nm+'»? Se pierde lo que llevas apuntado ('+fmt(g.saved)+'). Tu dinero no se toca.</p>'+
        '<div class="btnrow"><button class="btn" type="button" data-gdelyes="'+g.id+'">Sí, borrar</button><button class="btn" type="button" data-gdelno="1">Cancelar</button></div>';
    }else{
      var eta;
      if(rem<=0)eta='<p class="eta done">¡Objetivo conseguido!</p>';
      else if(!(dep>0))eta='<p class="eta">Pon cuánto apartas al mes arriba para calcular cuándo lo tendrás.</p>';
      else{
        var m=Math.ceil(rem/dep),d=new Date(now.getFullYear(),now.getMonth()+m,1);
        eta='<p class="eta">A tu ritmo de '+fmt(dep)+' al mes, lo tendrás hacia <strong>'+esc(d.toLocaleDateString('es-ES',{month:'long',year:'numeric'}))+'</strong> (en '+esc(span(m))+').</p>';
      }
      var add=state.goalAdd===g.id
        ?'<form data-gform="'+g.id+'" novalidate><div><label for="ga-'+g.id+'">Cuánto has guardado (€)</label><input id="ga-'+g.id+'" inputmode="decimal" autocomplete="off" placeholder="Ej.: 20"></div>'+
          '<button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-gaddno="1">Cancelar</button><p class="msg" role="alert"></p></form>'
        :'<div class="btnrow"><button class="btn primary" type="button" data-gadd="'+g.id+'">Añadir ahorro</button></div>';
      body='<div class="bar" role="img" aria-label="'+Math.round(pct*100)+' % conseguido"><span style="width:'+pct*100+'%"></span></div>'+
        '<p class="nums"><span><strong>'+fmt(g.saved)+'</strong> de '+fmt(g.target)+' · '+Math.floor(pct*100)+' %</span><span>'+(rem>0?'Faltan '+fmt(rem):(rem<0?'Sobran '+fmt(-rem):'Completo'))+'</span></p>'+
        eta+add;
    }
    var rm=state.goalDel===g.id?'':'<button class="rm" type="button" data-gdel="'+g.id+'" aria-label="Borrar el objetivo '+nm+'">Borrar</button>';
    return '<article class="obj"><header><h3>'+nm+'</h3>'+rm+'</header>'+body+'</article>';
  }).join('');
  el.innerHTML='<div class="objs">'+html+'</div>'+
    (state.goals.length>1&&dep>0?'<p class="fine" style="margin:-4px 0 14px">Cada fecha supone que todo tu ahorro del mes va a ese objetivo.</p>':'');
}
function renderSavings(){renderPresets();renderSaveCalc();renderRecoCalc();renderGoals()}

function syncInputs(){
  /* Importes (céntimos → «12,50») y números que no son dinero (meses y TAE, tal cual). */
  var map={'s-total':inStr(state.total),'a-aho':inStr(state.alloc.aho),'p-months':String(state.months),'p-rate':String(state.rate),
    'p-saved':state.saved0?inStr(state.saved0):'','p-goal':state.goal?inStr(state.goal):''};
  CATS.forEach(function(c){map['s-'+c.id]=inStr(state.alloc[c.id]||0)});
  Object.keys(map).forEach(function(id){
    var el=document.getElementById(id);
    /* Un campo con error conserva lo que escribió la persona hasta que lo corrija. */
    if(el&&document.activeElement!==el&&el.getAttribute('aria-invalid')!=='true')el.value=map[id];
  });
  var tx=document.getElementById('p-tax');if(tx)tx.checked=!!state.tax;
}
function renderSettings(){
  $('#setgrid').innerHTML=CATS.map(function(c){
    return '<div><label class="k" for="s-'+c.id+'"><i style="background:'+cv(c.id)+'"></i><span data-name="'+c.id+'">'+esc(cname(c.id))+'</span></label>'+
      '<input id="s-'+c.id+'" data-alloc="'+c.id+'" inputmode="decimal" autocomplete="off"></div>';
  }).join('');
  syncInputs();
}
function renderNames(){
  document.querySelectorAll('[data-name]').forEach(function(el){el.textContent=cname(el.getAttribute('data-name'))});
  var sel=$('#cat'),cur=sel.value;
  sel.innerHTML=CATS.map(function(c){return '<option value="'+c.id+'">'+esc(cname(c.id))+(c.id==='aho'?' (apartado)':'')+'</option>'}).join('');
  if(cur&&CAT[cur])sel.value=cur;else if(state.lastCat&&CAT[state.lastCat])sel.value=state.lastCat;
}
function renderSplit(){
  var sum=allocSum(),el=$('#splitbar');
  if(!(sum>0)){el.innerHTML='';return}
  var desc=CATS.filter(function(c){return (state.alloc[c.id]||0)>0}).map(function(c){return cname(c.id)+' '+Math.round((state.alloc[c.id]||0)/sum*100)+' %'}).join(', ');
  el.innerHTML='<div class="stack split" role="img" aria-label="Cómo se reparte tu dinero: '+esc(desc)+'">'+CATS.map(function(c){
    var v=state.alloc[c.id]||0,w=v/sum*100;
    return v>0?'<span class="seg" style="width:'+w+'%;background:'+cv(c.id)+'" title="'+esc(cname(c.id))+' '+Math.round(w)+' %">'+(w>=11?'<b>'+Math.round(w)+' %</b>':'')+'</span>':'';
  }).join('')+'</div>';
}
function renderAll(){renderHeader();renderSummary();renderSplit();renderCats();renderMoves();renderFixed();renderCheck();renderSavings();renderNames();renderAlert();renderStatus();if(state.tab==='tips')renderRef()}

function setDateBounds(){
  var p=state.ym.split('-').map(Number),dim=new Date(p[0],p[1],0).getDate(),el=$('#date');
  el.min=state.ym+'-01';el.max=state.ym+'-'+pad(dim);
  el.value=(state.ym===nowYM)?todayStr:state.ym+'-01';
}

/* ---------- avisos ---------- */
/* kind: 'ok' (éxito), 'warn' (aviso), 'error' o nada (información). Los errores se anuncian como alerta y duran más. */
var toastTimer=null,toastText=null,TOAST_MS={info:6000,ok:4000,warn:8000,error:10000},TOAST_ICO={info:'',ok:'✓',warn:'!',error:'✕'};
function toast(text,withUndo,kind){
  kind=TOAST_MS[kind]?kind:'info';
  var t=$('#toast');
  t.className='toast '+kind;t.setAttribute('role',kind==='error'?'alert':'status');
  $('#toastIco').textContent=TOAST_ICO[kind];$('#toastIco').hidden=!TOAST_ICO[kind];
  $('#toastBtn').hidden=!withUndo;t.hidden=false;
  /* El texto entra un instante después de mostrarse, para que los lectores de pantalla lo anuncien. */
  $('#toastText').textContent='';clearTimeout(toastText);
  toastText=setTimeout(function(){$('#toastText').textContent=text},30);
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.hidden=true;state.undo=null},withUndo?Math.max(6000,TOAST_MS[kind]):TOAST_MS[kind]);
}

/* ---------- avisos de gasto: 50 %, 75 % y límite ---------- */
var TH=[50,75,100];
function pctSpent(L){
  var s=sums(L),g=0,sp=0;
  spendIds().forEach(function(id){g+=state.alloc[id]||0;sp+=s[id]});
  g=rc(g);
  return g>0?sp/g*100:(sp>0?100:0);
}
/* Umbrales ya avisados este mes. La primera vez se calculan en silencio, para no avisar de gastos antiguos. */
function getFired(ym){
  if(state.fired[ym])return state.fired[ym];
  var f=null,raw=lsGet('a-'+ym);
  try{var a=raw?JSON.parse(raw):null;if(Array.isArray(a))f=a.filter(function(t){return TH.indexOf(t)>=0})}catch(e){}
  if(!f){loadMonth(ym);var p=pctSpent(state.cache[ym]||[]);f=TH.filter(function(t){return p>=t})}
  state.fired[ym]=f;
  return f;
}
function resetFired(ym){delete state.fired[ym];lsSet('a-'+ym,'null')}
function checkAlerts(ym,quiet){
  if(ym!==nowYM||state.demo)return;
  var f=getFired(ym),p=pctSpent(state.cache[ym]||[]),hit=null;
  TH.forEach(function(t){
    var has=f.indexOf(t)>=0;
    if(p>=t&&!has){f.push(t);hit=t}
    else if(p<t&&has){f.splice(f.indexOf(t),1)}
  });
  lsSet('a-'+ym,JSON.stringify(f));
  if(hit&&!quiet){state.alert={t:hit};renderAlert()}
}
function renderAlert(){
  var el=$('#alertbar'),al=state.alert;
  if(!al||state.demo){el.hidden=true;return}
  var s=sums(state.cache[nowYM]||[]),g=0,sp=0,over=[];
  spendIds().forEach(function(id){
    g+=state.alloc[id]||0;sp+=s[id];
    if(s[id]>(state.alloc[id]||0))over.push(cname(id));
  });
  g=rc(g);sp=rc(sp);
  var left=rc(g-sp),pct=g>0?sp/g*100:100;
  var dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),dl=dim-now.getDate()+1,mpct=now.getDate()/dim*100;
  var title,txt,lvl;
  if(al.t===50){
    lvl='lvl50';title='Vas por la mitad';
    txt='Has gastado '+fmt(sp)+' de '+fmt(g)+' ('+Math.round(pct)+' %). Te quedan '+fmt(left)+' para '+plural(dl,'día','días')+', unos '+fmt(left/dl)+' al día.';
  }else if(al.t===75){
    lvl='lvl75';title='Ojo: llevas el 75 %';
    txt='Has gastado '+fmt(sp)+' de '+fmt(g)+' ('+Math.round(pct)+' %). Solo quedan '+fmt(left)+' para '+plural(dl,'día','días')+', unos '+fmt(left/dl)+' al día.';
  }else{
    lvl='lvl100';
    if(left<0){
      title='Te has pasado un poco';
      txt='Llevas '+fmt(-left)+' más de lo previsto para gastar este mes. No pasa nada: puedes compensarlo el mes que viene o tirar un poco del colchón.';
    }else{
      title='Has llegado al límite';
      txt='Ya has gastado todo el dinero para gastar de este mes. Intenta no gastar más hasta fin de mes.';
    }
    if(over.length)txt+=' Por encima: '+over.join(', ')+'.';
  }
  if(al.t<100&&mpct+10<pct)txt+=' Vas más rápido que el calendario: llevas el '+Math.round(mpct)+' % del mes.';
  el.className='alertbar '+lvl;el.hidden=false;
  $('#alertTitle').textContent=title;$('#alertText').textContent=txt;
}
$('#alertOk').addEventListener('click',function(){state.alert=null;renderAlert()});

/* ---------- eventos ---------- */
function goMonth(delta){
  var p=state.ym.split('-').map(Number),d=new Date(p[0],p[1]-1+delta,1);
  state.ym=d.getFullYear()+'-'+pad(d.getMonth()+1);
  state.showAll=false;
  loadMonth(state.ym);
  setDateBounds();renderAll();
}
$('#prev').addEventListener('click',function(){goMonth(-1)});
$('#next').addEventListener('click',function(){goMonth(1)});
$('#today').addEventListener('click',function(){state.ym=nowYM;loadMonth(nowYM);setDateBounds();renderAll()});
$('#endDemo').addEventListener('click',function(){state.demo=false;renderAll()});
$('#moves').addEventListener('click',function(e){
  if(e.target.closest('#showDemo')){state.demo=true;renderAll();return}
  if(e.target.closest('#emptyAdd')){openQuick();return}
  if(e.target.closest('#moreMoves')){state.showAll=!state.showAll;renderMoves();return}
  var b=e.target.closest('[data-del]');
  if(b){state.delAsk=b.getAttribute('data-del');renderMoves();var y=$('[data-delyes]');if(y)y.focus();return}
  if(e.target.closest('[data-delno]')){var id0=state.delAsk;state.delAsk=null;renderMoves();var x0=$('[data-del="'+id0+'"]');if(x0)x0.focus();return}
  b=e.target.closest('[data-delyes]');if(!b)return;
  state.delAsk=null;
  var arr=state.cache[state.ym]||[],i=arr.findIndex(function(x){return x.id===b.getAttribute('data-delyes')});
  if(i<0){renderMoves();return}
  var removed=arr.splice(i,1)[0];
  state.undo={ym:state.ym,exp:removed};saveMonth(state.ym);renderAll();checkAlerts(state.ym,true);toast('Gasto borrado',true);
});
$('#toastBtn').addEventListener('click',function(){
  var u=state.undo;if(!u)return;
  if(u.fn){state.undo=null;$('#toast').hidden=true;u.fn();return}
  (state.cache[u.ym]=state.cache[u.ym]||[]).push(u.exp);
  state.undo=null;saveMonth(u.ym);$('#toast').hidden=true;renderAll();checkAlerts(u.ym,true);
});
$('#addForm').addEventListener('submit',function(e){
  e.preventDefault();
  var amt=amountOf($('#amt').value),msg=$('#formMsg');
  if(amt==null||!(amt>0)||amt>MAXEXP){
    msg.textContent=amountMsg($('#amt').value,amt);$('#amt').focus();return;
  }
  msg.textContent='';
  var date=$('#date').value||(state.ym===nowYM?todayStr:state.ym+'-01');
  var exp={id:uid8(),cat:$('#cat').value,amt:amt,note:$('#note').value.trim().slice(0,60),date:date};
  var rep=$('#rep').checked,fid=addExpense(exp,rep);
  $('#amt').value='';$('#note').value='';$('#rep').checked=false;
  $('#amt').focus();
  if(rep)toast(fid?'Apuntado. Se repetirá cada mes: lo verás en Gastos fijos.':'Apuntado, pero ya tienes el máximo de '+MAXF+' gastos fijos.',false);
});

/* Apunta un gasto (desde el formulario o la hoja rápida). Si se repite, crea el gasto fijo y devuelve su id. */
function addExpense(exp,repeat){
  var ym=exp.date.slice(0,7),fid=null;
  state.demo=false;
  loadMonth(ym);
  if(ym===nowYM)getFired(ym);
  state.cache[ym].push(exp);
  if(repeat&&state.fixed.length<MAXF){
    fid='f'+uid8();
    state.fixed.push({id:fid,cat:exp.cat,amt:exp.amt,note:exp.note,day:+exp.date.slice(8,10)});
    exp.fixed=fid;
    (state.fixedDone[ym]=state.fixedDone[ym]||[]).push(fid);
  }
  saveMonth(ym);
  state.lastCat=exp.cat;savePlan();
  if(fid&&ym<nowYM)applyFixed(nowYM);
  if(ym!==state.ym){state.ym=ym;state.showAll=false;loadMonth(ym);setDateBounds()}
  $('#cat').value=exp.cat;
  renderAll();
  checkAlerts(ym);
  return fid;
}
function undoAdd(exp,fid){
  var ym=exp.date.slice(0,7),arr=state.cache[ym]||[],i=arr.indexOf(exp);
  if(i>=0)arr.splice(i,1);
  if(fid){
    state.fixed=state.fixed.filter(function(f){return f.id!==fid});
    var d=state.fixedDone[ym];if(d&&d.indexOf(fid)>=0)d.splice(d.indexOf(fid),1);
    savePlan();
  }
  saveMonth(ym);renderAll();checkAlerts(ym,true);
}

/* ---------- apuntar rápido: botón flotante y hoja con importes de un toque ---------- */
var quickFrom=null;
function renderQuickCats(){
  $('#q-cats').innerHTML=CATS.map(function(c){
    return '<button class="qcat" type="button" data-qc="'+c.id+'" aria-pressed="'+(c.id===state.qcat)+'"><span aria-hidden="true">'+catIcon(c)+'</span>'+esc(cname(c.id))+'</button>';
  }).join('');
}
function openQuick(){
  state.qcat=(state.lastCat&&CAT[state.lastCat])?state.lastCat:spendIds()[0];
  renderQuickCats();
  $('#q-amt').value='';$('#q-msg').textContent='';$('#q-rep').checked=false;
  quickFrom=document.activeElement;
  $('#quick').hidden=false;
  /* En el móvil no se abre el teclado: así se ven los importes rápidos. */
  if(window.matchMedia&&matchMedia('(pointer:fine)').matches)$('#q-amt').focus();else $('#q-close').focus();
}
function closeQuick(){
  $('#quick').hidden=true;
  if(quickFrom&&quickFrom.focus)quickFrom.focus();
}
function quickSave(amt){
  var exp={id:uid8(),cat:state.qcat,amt:amt,note:'',date:todayStr};
  var rep=$('#q-rep').checked,fid=addExpense(exp,rep);
  closeQuick();
  state.undo={fn:function(){undoAdd(exp,fid)}};
  toast('Apuntado '+fmt(exp.amt)+' en '+cname(exp.cat)+(fid?' · se repetirá cada mes':''),true,'ok');
}
$('#fab').addEventListener('click',openQuick);
$('#q-close').addEventListener('click',closeQuick);
$('#quick').addEventListener('click',function(e){
  if(e.target===this){closeQuick();return}
  var c=e.target.closest('[data-qc]');
  if(c){state.qcat=c.getAttribute('data-qc');renderQuickCats();return}
  var a=e.target.closest('[data-qa]');
  if(a)quickSave(100*a.getAttribute('data-qa'));
});
$('#q-form').addEventListener('submit',function(e){
  e.preventDefault();
  var amt=amountOf($('#q-amt').value);
  if(amt==null||!(amt>0)||amt>MAXEXP){
    $('#q-msg').textContent=amountMsg($('#q-amt').value,amt);$('#q-amt').focus();return;
  }
  quickSave(amt);
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&!$('#quick').hidden){e.preventDefault();closeQuick()}
});

/* ---------- gastos fijos: ver, editar y quitar ---------- */
function renderFixed(){
  var el=$('#fixed');
  if(!state.fixed.length){
    el.innerHTML='<p class="fine">Aún no tienes gastos fijos. Al apuntar un gasto, marca «Se repite cada mes» y aparecerá aquí.</p>';
    return;
  }
  var tot=0;
  var rows=state.fixed.map(function(f){
    tot+=f.amt;
    var c=CAT[f.cat]?f.cat:'nec',nm=f.note||cname(c);
    if(state.fixEdit===f.id){
      return '<li class="fixrow"><form class="fixedit" data-fform="'+f.id+'" novalidate>'+
        '<div class="full"><label for="fe-note">Concepto</label><input id="fe-note" maxlength="60" autocomplete="off" value="'+esc(f.note)+'" placeholder="Ej.: abono transporte"></div>'+
        '<div><label for="fe-amt">Importe (€)</label><input id="fe-amt" inputmode="decimal" autocomplete="off" value="'+inStr(f.amt)+'"></div>'+
        '<div><label for="fe-day">Día del mes</label><input id="fe-day" type="number" min="1" max="31" step="1" value="'+f.day+'"></div>'+
        '<div class="full"><label for="fe-cat">Sección</label><select id="fe-cat">'+CATS.map(function(x){
          return '<option value="'+x.id+'"'+(x.id===c?' selected':'')+'>'+esc(cname(x.id))+'</option>';
        }).join('')+'</select></div>'+
        '<div class="full btnrow"><button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-fcancel="1">Cancelar</button></div>'+
        '<p class="msg full" role="alert"></p></form></li>';
    }
    return '<li class="fixrow" style="--cc:'+cv(c)+'"><span class="cico" aria-hidden="true">'+nameIcon(f.note,catIcon(CAT[c]))+'</span>'+
      '<span class="n">'+esc(nm)+'<small>'+esc(cname(c))+' · el día '+f.day+'</small></span>'+
      '<span class="a">'+fmt(f.amt)+'</span>'+
      '<span class="acts"><button class="linkbtn" type="button" data-fedit="'+f.id+'" aria-label="Editar '+esc(nm)+'">Editar</button>'+
      '<button class="linkbtn" type="button" data-fdel="'+f.id+'" aria-label="Quitar '+esc(nm)+'">Quitar</button></span></li>';
  }).join('');
  el.innerHTML='<ul class="fixlist">'+rows+'</ul>'+
    '<p class="fine" style="margin-top:10px">Total: '+fmt(rc(tot))+' al mes. Se apuntan solos al empezar cada mes; si cambias uno, cuenta desde el mes que viene.</p>';
}
$('#fixed').addEventListener('click',function(e){
  var b;
  if((b=e.target.closest('[data-fedit]'))){
    state.fixEdit=b.getAttribute('data-fedit');renderFixed();
    var i=$('#fe-amt');if(i)i.focus();return;
  }
  if(e.target.closest('[data-fcancel]')){state.fixEdit=null;renderFixed();return}
  if((b=e.target.closest('[data-fdel]'))){
    var id=b.getAttribute('data-fdel'),i2=state.fixed.findIndex(function(f){return f.id===id});
    if(i2<0)return;
    var gone=state.fixed.splice(i2,1)[0];
    if(state.fixEdit===id)state.fixEdit=null;
    savePlan();renderFixed();
    state.undo={fn:function(){if(state.fixed.length<MAXF){state.fixed.splice(Math.min(i2,state.fixed.length),0,gone);savePlan();renderFixed()}}};
    toast('Gasto fijo quitado. El de este mes sigue en Movimientos.',true);
  }
});
$('#fixed').addEventListener('submit',function(e){
  var f=e.target.closest('[data-fform]');if(!f)return;
  e.preventDefault();
  var x=state.fixed.find(function(y){return y.id===f.getAttribute('data-fform')});if(!x)return;
  var amt=amountOf($('#fe-amt').value),day=parseInt($('#fe-day').value,10),m=f.querySelector('.msg');
  if(amt==null||!(amt>0)||amt>MAXEXP){m.textContent=amountMsg($('#fe-amt').value,amt);$('#fe-amt').focus();return}
  if(!(day>=1&&day<=31)){m.textContent='El día tiene que estar entre 1 y 31.';$('#fe-day').focus();return}
  x.amt=amt;x.day=day;x.note=$('#fe-note').value.trim().slice(0,60);x.cat=CAT[$('#fe-cat').value]?$('#fe-cat').value:'nec';
  state.fixEdit=null;savePlan();renderFixed();
  toast('Gasto fijo guardado. Cuenta desde el mes que viene.',false);
});
$('#fixed').addEventListener('keydown',function(e){
  if(e.key==='Escape'&&state.fixEdit){state.fixEdit=null;renderFixed()}
});

/* ---------- primera vez: solo una pregunta y un reparto razonable ---------- */
function isNewUser(){
  var raw=lsGet('plan');
  return storageOK&&raw===null&&allMonthKeys().length===0;
}
function closeOnboard(){$('#onboard').hidden=true;$('#fab').hidden=false}
$('#onbForm').addEventListener('submit',function(e){
  e.preventDefault();
  var n=amountOf($('#onb-amt').value),m=$('#onb-msg');
  if(n==null||!(n>0)||n>MAXALLOC){m.textContent='Escribe cuánto tienes este mes, por ejemplo 300.';$('#onb-amt').focus();return}
  /* El mismo reparto de partida que trae la app: 45 % necesarios, 25 % ocio, 10 % proyectos y 20 % ahorro, sin perder céntimos. */
  var sp=Calc.splitByPercent(n,{nec:45,oci:25,pro:10,aho:20});
  state.total=n;state.alloc.nec=sp.nec;state.alloc.oci=sp.oci;state.alloc.pro=sp.pro;state.alloc.aho=sp.aho;
  savePlan();askPersist();renderSettings();renderAll();closeOnboard();window.scrollTo(0,0);
  toast('Listo: '+['nec','oci','pro','aho'].map(function(k){return cname(k)+' '+fmt(state.alloc[k])}).join(' · ')+'. Puedes cambiarlo en «Ajustar el reparto».',false);
});
$('#onb-skip').addEventListener('click',function(){savePlan();renderAll();closeOnboard()});

/* reparto: las cantidades de las secciones (y el ahorro, que también se edita en la pestaña Ahorro) */
/* Error junto al campo: lo escrito se queda a la vista para corregirlo y el aviso se quita al corregirlo. */
function fieldError(el,msg){
  var id=el.id+'-err',p=document.getElementById(id);
  if(!p){p=document.createElement('p');p.className='ferr';p.id=id;p.setAttribute('role','alert');el.insertAdjacentElement('afterend',p)}
  p.textContent=msg;el.setAttribute('aria-invalid','true');
  var d=(el.getAttribute('aria-describedby')||'').split(' ').filter(Boolean);
  if(d.indexOf(id)<0){d.push(id);el.setAttribute('aria-describedby',d.join(' '))}
}
function clearFieldError(el){
  if(el.getAttribute('aria-invalid')!=='true')return;
  var id=el.id+'-err',p=document.getElementById(id);if(p)p.remove();
  el.removeAttribute('aria-invalid');
  var d=(el.getAttribute('aria-describedby')||'').split(' ').filter(function(x){return x&&x!==id});
  if(d.length)el.setAttribute('aria-describedby',d.join(' '));else el.removeAttribute('aria-describedby');
}
/* Por qué no vale un importe del reparto y qué valor se sigue usando mientras tanto. */
function splitFieldMsg(raw,n,isTotal,keep){
  var s=String(raw||'').trim(),m;
  if(!s)m='Escribe cuánto dinero tienes este mes.';
  else if(s.charAt(0)==='-')m='No puede ser negativo.';
  else if(n===0)m='Tiene que ser mayor que 0.';
  else if(n!=null&&n>MAXALLOC)m='Como mucho '+fmt(MAXALLOC)+'.';
  else m='No entiendo «'+(s.length>14?s.slice(0,14)+'…':s)+'».';
  return m+' Escríbelo así: '+(isTotal?'300 o 300,50':'12,50')+'. Mientras, se mantiene '+fmt(keep)+'.';
}
/* Valor guardado al entrar en el campo: si lo escrito no vale, se vuelve a él (sin tocar lo que se ve en el campo). */
function isSplitField(t){return t&&(t.id==='s-total'||(t.getAttribute&&CAT[t.getAttribute('data-alloc')]))}
document.addEventListener('focusin',function(e){
  var t=e.target;if(!isSplitField(t)||t.getAttribute('aria-invalid')==='true')return;
  t._held=t.id==='s-total'?state.total:(state.alloc[t.getAttribute('data-alloc')]||0);
});
/* reparto: las cantidades de las secciones (y el ahorro, que también se edita en la pestaña Ahorro) */
function allocInput(e){
  var k=e.target.getAttribute&&e.target.getAttribute('data-alloc');if(!k||!CAT[k])return;
  var v=e.target.value.trim(),n=v===''?0:amountOf(v);
  if(n!=null&&n<=MAXALLOC){clearFieldError(e.target);state.alloc[k]=n;state.checkWhy=null;syncInputs();renderAll()}
}
function allocChange(e){
  var el=e.target,k=el.getAttribute&&el.getAttribute('data-alloc');if(!k||!CAT[k])return;
  var v=el.value.trim(),n=v===''?0:amountOf(v);
  if(n==null||n>MAXALLOC){
    var keep=el._held!=null?el._held:(state.alloc[k]||0);
    state.alloc[k]=keep;fieldError(el,splitFieldMsg(v,n,false,keep));renderAll();return;
  }
  clearFieldError(el);el._held=n;
  savePlan();syncInputs();checkAlerts(nowYM);
}
$('#setgrid').addEventListener('input',allocInput);
$('#setgrid').addEventListener('change',allocChange);
$('#a-aho').addEventListener('input',allocInput);
$('#a-aho').addEventListener('change',allocChange);
$('#s-total').addEventListener('input',function(){
  var el=$('#s-total'),n=amountOf(el.value);
  if(n!=null&&n>0&&n<=MAXALLOC){clearFieldError(el);state.total=n;state.checkWhy='total';renderCheck()}
});
$('#s-total').addEventListener('change',function(){
  var el=$('#s-total'),n=amountOf(el.value);
  if(n==null||!(n>0)||n>MAXALLOC){
    var keep=el._held!=null?el._held:state.total;
    state.total=keep;state.checkWhy=null;fieldError(el,splitFieldMsg(el.value,n,true,keep));renderCheck();return;
  }
  clearFieldError(el);el._held=n;
  savePlan();syncInputs();renderCheck();
});

/* ahorro */
$('#p-months').addEventListener('input',function(){var n=parseInt($('#p-months').value,10);if(n>=1&&n<=120){state.months=n;renderSavings()}});
$('#p-months').addEventListener('change',function(){savePlan();syncInputs();renderSavings()});
$('#p-rate').addEventListener('input',function(){var n=parsePlain($('#p-rate').value);if(n!=null&&n<=30){state.rate=n;renderSavings()}});
$('#p-rate').addEventListener('change',function(){savePlan();syncInputs();renderSavings()});
function moneyField(sel,key){
  var el=$(sel);
  el.addEventListener('input',function(){
    var v=el.value.trim(),n=v===''?0:amountOf(v);
    if(n!=null&&n<=MAXSAVE){state[key]=n;renderSavings()}
  });
  el.addEventListener('change',function(){savePlan();syncInputs();renderSavings()});
}
moneyField('#p-saved','saved0');
moneyField('#p-goal','goal');
$('#p-tax').addEventListener('change',function(){state.tax=this.checked;savePlan();renderSavings()});
$('#presets').addEventListener('click',function(e){
  var b=e.target.closest('[data-m]');if(!b)return;
  state.months=+b.getAttribute('data-m');savePlan();syncInputs();renderSavings();
});

/* objetivos */
$('#goalForm').addEventListener('submit',function(e){
  e.preventDefault();
  var name=$('#g-name').value.trim().slice(0,40),n=amountOf($('#g-amt').value),m=$('#g-msg');
  if(!name){m.textContent='Ponle un nombre, por ejemplo «Viaje a Roma».';$('#g-name').focus();return}
  if(n==null||!(n>0)||n>MAXSAVE){m.textContent='Escribe cuánto cuesta, por ejemplo 600.';$('#g-amt').focus();return}
  if(state.goals.length>=MAXG){m.textContent='Ya tienes el máximo de '+MAXG+' objetivos.';return}
  m.textContent='';
  state.goals.push({id:'g'+uid8(),name:name,target:rc(n),saved:0});
  savePlan();
  $('#g-name').value='';$('#g-amt').value='';
  renderGoals();toast('Objetivo «'+name+'» creado',false);
});
$('#goals').addEventListener('click',function(e){
  var t=e.target,b;
  if(t.closest('#emptyGoal')){$('#g-name').scrollIntoView({block:'center'});$('#g-name').focus();return}
  if((b=t.closest('[data-gadd]'))){
    state.goalAdd=b.getAttribute('data-gadd');state.goalDel=null;renderGoals();
    var inp=$('#ga-'+state.goalAdd);if(inp)inp.focus();return;
  }
  if(t.closest('[data-gaddno]')){state.goalAdd=null;renderGoals();return}
  if((b=t.closest('[data-gdel]'))){state.goalDel=b.getAttribute('data-gdel');state.goalAdd=null;renderGoals();return}
  if(t.closest('[data-gdelno]')){state.goalDel=null;renderGoals();return}
  if((b=t.closest('[data-gdelyes]'))){
    var id=b.getAttribute('data-gdelyes'),i=state.goals.findIndex(function(g){return g.id===id});
    state.goalDel=null;
    if(i<0)return;
    var gone=state.goals.splice(i,1)[0];
    savePlan();renderGoals();
    state.undo={fn:function(){if(state.goals.length<MAXG){state.goals.splice(Math.min(i,state.goals.length),0,gone);savePlan();renderGoals()}}};
    toast('Objetivo «'+gone.name+'» borrado',true);
  }
});
$('#goals').addEventListener('submit',function(e){
  var f=e.target.closest('[data-gform]');if(!f)return;
  e.preventDefault();
  var g=goalById(f.getAttribute('data-gform'));if(!g)return;
  var inp=f.querySelector('input'),add=amountOf(inp.value);
  if(add==null||!(add>0)||g.saved+add>MAXSAVE){
    f.querySelector('.msg').textContent='Escribe una cantidad mayor que 0, por ejemplo 20.';inp.focus();return;
  }
  var id=g.id;
  g.saved+=add;state.goalAdd=null;
  savePlan();renderGoals();
  state.undo={fn:function(){var x=goalById(id);if(x){x.saved=Math.max(0,x.saved-add);savePlan();renderGoals()}}};
  toast(g.saved>=g.target?'¡Conseguido! Ya tienes «'+g.name+'»':'Añadidos '+fmt(add)+' a «'+g.name+'»',true);
});
$('#goals').addEventListener('keydown',function(e){
  if(e.key==='Escape'&&state.goalAdd){state.goalAdd=null;renderGoals()}
});

/* ---------- explicaciones: los botones «?» muestran u ocultan el texto de su sección ---------- */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-help]');if(!b)return;
  var p=document.getElementById(b.getAttribute('data-help'));if(!p)return;
  p.hidden=!p.hidden;b.setAttribute('aria-expanded',p.hidden?'false':'true');
});

/* ---------- pestañas ---------- */
var TABS=['money','save','tips'];
function showTab(t){
  if(TABS.indexOf(t)<0)return;
  state.tab=t;
  TABS.forEach(function(x){
    var on=(x===t);
    $('#pane-'+x).hidden=!on;
    var b=$('#tabbtn-'+x);
    b.setAttribute('aria-selected',on?'true':'false');
    b.tabIndex=on?0:-1;
  });
  renderHeader();
  if(t==='tips')renderRef();
  if(t==='save'){syncInputs();renderSavings()}
  window.scrollTo(0,0);
  updateFab();
}
/* ---------- botón flotante: solo en Resumen y sin tapar el formulario ni los campos al escribir ---------- */
var formInView=false;
function typing(){var a=document.activeElement;return !!a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!a.closest('.sheetwrap')}
function updateFab(){$('#fab').classList.toggle('away',state.tab!=='money'||formInView||typing())}
if('IntersectionObserver' in window){
  new IntersectionObserver(function(en){formInView=en[0].isIntersecting;updateFab()},{threshold:0.15}).observe($('#addForm').closest('section'));
}
document.addEventListener('focusin',updateFab);
document.addEventListener('focusout',function(){setTimeout(updateFab,0)});
$('.tabs').addEventListener('click',function(e){
  var b=e.target.closest('[data-tab]');
  if(b)showTab(b.getAttribute('data-tab'));
});
$('.tabs').addEventListener('keydown',function(e){
  var i=TABS.indexOf(state.tab);
  if(e.key==='ArrowRight')i=(i+1)%TABS.length;
  else if(e.key==='ArrowLeft')i=(i+TABS.length-1)%TABS.length;
  else if(e.key==='Home')i=0;
  else if(e.key==='End')i=TABS.length-1;
  else return;
  e.preventDefault();
  showTab(TABS[i]);$('#tabbtn-'+TABS[i]).focus();
});

/* ---------- partidas: nombres (Necesarios, Proyectos y las tuyas), añadir y quitar ---------- */
function commitName(id,val){
  if(state.editing!==id)return;
  state.editing=null;
  var v=String(val||'').trim().slice(0,24);
  if(v&&CAT[id]&&v!==CAT[id].name)state.names[id]=v;else delete state.names[id];
  savePlan();renderAll();
}
function cancelName(){if(state.editing){state.editing=null;renderCats()}}
function addExtra(name,amt){
  var id='x'+uid8().slice(-8);
  state.extras.push({id:id,ci:nextCi()});rebuildCats();
  state.names[id]=name;state.alloc[id]=amt;savePlan();
}
function removeExtra(id){
  var x=state.extras.findIndex(function(y){return y.id===id});
  if(x<0)return;
  var al=state.alloc[id]||0,n=0;
  allMonthKeys().forEach(function(ym){
    loadMonth(ym);
    var ch=false;
    state.cache[ym].forEach(function(e){if(e.cat===id){e.cat='nec';n++;ch=true}});
    if(ch)saveMonth(ym);
  });
  state.alloc.nec=rc((state.alloc.nec||0)+al);
  state.fixed.forEach(function(f){if(f.cat===id)f.cat='nec'});
  state.extras.splice(x,1);delete state.names[id];delete state.alloc[id];rebuildCats();
  state.confirmDel=null;savePlan();renderSettings();renderAll();
  toast('Sección quitada. '+(n?n+(n===1?' gasto pasó':' gastos pasaron')+' a «'+cname('nec')+'».':'Su dinero pasó a «'+cname('nec')+'».'),false);
  checkAlerts(nowYM,true);
}
function openAddCat(){
  var f=$('#addCatForm'),rest=Math.max(0,rc(state.total-allocSum()));
  f.hidden=false;
  $('#ac-amt').value=rest?inStr(rest):'';
  $('#ac-name').value='';$('#ac-msg').textContent='';$('#ac-ico').textContent='📌';
  $('#ac-name').focus();
}
$('#cats').addEventListener('click',function(e){
  var t=e.target,b=t.closest('[data-edit]');
  if(b){state.editing=b.getAttribute('data-edit');state.confirmDel=null;renderCats();return}
  if(t.closest('#addCatBtn')){openAddCat();return}
  var r=t.closest('[data-rm]');
  if(r){state.confirmDel=r.getAttribute('data-rm');state.editing=null;renderCats();return}
  if(t.closest('[data-rmno]')){state.confirmDel=null;renderCats();return}
  var y=t.closest('[data-rmyes]');
  if(y){removeExtra(y.getAttribute('data-rmyes'));return}
  var g=t.closest('[data-go]');
  if(g)showTab(g.getAttribute('data-go'));
});
$('#cats').addEventListener('keydown',function(e){
  if(!e.target.classList||!e.target.classList.contains('nameinput'))return;
  if(e.key==='Enter'){e.preventDefault();commitName(e.target.getAttribute('data-cat'),e.target.value)}
  else if(e.key==='Escape'){e.preventDefault();cancelName()}
});
$('#cats').addEventListener('focusout',function(e){
  if(e.target.classList&&e.target.classList.contains('nameinput'))commitName(e.target.getAttribute('data-cat'),e.target.value);
});
$('#addCatForm').addEventListener('submit',function(e){
  e.preventDefault();
  var name=$('#ac-name').value.trim().slice(0,24),v=$('#ac-amt').value.trim(),n=v===''?0:amountOf(v),m=$('#ac-msg');
  if(!name){m.textContent='Ponle un nombre a la sección, por ejemplo «Gimnasio».';$('#ac-name').focus();return}
  if(n==null||n>MAXALLOC){m.textContent='Escribe una cantidad válida, por ejemplo 15.';$('#ac-amt').focus();return}
  if(state.extras.length>=MAXX){m.textContent='Ya tienes el máximo de secciones propias ('+MAXX+').';return}
  addExtra(name,n);
  $('#addCatForm').hidden=true;
  renderSettings();renderAll();
  toast('Sección «'+name+'» añadida',false);
});
$('#ac-name').addEventListener('input',function(){$('#ac-ico').textContent=nameIcon(this.value,'📌')});
$('#ac-cancel').addEventListener('click',function(){$('#addCatForm').hidden=true});

/* ---------- consejos ---------- */
var TIPS=[
  {t:"Págate a ti primero",p:"Aparta el ahorro el mismo día que recibes el dinero, antes de gastar nada. Lo que queda es lo que puedes gastar, y así el ahorro deja de depender de la fuerza de voluntad a final de mes."},
  {t:"Empieza por un colchón pequeño",p:"El objetivo habitual es reunir entre tres y seis meses de gastos básicos, pero con un presupuesto ajustado conviene empezar por una meta pequeña, como un mes de gastos básicos. Ese colchón evita que un imprevisto acabe convirtiéndose en una deuda."},
  {t:"Vigila los gastos hormiga",p:"Un café, un snack o una suscripción que ya no usas parecen poco, pero sumados pueden superar tu sección de ocio. Apunta todo durante un mes y repasa las suscripciones: verás enseguida cuáles no echarías de menos."},
  {t:"Pagar a plazos tiene un coste",p:"Antes de fraccionar una compra, mira el importe total que pagarás al final y la TAE, no solo la cuota. Algunas promociones son al 0 %, pero fuera de ellas los intereses de las tarjetas de crédito suelen ser altos, y una cuota fija durante años recorta tu margen cada mes."},
  {t:"El interés compuesto juega a tu favor",p:"Cuanto antes empiezas a ahorrar, más tiempo trabajan los intereses sobre los intereses. Con cantidades pequeñas el efecto es modesto, como verás en la pestaña Ahorro, pero el hábito que creas es lo que de verdad importa."},
  {t:"La inflación se come el dinero parado",p:"Si los precios suben más de lo que rinde tu dinero, cada euro compra menos con el tiempo. Por eso conviene saber qué interés da tu cuenta y comparar. Los depósitos en entidades españolas están garantizados hasta 100.000 euros por titular y entidad."},
  {t:"Si promete rentabilidad segura, desconfía",p:"Ninguna inversión legítima garantiza ganancias altas sin riesgo. Antes de poner dinero en algo, comprueba que la empresa esté autorizada y consulta los avisos de la CNMV, la Comisión Nacional del Mercado de Valores. Y no inviertas dinero que puedas necesitar pronto."},
  {t:"Pon tu ahorro en una cuenta de ahorro",p:"No dejes el colchón parado en la cuenta del día a día: una cuenta de ahorro de tu banco te paga un interés por el dinero que guardas. Compara la TAE, lee las condiciones y mira en la pestaña Ahorro cuánto ganarías."},
  {t:"Si empiezas a ganar dinero, infórmate de los impuestos",p:"Cuando tus proyectos empiecen a dar ingresos, pregunta en la Agencia Tributaria o a una gestoría qué obligaciones tienes. Es mucho mejor saberlo desde el primer euro que descubrirlo después."}
];
function renderTipGrid(){
  var ICO=['💸','🛟','☕','🧾','📈','🎈','🚩','🏦','🏛️'];
  $('#tipgrid').innerHTML=TIPS.map(function(x,i){return '<details class="tip"><summary><span class="ico" aria-hidden="true">'+(ICO[i]||'💡')+'</span>'+esc(x.t)+'</summary><p>'+esc(x.p)+'</p></details>'}).join('');
}
function renderRef(){
  var A=state.alloc,sum=allocSum(),el=$('#refcmp');
  if(!(sum>0)){el.innerHTML='<p class="fine">Reparte tu dinero en la pestaña Resumen para ver esta comparación.</p>';return}
  function pc(v){return (v/sum*100).toLocaleString('es-ES',{maximumFractionDigits:1})+' %'}
  var stats=CATS.map(function(c){
    return '<div class="stat" style="border-top:3px solid '+cv(c.id)+'"><p class="l">'+esc(cname(c.id))+'</p><p class="v">'+pc(A[c.id]||0)+'</p></div>';
  }).join('');
  var msg=((A.aho||0)/sum>=0.2)
    ?'Tu ahorro está en la referencia del 20 % o por encima.'
    :'Tu ahorro está por debajo del 20 %. Con tus '+fmt(sum)+', el 20 % serían '+fmt(sum*0.2)+' al mes.';
  el.innerHTML='<div class="stats four">'+stats+'</div><p class="fine">'+msg+' Pauta 50/30/20: 50 % necesidades, 30 % deseos, 20 % ahorro. Con poco dinero las necesidades pesan más; lo importante es que cada euro tenga destino.</p>';
}

/* ---------- asistente de dudas ---------- */
/* Por defecto responde la guía integrada: no sale nada del dispositivo.
   Opcional: AI_ENDPOINT = URL de un servidor propio (ver docs/ia-worker.md) que reciba POST {messages, context} y devuelva {text}.
   La clave de la IA vive en ese servidor, nunca aquí. Antes de enviar nada se pide consentimiento (askConsent). */
var AI_ENDPOINT='';
var aiMode='guide';

function norm(s){return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}
function tipText(i){return TIPS[i].p}
function kwRegex(w){return new RegExp('(^|[^a-z0-9])'+w.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&'))}
var KB=[
  {k:['ahorr','colchon','emergencia','guardar dinero'],a:function(){
    var A=state.alloc,sum=allocSum();
    if(!(sum>0))return 'Una referencia habitual es ahorrar alrededor del 20 % de lo que entra. Reparte tu dinero en la pestaña Resumen y te digo cuánto sería en tu caso. '+tipText(0);
    return 'Una referencia habitual es ahorrar alrededor del 20 % de lo que entra, la regla 50/30/20. Si tu dinero es poco, empieza por lo que puedas, aunque sea un 5 o un 10 %, y sube el porcentaje cuando puedas. Con tus '+fmt(sum)+' al mes, el 20 % serían '+fmt(sum*0.2)+' y ahora apartas '+fmt(A.aho)+'. Lo que más cuenta es apartarlo el día que recibes el dinero y no tocarlo salvo imprevistos reales.';
  }},
  {k:['cuenta de ahorro','cuentas de ahorro','cuenta remunerada','cuentas remuneradas','remunerad'],a:"Una cuenta de ahorro (o remunerada) es una cuenta de tu banco que te paga intereses por el dinero que dejas en ella. Tu dinero sigue siendo tuyo y, en entidades españolas, está garantizado hasta 100.000 euros por titular y entidad. Compara la TAE y lee las condiciones: algunas piden nómina, solo pagan hasta cierto saldo o tienen un tipo alto solo unos meses. Los intereses tributan en el IRPF, y en la pestaña Ahorro puedes poner la TAE de tu banco y ver cuánto ganarías. Esto es información general, no la recomendación de un banco concreto."},
  {k:['ocio','hormiga','salir','capricho','gasto','gastar','reducir'],a:function(){
    var dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),cap=state.alloc.oci/(dim/7);
    return 'Empieza por ver adónde va realmente el dinero: apunta todos los gastos de ocio durante un mes, sobre todo los pequeños, que son los que más se escapan. Revisa las suscripciones que no uses, fija un tope semanal (el tuyo es '+fmt(cap)+') y mira el domingo cuánto llevas. Si a final de mes te sobra algo de ocio, llévalo al ahorro en vez de gastarlo.';
  }},
  {k:['tarjeta','debito','prepago','revolving','debito o credito','credito o debito'],a:"Con la tarjeta de débito el dinero sale al momento de tu cuenta, así que solo puedes gastar lo que tienes. La de crédito te adelanta dinero y te lo cobra después, y si aplazas el pago se generan intereses que suelen ser altos. La prepago se recarga con un importe y sirve para limitar el gasto, por ejemplo en compras por internet. Para empezar a controlar tu dinero, el débito es lo más sencillo, y si usas crédito, págalo entero cada mes."},
  {k:['plazo','cuota','credito','prestamo','deuda','financiar','financiaci','fraccion'],a:function(){
    return tipText(3)+' Si no puedes pagarlo ahora con tu ahorro, plantéate esperar, buscar una opción más barata o ahorrar la cuota cada mes hasta reunir el importe: así no pagas intereses.';
  }},
  {k:['estaf','chiringuito','garantizad','fraude','piramid','cnmv','engano'],a:function(){return tipText(6)+' Si alguien te presiona para decidir rápido, es una señal de alarma.'}},
  {k:['invert','inversi','bolsa','accion'],a:"Los conceptos básicos son que a más rentabilidad esperada hay más riesgo, que conviene diversificar, vigilar las comisiones e invertir solo dinero que no vayas a necesitar pronto. Antes de eso suele ser sensato tener un colchón de emergencia. Desconfía de lo que prometa ganancias seguras, comprueba que la entidad esté autorizada por la CNMV y, para decisiones concretas, habla con un profesional independiente. No puedo recomendarte productos."},
  {k:['etf','indexad','fondo indexado','fondos','cartera'],a:"Un fondo indexado o un ETF reparte tu dinero entre muchos valores para copiar un índice, como un mercado entero. Así diversificas sin elegir empresas una a una, y suelen tener comisiones más bajas que los fondos de gestión activa. Aun así tienen riesgo: pueden bajar, a veces mucho, y se piensan a largo plazo. Mira siempre las comisiones y el nivel de riesgo. Esto es información general, no una recomendación de ningún producto."},
  {k:['cripto','bitcoin','ethereum','nft','bitcoin es','comprar bitcoin','invertir en cripto','invertir en bitcoin','criptomoneda'],a:"Las criptomonedas son muy volátiles: pueden multiplicar su valor o perder casi todo en poco tiempo, y alrededor de ellas hay muchas estafas y promesas de ganancias fáciles. Si algún día te interesan, usa solo dinero que podrías perder sin que te afecte, nunca el colchón ni lo que necesitas para vivir, y desconfía de quien te prometa rentabilidad segura. La CNMV publica avisos sobre este tema."},
  {k:['tae','tin','nominal'],a:"El TIN es el interés nominal que anuncia una entidad, sin tener en cuenta comisiones ni cada cuánto se pagan los intereses. La TAE sí lo incluye, y por eso sirve para comparar productos distintos, tanto lo que te dan por un depósito como lo que te cobran por un préstamo o una tarjeta. Si dos ofertas tienen distinto TIN, compáralas siempre por su TAE."},
  {k:['seguridad','clave','contrasena','phishing','sms','bizum','cvv','robo','hackeo','enlace'],a:"Desconfía de cualquier mensaje con prisa que te pida claves, códigos o que hagas una transferencia o un Bizum: tu banco no te pedirá contraseñas ni códigos por mensaje o por enlace. No compartas el CVV de la tarjeta ni los códigos que te llegan por SMS, entra en tu banca desde la app oficial o escribiendo tú la dirección, y activa los avisos de movimientos. Si dudas, llama al teléfono que figura en la web oficial o en el reverso de tu tarjeta."},
  {k:['impuesto','hacienda','irpf','declaracion de la renta','nomina','iva','sueldo','seguridad social','cotiz'],a:"En una nómina, lo que cobras (el neto) es menos que lo que figura como bruto, porque se retiene IRPF, que es un adelanto del impuesto sobre la renta, y se cotiza a la Seguridad Social. Si empiezas a ganar dinero por tu cuenta, con proyectos, clases o ventas, puede haber obligaciones fiscales según lo que ingreses y cómo. Lo más seguro es preguntar a la Agencia Tributaria o a una gestoría antes de que el dinero empiece a entrar."},
  {k:['ingres','ganar dinero','trabajo','proyecto','autonomo','freelance','vender','emprend'],a:function(){
    return 'Una sección fija para tus proyectos te permite probar ideas sin tocar el ahorro. Empieza con gastos pequeños y comprueba si el proyecto devuelve lo que cuesta antes de invertir más. '+tipText(7);
  }},
  {k:['presupuesto','50/30','regla','organizar','reparto','repartir','mensual'],a:"La regla 50/30/20 es un buen punto de partida: 50 % para necesidades, 30 % para deseos y 20 % para ahorro. El método es repartir el dinero el día que lo recibes, apuntar los gastos y revisar cada semana. Con poco dinero las proporciones cambian y no pasa nada: lo importante es que cada euro tenga un destino."},
  {k:['objetivo','meta de ahorro','ahorrar para','quiero comprar','comprar un','comprarme'],a:"Para una compra concreta, divide el precio entre los meses que estés dispuesto a esperar: eso es lo que tienes que apartar cada mes. Por ejemplo, 360 euros en 12 meses son 30 al mes. Compara con lo que cuesta pagarlo a plazos, intereses incluidos, y mira si hay una versión más barata, reacondicionada o de segunda mano con garantía. Tenerlo apartado antes de comprar te evita deuda y te deja esperar a una buena oferta."},
  {k:['impulsiv','antojo','arrepent','ofertas','rebajas','black friday'],a:"Una regla sencilla es esperar 24 horas antes de cualquier compra que no estuviera prevista: si pasado el día todavía la quieres, es más probable que sea una buena compra. Apunta lo que te apetece en una lista en vez de comprarlo en el momento, compara precios y ten cuidado con las rebajas, que a veces animan a comprar cosas que no necesitabas solo porque están más baratas."},
  {k:['suscripci','netflix','spotify','streaming','domicili'],a:"Revisa una vez al mes lo que se te cobra por suscripciones: series, música, apps o gimnasio. Cancela las que no hayas usado en las últimas semanas y apunta en el calendario las renovaciones anuales para que no te pillen por sorpresa. Si de verdad las usas, comprueba si hay planes para estudiantes o de pago anual más baratos."},
  {k:['prestar','prestame','prestado','preste','me debe dinero','me deben dinero','dinero a un amigo'],a:"Presta solo lo que podrías perder sin que se resienta tu mes, y piensa en ello como un regalo que quizá te devuelvan. Si lo haces, acordad la cantidad y las fechas de devolución por escrito, aunque sea en un mensaje, para evitar malentendidos. Si quien pide prestado eres tú, haz lo mismo y mete la devolución dentro de tu reparto."},
  {k:['alquiler','piso','vivienda','hipoteca','independizar','emancipar'],a:"Una pauta muy usada es que el alquiler o la hipoteca no supere alrededor de un tercio de tus ingresos netos, aunque en muchas ciudades es difícil cumplirla. Además del alquiler cuentan los suministros, internet, la comunidad si la hay y la fianza inicial, que suele ser un mes de renta, y a veces piden garantías extra. Antes de independizarte, haz un presupuesto con todos los gastos fijos y comprueba que te queda margen para ahorrar."},
  {k:['seguro','poliza','aseguradora','cobertura'],a:"Un seguro sirve para cubrir riesgos que no podrías pagar de golpe, como un accidente, una responsabilidad civil o un robo grande, y no para cada pequeño gasto. Compara coberturas y franquicias, no solo el precio, y lee qué excluye antes de contratar. Revisa cada año si sigues necesitando lo que pagas."},
  {k:['pension','jubilacion','retiro','largo plazo'],a:"A los 18 la jubilación queda lejos, pero cuanto antes se ahorra para el largo plazo, más tiempo trabaja el interés compuesto. Hay productos pensados para ello, como los planes de pensiones o los fondos, pero sus condiciones, comisiones y ventajas fiscales cambian con el tiempo, así que antes de contratar nada infórmate en fuentes oficiales o con un profesional independiente. De momento, tu mejor inversión es el hábito de ahorrar y un colchón."},
  {k:['beca','estudiante','universidad','matricula','descuento'],a:"Si estudias, mira las becas y ayudas que convoquen el Ministerio de Educación, tu comunidad autónoma y tu universidad: los plazos y requisitos cambian cada curso, así que consulta las convocatorias vigentes en la secretaría de tu facultad. Muchos servicios ofrecen descuentos con el carné de estudiante, desde transporte hasta software y suscripciones."},
  {k:['sobres','efectivo','metalico','hucha'],a:"El método de los sobres consiste en separar el dinero por secciones, antes con billetes y hoy también con cuentas o huchas distintas, y gastar cada sección solo de su sobre. Cuando el sobre de ocio se vacía, no se gasta más. Es justo lo que hace esta app con tus secciones, y funciona mejor si el ahorro vive en un sitio aparte que no veas a diario."},
  {k:['habito','constancia','disciplina','motivacion','no cumplo','fallo'],a:"Los hábitos de dinero se construyen con rutinas pequeñas y repetidas más que con grandes propósitos: reparte el día 1, apunta los gastos en el momento y revisa los domingos. Si un mes te pasas, no lo tires todo: mira qué sección falló, ajusta el mes siguiente y sigue. Un mes que sale mal enseña más que no haber llevado ninguna cuenta."},
  {k:['estres','emocional','aburrimiento','agobio','agobia'],a:"Gastar para animarse es muy común. Si notas que compras más cuando estás aburrido, estresado o triste, prueba a poner una pausa de 24 horas antes de comprar y a tener a mano alternativas gratis o baratas que te sienten igual de bien. Si el dinero te agobia de verdad, hablarlo con alguien de confianza también ayuda."},
  {k:['cuenta corriente','cuenta bancaria','cuenta remunerada','cuentas','banco','comision','deposito'],a:"Al elegir cuenta, compara las comisiones de mantenimiento, de tarjeta y de transferencias: hay cuentas sin comisiones y no hace falta pagar por tener tu dinero guardado. Las cuentas remuneradas y los depósitos dan un interés, que debes comparar por su TAE, y en entidades españolas están garantizados hasta 100.000 euros por titular y entidad. Fíjate también en las condiciones que te piden para no pagar comisiones."},
  {k:['inflacion','poder adquisitivo','precios'],a:function(){return tipText(5)}},
  {k:['interes compuesto','compuesto','intereses'],a:function(){return tipText(4)}},
  {k:['hola','buenas','buenos dias','buenas tardes','hey','que tal'],a:"¡Hola! Soy la guía de esta app. Puedo darte pautas sobre ahorro, gastos de ocio, tarjetas y pagar a plazos, inversión, impuestos, seguridad, becas, vivienda y más. Prueba con una pregunta concreta, como «¿cuánto debería ahorrar?»."},
  {k:['gracias','te lo agradezco','adios','hasta luego','chao'],a:"¡De nada! Si te surge otra duda, pregúntame cuando quieras."},
  {k:['que sabes','que puedes','temas','de que puedes','que te puedo preguntar','que preguntas'],a:function(){
    var gs=[];KB.forEach(function(e){if(e.g&&gs.indexOf(e.g)<0)gs.push(e.g)});
    return 'Puedo orientarte sobre '+KB.filter(function(e){return e.q}).length+' temas: '+gs.join(', ').toLowerCase()+'. Abre «Ver todos los temas», debajo de las sugerencias, para ver todas las preguntas y tocar la que quieras.';
  }},
];
/* Grupo y pregunta de ejemplo de los temas de siempre (para «Ver todos los temas»), por su primera palabra clave. */
var KBQ={ahorr:['Ahorro','¿Cuánto debería ahorrar?'],'cuenta de ahorro':['Ahorro','¿Qué es una cuenta de ahorro?'],ocio:['Gastos del día a día','¿Cómo gasto menos en ocio?'],
  tarjeta:['Bancos y pagos','¿Qué diferencia hay entre débito, crédito y prepago?'],plazo:['Deudas y crédito','¿Merece la pena pagar a plazos?'],
  estaf:['Seguridad y riesgos','¿Cómo evito estafas al invertir?'],invert:['Inversión','¿Por dónde empiezo a invertir?'],etf:['Inversión','¿Qué es un fondo indexado o un ETF?'],
  cripto:['Inversión','¿Debería comprar criptomonedas?'],tae:['Ahorro','¿Qué es la TAE y el TIN?'],seguridad:['Seguridad y riesgos','¿Cómo protejo mis claves y mi banca?'],
  impuesto:['Trabajo e impuestos','¿Por qué cobro menos de lo que pone mi nómina?'],ingres:['Trabajo e impuestos','¿Cómo gano un dinero extra con proyectos?'],
  presupuesto:['Gastos del día a día','¿Qué es la regla 50/30/20?'],objetivo:['Ahorro','¿Cómo ahorro para comprarme algo?'],impulsiv:['Consumo y compras','¿Cómo evito las compras impulsivas?'],
  suscripci:['Gastos del día a día','¿Cómo controlo mis suscripciones?'],prestar:['Vida y relaciones','¿Debería prestar dinero a un amigo?'],alquiler:['Vivienda','¿Cuánto debería gastar en vivienda?'],
  seguro:['Seguridad y riesgos','¿Para qué sirve un seguro?'],pension:['Inversión','¿Debería pensar ya en mi jubilación?'],beca:['Trabajo e impuestos','¿Qué becas y descuentos hay para estudiantes?'],
  sobres:['Gastos del día a día','¿Qué es el método de los sobres?'],habito:['Vida y relaciones','¿Cómo mantengo el hábito de ahorrar?'],estres:['Vida y relaciones','¿Por qué gasto más cuando estoy mal?'],
  'cuenta corriente':['Bancos y pagos','¿Qué miro al elegir una cuenta del banco?'],inflacion:['Ahorro','¿Qué es la inflación?'],'interes compuesto':['Ahorro','¿Qué es el interés compuesto?']};
KB.forEach(function(e){var m=KBQ[e.k[0]];if(m){e.g=m[0];e.q=m[1]}});
/* Los temas de guia.js van primero: son más concretos y ganan en caso de empate. */
KB=(window.GUIA||[]).concat(KB);
KB.forEach(function(e){e.re=e.k.map(kwRegex)});
function guideAnswer(q){
  var n=norm(q),best=null,bs=0;
  KB.forEach(function(e){
    var sc=0;
    /* Pesan más las expresiones de varias palabras y las palabras largas, que son más específicas. */
    e.re.forEach(function(r,i){if(r.test(n)){var w=e.k[i];sc+=w.indexOf(' ')>=0?2.5:(w.length>=7?1.5:1)}});
    if(sc>bs){bs=sc;best=e}
  });
  if(!best)return 'Eso no lo tengo en la guía integrada. Prueba a decirlo con otras palabras o abre «Ver todos los temas», debajo de las sugerencias: ahí están todas las preguntas que sé responder. También puedes repasar los consejos de arriba.';
  return typeof best.a==='function'?best.a():best.a;
}
function ctxText(){
  var A=state.alloc,s=sums(state.cache[nowYM]||[]);
  return 'Dinero mensual del usuario: '+fmt(state.total)+'. Reparto y gasto de este mes: '+CATS.map(function(c){
    return String(cname(c.id)).replace(/[\r\n]+/g,' ')+' '+fmt(A[c.id])+' (llevan '+fmt(s[c.id])+')';
  }).join('; ')+'.';
}
/* Solo las últimas preguntas y respuestas de esta conversación (como mucho 6) y la pregunta nueva. */
function buildMessages(q){
  var prev=state.chat.slice(0,-2).filter(function(m){return m.ok&&m.text}).slice(-6);
  while(prev.length&&prev[0].role!=='user')prev.shift();
  var msgs=prev.map(function(m){return {role:m.role,content:m.text}});
  msgs.push({role:'user',content:q});
  return msgs;
}
function aiHost(){try{return new URL(AI_ENDPOINT,location.href).host}catch(e){return 'un servicio externo'}}
function renderAIMode(){
  var t,c=aiConsent();
  if(aiMode==='endpoint')t='Te responde un asistente de IA externo ('+aiHost()+'). Antes de enviar nada te diremos qué sale de tu dispositivo.';
  else t='Te responde la guía integrada. No es una IA y no envía nada fuera de tu dispositivo.';
  $('#aiMode').textContent=t;
  $('#shareRow').hidden=(aiMode==='guide');
  $('#aiForget').hidden=!(aiMode==='endpoint'&&c);
}
function initAI(){
  aiMode=AI_ENDPOINT?'endpoint':'guide';
  renderAIMode();
}

/* ---------- consentimiento antes de enviar datos a un servicio externo ---------- */
function aiConsent(){var c=null;try{c=JSON.parse(lsGet('aiConsent')||'null')}catch(e){}return c&&c.ok?c:null}
var consentResolve=null;
/* Devuelve una promesa con {send, share} o null si el usuario cancela. Si eligió «recordar», no vuelve a preguntar. */
function askConsent(wantShare){
  var c=aiConsent();
  if(c)return Promise.resolve({send:true,share:wantShare&&c.share});
  $('#cs-host').textContent=aiHost();
  $('#cs-ctx').hidden=!wantShare;$('#cs-ctxText').textContent=wantShare?ctxText():'';
  $('#cs-noshare').hidden=!wantShare;
  $('#cs-remember').checked=false;
  openSheet('aiConsent');
  return new Promise(function(res){consentResolve=res});
}
function finishConsent(r){
  if(r&&$('#cs-remember').checked)lsSet('aiConsent',JSON.stringify({ok:true,share:r.share,at:Date.now()}));
  var f=consentResolve;consentResolve=null;closeSheet('aiConsent');renderAIMode();
  if(f)f(r);
}
function renderChat(){
  var box=$('#chat');
  if(!state.chat.length){
    box.innerHTML='<p class="fine">Aquí aparecerán tus preguntas y las respuestas. Prueba con una sugerencia o escribe la tuya.</p>';
    return;
  }
  box.innerHTML='';
  state.chat.forEach(function(m){
    var d=document.createElement('div');
    d.className='bubble '+(m.role==='user'?'me':'bot');
    var p=document.createElement('p');
    p.textContent=m.text||(m.pending?'Pensando…':'');
    d.appendChild(p);
    if(m.role==='assistant'&&m.src&&!m.pending){
      var s=document.createElement('span');
      s.className='src';
      s.textContent=m.src==='IA'?'Respuesta de la IA':'Respuesta de la guía integrada';
      d.appendChild(s);
    }
    box.appendChild(d);
  });
  box.scrollTop=box.scrollHeight;
}
async function ask(q){
  q=String(q||'').trim().slice(0,400);
  if(!q||state.asking)return;
  /* Con un servicio externo, nada sale del dispositivo sin consentimiento. */
  var share=false;
  if(aiMode==='endpoint'){
    var ok=await askConsent($('#shareCtx').checked);
    if(!ok){$('#askInput').value=q;return}
    share=ok.share;
  }
  state.asking=true;$('#askBtn').disabled=true;
  state.chat.push({role:'user',text:q,ok:true});
  var bot={role:'assistant',text:'',src:'',pending:true,ok:false};
  state.chat.push(bot);renderChat();
  try{
    if(aiMode==='endpoint'){
      bot.src='IA';
      var ctrl=new AbortController(),to=setTimeout(function(){ctrl.abort()},30000);
      try{
        var r=await fetch(AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',
          body:JSON.stringify({messages:buildMessages(q),context:share?ctxText():''}),signal:ctrl.signal});
        if(r.status===429)throw {code:'rate_limited'};
        if(!r.ok)throw new Error('http '+r.status);
        var j=await r.json();
        bot.text=String((j&&j.text)||'').slice(0,4000);
        if(!bot.text)throw new Error('empty');
        bot.ok=true;
      }finally{clearTimeout(to)}
    }else{
      bot.src='Guía';bot.text=guideAnswer(q);
    }
  }catch(err){
    bot.ok=false;
    if(err&&err.code==='rate_limited'){bot.src='';bot.text='Has hecho muchas preguntas seguidas. Espera un poco y vuelve a intentarlo.'}
    else{
      bot.src='Guía';
      bot.text='La IA no está disponible ahora. Esto dice la guía integrada:\n\n'+guideAnswer(q);
    }
  }
  bot.pending=false;state.asking=false;$('#askBtn').disabled=false;renderChat();
}
var CHIPS=['¿Cuánto debería ahorrar?','¿Qué hago con mi primer sueldo?','¿Cómo salgo de mis deudas?','¿Cómo ahorro en la compra del supermercado?','¿Por dónde empiezo a invertir?','¿Qué es la TAE?','¿Cómo evito estafas?','¿Tengo que hacer la declaración de la renta?'];
function renderChips(){
  $('#chips').innerHTML=CHIPS.map(function(q,i){return '<button class="chip-btn" type="button" data-q="'+i+'">'+esc(q)+'</button>'}).join('');
}
$('#chips').addEventListener('click',function(e){
  var b=e.target.closest('[data-q]');
  if(b)ask(CHIPS[+b.getAttribute('data-q')]);
});
/* «Ver todos los temas»: las preguntas de ejemplo de la guía, por grupos. Al tocar una, se pregunta. */
var TOPICS=KB.filter(function(e){return e.q});
function renderTopics(){
  var groups=[];
  TOPICS.forEach(function(e){if(groups.indexOf(e.g)<0)groups.push(e.g)});
  $('#topicsSum').textContent='Ver todos los temas ('+TOPICS.length+')';
  $('#topicList').innerHTML=groups.map(function(g){
    return '<h3>'+esc(g)+'</h3><div class="chips">'+TOPICS.map(function(e,i){
      return e.g===g?'<button class="chip-btn" type="button" data-tq="'+i+'">'+esc(e.q)+'</button>':'';
    }).join('')+'</div>';
  }).join('');
}
$('#topicList').addEventListener('click',function(e){
  var b=e.target.closest('[data-tq]');if(!b)return;
  ask(TOPICS[+b.getAttribute('data-tq')].q);
  $('#chat').scrollIntoView({block:'nearest'});
});
$('#askForm').addEventListener('submit',function(e){
  e.preventDefault();
  if(state.asking)return;
  var v=$('#askInput').value;
  if(!v.trim())return;
  $('#askInput').value='';
  ask(v);
});
$('#askInput').addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#askForm').requestSubmit()}
});

function setBackupMsg(t,ok){var m=$('#backupMsg');m.textContent=t;m.className='msg'+(ok?' okmsg':'')}
$('#copyData').addEventListener('click',function(){
  var box=$('#dataBox');box.value=JSON.stringify(exportAll());
  function done(){markBackup();setBackupMsg('Datos copiados. Pégalos en el otro dispositivo y pulsa Restaurar.',true)}
  function fail(){box.focus();box.select();setBackupMsg('No se pudo copiar solo. Copia a mano el texto seleccionado.',false)}
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(box.value).then(done,fail);
    else fail();
  }catch(e){fail()}
});
$('#restoreData').addEventListener('click',function(){
  var r=importAll($('#dataBox').value);
  if(!r.ok)setBackupMsg(r.error+' Pega el texto que copiaste con «Copiar mis datos».',false);
  else setBackupMsg(importSummary(r),true);
});

/* ---------- hojas: ajustes y copia de seguridad ---------- */
var sheetFrom={};
function openSheet(id){
  sheetFrom[id]=document.activeElement;
  $('#'+id).hidden=false;
  var c=$('#'+id+' [data-close]');if(c)c.focus();
}
function closeSheet(id){
  $('#'+id).hidden=true;
  var f=sheetFrom[id];if(f&&f.focus&&document.contains(f))f.focus();
}
$('#aiConsent').addEventListener('click',function(e){
  var b=e.target.closest('[data-cs]');
  if(e.target===this||(b&&b.getAttribute('data-cs')==='cancel')){finishConsent(null);return}
  if(!b)return;
  finishConsent({send:true,share:b.getAttribute('data-cs')==='send'&&!$('#cs-ctx').hidden});
});
$('#aiForget').addEventListener('click',function(){lsSet('aiConsent','null');renderAIMode();toast('Te volveremos a preguntar antes de enviar nada.',false)});
['settings','backup','installHelp'].forEach(function(id){
  $('#'+id).addEventListener('click',function(e){if(e.target===this||e.target.closest('[data-close]'))closeSheet(id)});
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(!$('#aiConsent').hidden){e.preventDefault();finishConsent(null);return}
  ['installHelp','backup','settings'].some(function(id){if(!$('#'+id).hidden){e.preventDefault();closeSheet(id);return true}});
});

/* ---------- instalar la app ----------
   Chrome y Edge avisan con beforeinstallprompt; iPhone y iPad no, así que allí se explican los pasos.
   Si ya está instalada, o el navegador no deja instalarla, el botón no sale. */
var installEvt=null;
var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
var standaloneMQ=window.matchMedia?window.matchMedia('(display-mode: standalone)'):null;
function isInstalled(){return !!(standaloneMQ&&standaloneMQ.matches)||navigator.standalone===true}
function renderInstall(){$('#installBtn').hidden=isInstalled()||!(installEvt||isIOS)}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();installEvt=e;renderInstall()});
window.addEventListener('appinstalled',function(){
  installEvt=null;$('#installBtn').hidden=true;
  toast('Listo: ya tienes Mi dinero en tu pantalla de inicio.',false,'ok');
});
if(standaloneMQ){if(standaloneMQ.addEventListener)standaloneMQ.addEventListener('change',renderInstall);else if(standaloneMQ.addListener)standaloneMQ.addListener(renderInstall)}
$('#installBtn').addEventListener('click',function(){
  if(installEvt){
    /* El aviso del navegador solo se puede abrir una vez por evento. */
    var ev=installEvt;installEvt=null;
    ev.prompt();
    Promise.resolve(ev.userChoice).then(function(r){
      if(r&&r.outcome==='accepted')$('#installBtn').hidden=true;
      else{renderInstall();toast('Sin problema. Puedes instalarla cuando quieras desde el menú del navegador.',false)}
    },renderInstall);
    return;
  }
  if(isIOS&&!isInstalled())openSheet('installHelp');
});
renderInstall();

/* ajustes de aspecto */
var AP=window.appPrefs;
function renderSettingsSheet(){
  $('#swatches').innerHTML=Object.keys(AP.ACCENTS).map(function(k){
    var a=AP.ACCENTS[k];
    return '<button class="swatch" type="button" data-accent="'+k+'" aria-pressed="'+(prefs.accent===k)+'"><i style="background:'+a.l+'"></i>'+esc(a.n)+'</button>';
  }).join('');
  $('#fontopts').innerHTML=Object.keys(AP.FONTS).map(function(k){
    var f=AP.FONTS[k];
    return '<button class="fontopt" type="button" data-font="'+k+'" aria-pressed="'+(prefs.font===k)+'" style="font-family:'+f.f.replace(/"/g,'&quot;')+',system-ui,sans-serif"><b>Aa 123 €</b><span>'+esc(f.n)+'</span></button>';
  }).join('');
  document.querySelectorAll('[data-theme-opt]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-theme-opt')===prefs.theme))});
  $('#set-protect').checked=prefs.protectSavings;
}
function savePrefs(){AP.apply();AP.save();renderSettingsSheet()}
$('#openSettings').addEventListener('click',function(){

  renderSettingsSheet();openSheet('settings');
});
$('#settings').addEventListener('click',function(e){
  var b;
  if((b=e.target.closest('[data-accent]'))){prefs.accent=b.getAttribute('data-accent');savePrefs();return}
  if((b=e.target.closest('[data-font]'))){prefs.font=b.getAttribute('data-font');savePrefs();return}
  if((b=e.target.closest('[data-theme-opt]'))){prefs.theme=b.getAttribute('data-theme-opt');savePrefs();return}
  if(e.target.closest('#setToBackup')){closeSheet('settings');openBackup()}
});
$('#set-protect').addEventListener('change',function(){prefs.protectSavings=this.checked;AP.save();renderCats()});

/* copia de seguridad: descargar, importar y recordatorio cada 30 días */
var DAY=86400000,BK_EVERY=30*DAY;
function bkMeta(){
  var m=null;try{m=JSON.parse(lsGet('backup')||'null')}catch(e){}
  m=(m&&typeof m==='object')?m:{};
  return {last:num(m.last)?m.last:null,first:num(m.first)?m.first:null,snooze:num(m.snooze)?m.snooze:null};
}
function setBkMeta(m){lsSet('backup',JSON.stringify(m))}
function markBackup(){var m=bkMeta();m.last=Date.now();setBkMeta(m);renderBkBanner()}
function renderBkBanner(){
  var m=bkMeta(),ref=Math.max(m.last||m.first||Date.now(),m.snooze||0);
  $('#bkBanner').hidden=!(lsGet('plan')!==null&&Date.now()-ref>=BK_EVERY);
}
function renderBkLast(){
  var m=bkMeta(),t;
  if(!m.last)t='Aún no has descargado ninguna copia.';
  else{
    var d=Math.floor((Date.now()-m.last)/DAY);
    t='Última copia: '+(d<1?'hoy':d===1?'ayer':'hace '+d+' días')+'.';
  }
  $('#bkLast').textContent=t;
}
function openBackup(){$('#bkMsg').textContent='';$('#bkMsg').className='msg';renderBkLast();renderBkExtra();openSheet('backup')}
function downloadFile(name,text,type){
  try{
    var blob=new Blob([text],{type:type});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    return true;
  }catch(e){return false}
}
function downloadBackup(){
  var ok=downloadFile('presupuesto-copia-'+todayStr+'.json',JSON.stringify(exportAll()),'application/json');
  if(ok)markBackup();
  return ok;
}
/* Todos los gastos de todos los meses, del más antiguo al más reciente. */
function downloadCSV(){
  var rows=[];
  allMonthKeys().sort().forEach(function(ym){
    loadMonth(ym);
    state.cache[ym].slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0}).forEach(function(e){
      rows.push({date:e.date,section:cname(e.cat),note:e.note||'',amt:e.amt,fixed:!!e.fixed});
    });
  });
  return downloadFile('presupuesto-gastos-'+todayStr+'.csv',Calc.expensesCSV(rows),'text/csv;charset=utf-8')?rows.length:-1;
}
/* Estado del almacenamiento persistente y de la copia del formato anterior. */
function renderBkExtra(){
  var p=$('#bkPersist');p.textContent='';
  if(navigator.storage&&navigator.storage.persisted){
    navigator.storage.persisted().then(function(on){
      p.textContent=on?'🔒 Este navegador protege tus datos: no los borrará aunque se quede sin espacio.'
        :'El navegador podría borrar tus datos si se queda sin espacio. Por eso conviene tener una copia.';
    }).catch(function(){});
  }
  var meta=migration.meta,keys=meta&&meta.originalKeys,left=keys?keys.filter(function(k){return rawGet(k)!=null}):[];
  $('#bkOld').hidden=!left.length;
  if(left.length){
    $('#bkOldText').textContent='El '+new Date(meta.migratedAt).toLocaleDateString('es-ES')+' tus datos se pasaron al formato nuevo, en céntimos para que las cuentas cuadren siempre. '+
      'Guardamos aparte una copia del formato anterior por si algo hubiera salido mal. Cuando compruebes que todo está bien, puedes borrarla.';
    $('#bkOldBtns').hidden=false;$('#bkOldConfirm').hidden=true;
  }
}
/* Pide al navegador que no borre los datos por falta de espacio. Solo cuando ya hay datos que proteger. */
function askPersist(){
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(function(){})}catch(e){}
}
$('#bkCsv').addEventListener('click',function(){
  var n=downloadCSV(),m=$('#bkMsg');
  m.className='msg'+(n<0?'':' okmsg');
  m.textContent=n<0?'No se pudo crear el archivo.':'Archivo para Excel descargado con '+plural(n,'gasto','gastos')+'.';
});
$('#bkOldDownload').addEventListener('click',function(){
  downloadFile('presupuesto-formato-anterior-'+todayStr+'.json',JSON.stringify(originalRaw(),null,1),'application/json');
});
$('#bkOldDelete').addEventListener('click',function(){$('#bkOldBtns').hidden=true;$('#bkOldConfirm').hidden=false;$('#bkOldNo').focus()});
$('#bkOldNo').addEventListener('click',function(){$('#bkOldBtns').hidden=false;$('#bkOldConfirm').hidden=true});
$('#bkOldYes').addEventListener('click',function(){
  (migration.meta.originalKeys||[]).forEach(function(k){try{window.localStorage.removeItem(k)}catch(e){}});
  migration.meta.originalRemovedAt=Date.now();lsSet('meta',JSON.stringify(migration.meta));
  renderBkExtra();toast('Copia del formato anterior borrada. Tus datos actuales siguen igual.',false);
});
$('#migDownload').addEventListener('click',function(){
  downloadFile('presupuesto-datos-originales-'+todayStr+'.json',JSON.stringify(originalRaw(),null,1),'application/json');
});
$('#openBackup').addEventListener('click',openBackup);
$('#bkDownload').addEventListener('click',function(){
  var ok=downloadBackup(),m=$('#bkMsg');
  m.className='msg'+(ok?' okmsg':'');
  m.textContent=ok?'Copia descargada. Guárdala en un sitio seguro.':'No se pudo descargar. Prueba con «Copiar mis datos» en la pestaña Resumen.';
  renderBkLast();
});
$('#bkImport').addEventListener('click',function(){$('#bkFile').value='';$('#bkFile').click()});
$('#bkFile').addEventListener('change',function(){
  var f=this.files&&this.files[0],m=$('#bkMsg');if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var r=importAll(String(rd.result||''));
    m.className='msg'+(r.ok?' okmsg':'');
    m.textContent=r.ok?importSummary(r):r.error;
  };
  rd.onerror=function(){m.className='msg';m.textContent='No se pudo leer el archivo.'};
  rd.readAsText(f);
});
$('#bkNow').addEventListener('click',function(){if(downloadBackup())toast('Copia descargada. Guárdala en un sitio seguro.',false,'ok');else toast('No se pudo descargar la copia. Ábrela desde 💾 Copia y prueba otra vez.',false,'error')});
$('#bkLater').addEventListener('click',function(){var m=bkMeta();m.snooze=Date.now();setBkMeta(m);renderBkBanner()});

runMigration();
var fresh=isNewUser();
(function(){var m=bkMeta();if(!m.first){m.first=Date.now();setBkMeta(m)}})();
loadPlan();loadMonth(state.ym);
var autoFixed=applyFixed(nowYM);
setDateBounds();renderSettings();getFired(nowYM);
if(autoFixed)checkAlerts(nowYM,true);
renderAll();
renderBkBanner();
$('#migBanner').hidden=migration.status!=='error';
if(!fresh)askPersist();
if(migration.status==='migrated')toast('Hemos actualizado cómo se guardan tus datos. Todo sigue igual y la copia anterior se conserva.',false);
if(fresh){$('#fab').hidden=true;$('#onboard').hidden=false;$('#onb-amt').focus()}
else if(autoFixed)toast(autoFixed===1?'Se ha apuntado 1 gasto fijo de este mes.':'Se han apuntado '+autoFixed+' gastos fijos de este mes.',false);renderTipGrid();renderChips();renderTopics();renderChat();renderAIMode();initAI();
})();

/* Para que funcione sin conexión. */
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})});
}
