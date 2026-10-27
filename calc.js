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

var Calc={formatEUR:formatEUR,toInputString:toInputString,parseAmount:parseAmount,daysInMonth:daysInMonth,sum:sum,
  allocationDiff:allocationDiff,splitByPercent:splitByPercent,proportionalCuts:proportionalCuts,weekWindow:weekWindow,
  weekBudget:weekBudget,ocioWeeklyCap:ocioWeeklyCap,monthlyRate:monthlyRate,projectSavings:projectSavings,monthsToGoal:monthsToGoal};
root.Calc=Calc;
if(typeof module!=='undefined'&&module.exports)module.exports=Calc;
})(typeof window!=='undefined'?window:this);
