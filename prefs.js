/* Ajustes de aspecto (color, letra y tema). Se guardan aparte del plan y se aplican antes de pintar, para que no parpadee. */
(function(){
  var KEY='presupuesto:v1:prefs';
  var ACCENTS={
    teal:{n:'Verde azulado',l:'#0e7a66',d:'#4fc2a8'},
    blue:{n:'Azul',l:'#2160c4',d:'#7fa9f2'},
    indigo:{n:'Índigo',l:'#4f46c8',d:'#a7a1f3'},
    purple:{n:'Morado',l:'#8137a8',d:'#cf9bef'},
    pink:{n:'Rosa',l:'#bf2f72',d:'#f28dbd'},
    coral:{n:'Coral',l:'#be3f2b',d:'#f59580'},
    orange:{n:'Naranja',l:'#a35000',d:'#f4a65c'},
    green:{n:'Verde',l:'#2b7a30',d:'#86d18a'}
  };
  var FONTS={
    jakarta:{n:'Moderna',f:"'Plus Jakarta Sans'"},
    nunito:{n:'Redondeada',f:"'Nunito'"},
    atkinson:{n:'Muy legible',f:"'Atkinson Hyperlegible'"},
    lora:{n:'Clásica',f:"'Lora'"}
  };
  var p={accent:'teal',font:'jakarta',theme:'auto',protectSavings:true};
  try{
    var s=JSON.parse(localStorage.getItem(KEY)||'null');
    if(s&&typeof s==='object'){
      if(ACCENTS[s.accent])p.accent=s.accent;
      if(FONTS[s.font])p.font=s.font;
      if(/^(auto|light|dark)$/.test(s.theme))p.theme=s.theme;
      if(typeof s.protectSavings==='boolean')p.protectSavings=s.protectSavings;
    }
  }catch(e){}
  function apply(){
    var r=document.documentElement,a=ACCENTS[p.accent],f=FONTS[p.font],css='';
    if(p.theme==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',p.theme);
    if(p.accent!=='teal'){
      var lt='--accent:'+a.l+';--accent-ink:#fff;--hero-a:'+a.l+';--hero-b:color-mix(in srgb,'+a.l+' 62%,#1d3f8f);';
      var dk='--accent:'+a.d+';--accent-ink:#0b1220;--hero-a:color-mix(in srgb,'+a.l+' 72%,#000);--hero-b:color-mix(in srgb,'+a.l+' 45%,#0d1b3a);';
      css+=':root{'+lt+'}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){'+dk+'}}:root[data-theme="dark"]{'+dk+'}';
    }
    if(p.font!=='jakarta'){
      css+=':root{--display:'+f.f+",'Segoe UI',system-ui,sans-serif;--body:"+f.f+",'Segoe UI',system-ui,sans-serif}";
    }
    var st=document.getElementById('userTheme');
    if(!st){st=document.createElement('style');st.id='userTheme';document.head.appendChild(st)}
    st.textContent=css;
    var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=p.accent==='teal'?'#0f6b5c':a.l;
  }
  apply();
  window.appPrefs={p:p,ACCENTS:ACCENTS,FONTS:FONTS,apply:apply,
    save:function(){try{localStorage.setItem(KEY,JSON.stringify(p));return true}catch(e){return false}}};
})();
