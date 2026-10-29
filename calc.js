/* Cálculos puros de la app. Todos los importes van en céntimos (números enteros): así las sumas cuadran siempre.
   No tocan la página ni el almacenamiento; se prueban en tests.html. */
(function(root){
'use strict';

var EUR=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});

/* Céntimos → «7,50 €». Solo se convierte a euros al mostrar. */
function formatEUR(c){
  var n=Math.round(Number(c)||0);
  return EUR.format(n/100);
}

/* Céntimos → texto para un campo: «7,5» se escribe «7,50» y «12,00» se queda en «12». */
function toInputString(c){
  var n=Math.round(Number(c)||0),s=(Math.abs(n)/100).toFixed(2).replace('.',',');
  if(s.slice(-3)===',00')s=s.slice(0,-3);
  return (n<0?'-':'')+s;
}

/* Texto escrito por el usuario → céntimos, o null si no es un importe válido.
   Acepta coma o punto: «7,50», «7.5», «1.234,56», «1,234.56», «1.000». No acepta negativos ni letras.
   El último separador es decimal si le siguen 1 o 2 cifras; si le siguen 3, todos son de miles. */
function parseAmount(str){
  if(str==null)return null;
  var s=String(str).replace(/[\s €]/g,'');
  if(s===''||!/^[0-9.,]+$/.test(s)||!/[0-9]/.test(s))return null;
  var last=Math.max(s.lastIndexOf(','),s.lastIndexOf('.')),ent=s,dec='';
  if(last>=0){
    var after=s.slice(last+1);
    if(after.length<=2){ent=s.slice(0,last);dec=after}
    else if(after.length!==3)return null;
  }
  ent=ent.replace(/[.,]/g,'');
  if(ent==='')ent='0';
  if(ent.length>9)return null;
  return parseInt(ent,10)*100+parseInt((dec+'00').slice(0,2),10);
}

function daysInMonth(y,m){return new Date(y,m,0).getDate()}

/* Suma de una lista de céntimos. */
function sum(list){
  var t=0;for(var i=0;i<list.length;i++)t+=Math.round(list[i]||0);
  return t;
}

/* Cuánto falta (positivo) o sobra (negativo) para que el reparto sume el dinero del mes. */
function allocationDiff(totalC,alloc){
  var s=0;Object.keys(alloc).forEach(function(k){s+=Math.round(alloc[k]||0)});
  return {sum:s,diff:Math.round(totalC)-s};
}

/* Estado del reparto y el mensaje que lo explica. kind: 'empty' (no hay dinero del mes), 'exact', 'short' (falta) u 'over' (sobra).
   opts.totalChanged: el aviso sale porque se acaba de cambiar el dinero del mes, y se dice. */
function splitStatus(totalC,alloc,opts){
  var c=allocationDiff(totalC,alloc),t=Math.round(totalC)||0,f=formatEUR,out={sum:c.sum,diff:c.diff};
  var why=opts&&opts.totalChanged?'El dinero del mes ahora es '+f(t)+'. ':'';
  if(!(t>0)){out.kind='empty';out.text='Escribe cuánto dinero tienes este mes para comprobar el reparto.'}
  else if(c.diff===0){out.kind='exact';out.text='Reparto exacto: '+f(c.sum)+' de '+f(t)+'.'}
  else if(c.diff>0){out.kind='short';out.text=why+'Has repartido '+f(c.sum)+' de '+f(t)+'. Te faltan '+f(c.diff)+'.'}
  else{out.kind='over';out.text=why+'Te pasas '+f(-c.diff)+' del dinero del mes: has repartido '+f(c.sum)+' de '+f(t)+'.'}
  return out;
}

/* Propuesta para cuadrar el reparto cambiando solo la sección «key»: de cuánto a cuánto. null si no hace falta o no se puede. */
function fixProposal(totalC,alloc,key){
  if(!key||!(Math.round(totalC)>0))return null;
  var d=allocationDiff(totalC,alloc).diff,from=Math.round(alloc[key]||0),to=from+d;
  if(d===0||to<0)return null;
  return {key:key,from:from,to:to,up:d>0};
}

/* Reparte un total en céntimos según porcentajes, sin perder ni inventar céntimos (resto mayor). */
function splitByPercent(totalC,pcts){
  var keys=Object.keys(pcts),totalP=0,out={},given=0;
  keys.forEach(function(k){totalP+=pcts[k]});
  if(!(totalP>0)){keys.forEach(function(k){out[k]=0});return out}
  var rests=keys.map(function(k){
    var exact=totalC*pcts[k]/totalP,base=Math.floor(exact);
    out[k]=base;given+=base;
    return {k:k,r:exact-base};
  });
  rests.sort(function(a,b){return b.r-a.r});
  for(var i=0;given<totalC;i=(i+1)%rests.length){out[rests[i].k]++;given++}
  return out;
}

/* Reparte un recorte entre varias secciones en proporción a lo que le queda a cada una.
   Nunca recorta más de lo que le queda a una sección; lo que no se pueda cubrir sale en «short». */
function proportionalCuts(amountC,pool){
  var R=sum(pool.map(function(p){return p.rem})),cover=Math.min(Math.max(0,amountC),R),cuts={},given=0;
  pool.forEach(function(p){cuts[p.id]=0});
  if(!(cover>0))return {cuts:cuts,covered:0,short:Math.max(0,amountC-R)};
  var rests=pool.map(function(p){
    var exact=cover*p.rem/R,base=Math.floor(exact);
    cuts[p.id]=base;given+=base;
    return {id:p.id,r:exact-base,room:p.rem-base};
  });
  rests.sort(function(a,b){return b.r-a.r});
  for(var i=0;given<cover&&i<rests.length*2;i++){
    var x=rests[i%rests.length];
    if(cuts[x.id]<pool.filter(function(p){return p.id===x.id})[0].rem){cuts[x.id]++;given++}
  }
  return {cuts:cuts,covered:given,short:Math.max(0,amountC-given)};
}

/* Semana de lunes a domingo, recortada al mes. dow: 0 = domingo … 6 = sábado. */
function weekWindow(day,dow,dim){
  var d0=Math.max(1,day-((dow+6)%7)),d1=Math.min(dim,day+(7-dow)%7);
  return {d0:d0,d1:d1};
}

/* Margen de la semana: lo que quedaba al empezar la semana, repartido por días entre lo que falta de mes,
   menos lo ya gastado esta semana. Se redondea hacia abajo para no prometer céntimos que no hay. */
function weekBudget(leftC,spentWeekC,d0,d1,dim){
  var start=Math.max(0,leftC+spentWeekC),days=d1-d0+1,rest=dim-d0+1;
  var budget=rest>0?Math.floor(start*days/rest):0;
  return {budget:budget,can:budget-spentWeekC};
}

/* Tope semanal de ocio: el ocio del mes repartido en semanas de 7 días. */
function ocioWeeklyCap(ocioC,dim){return dim>0?Math.floor(ocioC*7/dim):0}

/* Interés mensual equivalente a una TAE (en %), descontando impuestos si se pide. */
function monthlyRate(taePct,tax,taxRate){
  var i=Math.pow(1+(taePct||0)/100,1/12)-1;
  return tax?i*(1-(taxRate||0)):i;
}

/* Saldo al final de cada mes: intereses del mes (redondeados al céntimo, como paga un banco) y luego la aportación. */
function projectSavings(depC,months,s0C,i){
  var b=Math.round(s0C||0),pts=[];
  for(var k=1;k<=months;k++){b=b+Math.round(b*(i||0))+Math.round(depC||0);pts.push(b)}
  return pts;
}

/* Meses hasta alcanzar una meta, o null si nunca se llega. */
function monthsToGoal(goalC,depC,s0C,i){
  if(s0C>=goalC)return 0;
  if(!(depC>0)&&!(s0C>0&&i>0))return null;
  var b=s0C;
  for(var k=1;k<=1200;k++){b=b+Math.round(b*(i||0))+depC;if(b>=goalC)return k}
  return null;
}

/* ---------- Formato de los datos guardados y migraciones ----------
   v1: importes en euros con decimales (claves «presupuesto:v1:…»).
   v2: importes en céntimos enteros y campo schemaVersion (claves «presupuesto:v2:…»).
   Un «almacén» es {schemaVersion, plan, months:{'AAAA-MM': {expenses:[…], fixedDone:[…]}}}. */
var SCHEMA=2;
function toCents(v){return (typeof v==='number'&&isFinite(v))?Math.round(v*100):v}
function clone(o){return o==null?o:JSON.parse(JSON.stringify(o))}
var MIGRATIONS={
  /* v1 → v2: euros a céntimos en todos los importes. El resto de campos se copia tal cual. */
  1:function(st){
    var p=clone(st.plan);
    if(p&&typeof p==='object'){
      p.total=toCents(p.total);p.saved0=toCents(p.saved0);p.goal=toCents(p.goal);
      if(p.alloc&&typeof p.alloc==='object')Object.keys(p.alloc).forEach(function(k){p.alloc[k]=toCents(p.alloc[k])});
      if(Array.isArray(p.goals))p.goals.forEach(function(g){if(g&&typeof g==='object'){g.target=toCents(g.target);g.saved=toCents(g.saved)}});
      if(Array.isArray(p.fixed))p.fixed.forEach(function(f){if(f&&typeof f==='object')f.amt=toCents(f.amt)});
      p.schemaVersion=2;
    }
    var ms={};
    Object.keys(st.months||{}).forEach(function(ym){
      var m=clone(st.months[ym])||{};
      if(Array.isArray(m.expenses))m.expenses.forEach(function(e){if(e&&typeof e==='object')e.amt=toCents(e.amt)});
      m.schemaVersion=2;ms[ym]=m;
    });
    return {schemaVersion:2,plan:p,months:ms};
  }
};
/* Lleva un almacén de su versión a la actual, paso a paso. */
function migrateStore(st){
  var cur=clone(st),v=cur&&cur.schemaVersion;
  if(!(v>=1))throw new Error('Versión de datos desconocida');
  if(v>SCHEMA)throw new Error('Datos de una versión más nueva de la app');
  while(v<SCHEMA){
    if(!MIGRATIONS[v])throw new Error('Falta la migración desde la versión '+v);
    cur=MIGRATIONS[v](cur);v=cur.schemaVersion;
  }
  return cur;
}
/* Comprueba que una migración no pierde nada: mismos gastos por mes y mismos totales (en céntimos). */
function verifyMigration(before,after){
  var errs=[];
  Object.keys(before.months||{}).forEach(function(ym){
    var a=((before.months[ym]||{}).expenses)||[],b=((after.months[ym]||{}).expenses)||[];
    if(a.length!==b.length)errs.push(ym+': '+a.length+' gastos antes y '+b.length+' después');
    var sa=0,sb=0;
    a.forEach(function(e){sa+=Math.round((before.schemaVersion===1?e.amt*100:e.amt)||0)});
    b.forEach(function(e){sb+=e.amt||0;if(e.amt!==Math.round(e.amt))errs.push(ym+': importe con decimales en céntimos')});
    if(sa!==sb)errs.push(ym+': la suma cambió ('+sa+' → '+sb+')');
  });
  if(before.plan&&after.plan&&before.schemaVersion===1&&toCents(before.plan.total)!==after.plan.total)errs.push('el dinero del mes cambió');
  return errs;
}
/* Valida una copia de seguridad (archivo JSON) y la devuelve como almacén actual, o explica por qué no vale.
   Acepta las copias antiguas ({v:1}, en euros) y las nuevas ({schemaVersion:2}, en céntimos). */
/* Copia «en bruto» (aviso de error o copia del formato anterior): {raw:{'presupuesto:v2:plan':'…', …}} o las claves sueltas.
   Se reconstruye como copia normal, con el formato nuevo si está y si no con el antiguo. */
function fromRaw(raw){
  function pick(prefix){
    var plan=null,months={},found=false;
    Object.keys(raw).forEach(function(k){
      if(k.indexOf(prefix)!==0)return;
      var rest=k.slice(prefix.length),v;
      try{v=JSON.parse(raw[k])}catch(e){return}
      if(rest==='plan'){plan=v;found=true}
      else if(/^m-\d{4}-\d{2}$/.test(rest)&&v&&typeof v==='object'){months[rest.slice(2)]=v;found=true}
    });
    return found?{plan:plan,months:months}:null;
  }
  var v2=pick('presupuesto:v2:'),v1=pick('presupuesto:v1:');
  if(v2)return {schemaVersion:2,plan:v2.plan,months:v2.months};
  if(v1)return {v:1,plan:v1.plan,months:v1.months};
  return null;
}
function readBackup(obj){
  if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
    var raw=obj.raw&&typeof obj.raw==='object'?obj.raw:(Object.keys(obj).some(function(k){return k.indexOf('presupuesto:')===0})?obj:null);
    if(raw){var conv=fromRaw(raw);if(!conv)return {ok:false,error:'La copia no contiene datos de esta app.'};obj=conv}
  }
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return {ok:false,error:'El archivo no es una copia de esta app.'};
  var v=obj.schemaVersion||(obj.v===1?1:null);
  if(!v)return {ok:false,error:'El archivo no es una copia de esta app.'};
  if(v>SCHEMA)return {ok:false,error:'La copia es de una versión más nueva de la app. Actualiza la página e inténtalo de nuevo.'};
  if(!obj.months||typeof obj.months!=='object'||Array.isArray(obj.months))return {ok:false,error:'A la copia le faltan los meses.'};
  if(obj.plan!=null&&(typeof obj.plan!=='object'||Array.isArray(obj.plan)))return {ok:false,error:'El reparto de la copia está dañado.'};
  var months={},skipped=0,count=0;
  Object.keys(obj.months).forEach(function(ym){
    var src=obj.months[ym],list=Array.isArray(src)?src:(src&&Array.isArray(src.expenses)?src.expenses:null);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)||!list){skipped++;return}
    var ok=list.filter(function(e){
      var good=e&&typeof e==='object'&&typeof e.id==='string'&&typeof e.cat==='string'&&typeof e.amt==='number'&&isFinite(e.amt)&&e.amt>0&&
        typeof e.date==='string'&&e.date.slice(0,7)===ym&&/^\d{4}-\d{2}-\d{2}$/.test(e.date);
      if(!good)skipped++;
      return good;
    });
    count+=ok.length;
    months[ym]={schemaVersion:v,expenses:ok};
  });
  var st;
  try{st=migrateStore({schemaVersion:v,plan:obj.plan||null,months:months})}catch(e){return {ok:false,error:e.message}}
  return {ok:true,store:st,months:Object.keys(months).length,expenses:count,skipped:skipped};
}

/* ---------- CSV para Excel en español: separador «;», coma decimal y UTF-8 con BOM (para que Excel lea bien las tildes) ---------- */
function csvCell(v){
  var s=String(v==null?'':v);
  return /[;"\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function csvAmount(c){return (Math.round(c)/100).toFixed(2).replace('.',',')}
/* rows: [{date:'AAAA-MM-DD', section, note, amt (céntimos), fixed (bool)}] */
function expensesCSV(rows){
  var out=['Fecha;Sección;Concepto;Importe (€);Gasto fijo'];
  rows.forEach(function(r){
    var d=String(r.date||'').split('-');
    out.push([d[2]+'/'+d[1]+'/'+d[0],r.section,r.note,csvAmount(r.amt),r.fixed?'Sí':'No'].map(csvCell).join(';'));
  });
  return '﻿'+out.join('\r\n')+'\r\n';
}

var Calc={formatEUR:formatEUR,expensesCSV:expensesCSV,toInputString:toInputString,parseAmount:parseAmount,daysInMonth:daysInMonth,sum:sum,
  allocationDiff:allocationDiff,splitStatus:splitStatus,fixProposal:fixProposal,splitByPercent:splitByPercent,proportionalCuts:proportionalCuts,weekWindow:weekWindow,
  weekBudget:weekBudget,ocioWeeklyCap:ocioWeeklyCap,monthlyRate:monthlyRate,projectSavings:projectSavings,monthsToGoal:monthsToGoal,
  SCHEMA:SCHEMA,migrateStore:migrateStore,verifyMigration:verifyMigration,readBackup:readBackup};
root.Calc=Calc;
if(typeof module!=='undefined'&&module.exports)module.exports=Calc;
})(typeof window!=='undefined'?window:this);
