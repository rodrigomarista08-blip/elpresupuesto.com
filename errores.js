/* Aviso de error global. Va aparte y se carga el primero para funcionar aunque falle el resto de la app:
   explica lo ocurrido en lenguaje claro y deja descargar los datos guardados antes de recargar. */
(function(){
  'use strict';
  var shown=false;
  function rawData(){
    var raw={};
    try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('presupuesto:')===0)raw[k]=localStorage.getItem(k)}}catch(e){}
    return {app:'presupuesto-mensual',kind:'raw',exportedAt:new Date().toISOString(),raw:raw};
  }
  function download(){
    try{
      var d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      var a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([JSON.stringify(rawData(),null,1)],{type:'application/json'}));
      a.download='presupuesto-datos-'+day+'.json';
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    }catch(e){}
  }
  function show(){
    if(shown||!document.body)return;shown=true;
    var box=document.createElement('div');
    box.className='fatal';box.setAttribute('role','alert');
    box.innerHTML='<h2>Algo ha fallado</h2>'+
      '<p>La app ha tenido un error y puede que no funcione bien. Tus datos siguen guardados en este dispositivo. '+
      'Antes de recargar, puedes descargarlos para tenerlos a salvo; luego se recuperan con «Importar una copia».</p>'+
      '<div class="fatalbtns"><button type="button" class="btn primary" data-f="dl">Descargar mis datos</button>'+
      '<button type="button" class="btn" data-f="reload">Recargar</button><button type="button" class="btn" data-f="close">Cerrar</button></div>';
    box.addEventListener('click',function(e){
      var b=e.target.closest('[data-f]');if(!b)return;
      var f=b.getAttribute('data-f');
      if(f==='dl')download();else if(f==='reload')location.reload();else{box.remove();shown=false}
    });
    document.body.appendChild(box);
    var first=box.querySelector('button');if(first)first.focus();
  }
  /* Solo errores de la propia app (no de extensiones del navegador ni de otros sitios). */
  window.addEventListener('error',function(e){
    if(e.filename&&e.filename.indexOf(location.origin)!==0)return;
    if(!e.error&&!e.message)return;
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show);else show();
  });
  window.addEventListener('unhandledrejection',function(){show()});
  window.appErrors={show:show,download:download,rawData:rawData};
})();
