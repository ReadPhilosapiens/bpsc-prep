/* hardening.js: data safety, accessibility and iPhone install hint for BPSC Prep. Loaded after the main script. */
(function(){
"use strict";
try{
var LAST="bpscprep.lastBackup",SNAP="bpscprep.prerestore",HINT="bpscprep.iosHintSeen";
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}
function standalone(){return matchMedia("(display-mode: standalone)").matches||navigator.standalone===true}

/* Ask the browser to keep this app's storage (helps against iOS eviction). */
if(standalone()&&navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){})}

/* Visible keyboard focus. */
var st=document.createElement("style");
st.textContent="button:focus-visible,summary:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--text);outline-offset:2px}";
document.head.appendChild(st);

/* Screen reader hints. */
var to=document.getElementById("toast");if(to){to.setAttribute("role","status");to.setAttribute("aria-live","polite")}
var sh=document.getElementById("sheet");if(sh){sh.setAttribute("role","dialog");sh.setAttribute("aria-modal","true")}

/* Sanitiser for restored data: primitives only, capped sizes, no prototype keys. */
function clean(v,d){
if(d>5)return null;
if(typeof v==="string")return v.slice(0,500);
if(typeof v==="number")return isFinite(v)?v:0;
if(typeof v==="boolean"||v===null)return v;
if(Array.isArray(v))return v.slice(0,5000).map(function(x){return clean(x,d+1)}).filter(function(x){return x!==null});
if(typeof v==="object"){
var o={};
Object.keys(v).slice(0,5000).forEach(function(k){
if(k==="__proto__"||k==="constructor"||k==="prototype"||k.length>200)return;
o[k]=clean(v[k],d+1);
});
return o;
}
return null;
}
function fail(msg){var e=new Error(msg);e.hx=1;return e}
function validate(raw){
var d=raw;
if(d&&typeof d==="object"&&d.app!==undefined){
if(d.app!=="bpsc-prep")throw fail("Import failed: this backup belongs to another app.");
if(typeof d.schema!=="number"||d.schema>1)throw fail("Import failed: this backup is from a newer version of the app.");
d=d.data;
}
if(!d||typeof d!=="object"||!Array.isArray(d.logs))throw fail("Import failed: this file isn't a backup.");
var logs=d.logs.slice(0,5000).filter(function(l){return l&&typeof l.topic==="string"&&typeof l.t==="number"&&isFinite(l.t)}).map(function(l){
return{id:String(l.id||uid()).slice(0,40),t:l.t,exam:EXAM[l.exam]?l.exam:"pcs",topic:l.topic.slice(0,200),sure:Math.min(5,Math.max(1,+l.sure||3)),recall:["yes","shaky","no"].indexOf(l.recall)>-1?l.recall:null,sample:!!l.sample};
});
function obj(x){return x&&typeof x==="object"&&!Array.isArray(x)?clean(x,0):{}}
var dates={},rd=obj(d.dates);
Object.keys(rd).forEach(function(k){if(typeof rd[k]==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(rd[k]))dates[k]=rd[k]});
return{v:1,viva:obj(d.viva),vivaLog:Array.isArray(d.vivaLog)?clean(d.vivaLog,0):[],dates:dates,qlevel:LV[d.qlevel]?d.qlevel:"m",qs:obj(d.qs),
quiz:Array.isArray(d.quiz)?clean(d.quiz.filter(function(r){return r&&typeof r.t==="number"}),0):[],
exam:EXAM[d.exam]?d.exam:"pcs",theme:LOOKS.some(function(l){return l[0]===d.theme})?d.theme:(S.theme||"minimal"),logs:logs};
}

/* Backup: versioned envelope, remembers when it was made. */
function stamp(){lsSet(LAST,String(Date.now()));refresh()}
window.backup=async function(){
var d=new Date(),p=function(n){return String(n).padStart(2,"0")};
var name="bpsc-prep-backup-"+d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+".json";
var env={app:"bpsc-prep",schema:1,exportedAt:d.toISOString(),data:S};
var blob=new Blob([JSON.stringify(env,null,1)],{type:"application/json"});
try{
var file=new File([blob],name,{type:"application/json"});
if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"BPSC Prep backup"});stamp();return}
}catch(e){if(e&&e.name==="AbortError")return}
var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
stamp();toast("Backup saved");
};

/* Restore: validate, preview, snapshot, then replace. Undo is kept. */
var old=document.getElementById("restoreFile");
var inp=old.cloneNode(true);
old.parentNode.replaceChild(inp,old);
inp.addEventListener("change",function(ev){
var f=ev.target.files[0];if(!f)return;
if(f.size>5e6){toast("That file is too big to be a backup. Nothing was changed.");inp.value="";return}
var r=new FileReader();
r.onload=function(){
var next;
try{next=validate(JSON.parse(r.result))}
catch(e){toast(e&&e.hx?e.message+" Nothing was changed.":"Import failed: this file isn't a backup. Nothing was changed.");inp.value="";return}
var ts=next.logs.map(function(l){return l.t});
var span=ts.length?new Date(Math.min.apply(null,ts)).toLocaleDateString()+" to "+new Date(Math.max.apply(null,ts)).toLocaleDateString():"no dates";
var msg="Replace your data with this backup?\n\n"+next.logs.length+" study entries ("+span+")\n"+next.quiz.length+" quiz results\n\nYour current data is saved first, so you can undo.";
if(!confirm(msg)){inp.value="";return}
if(!lsSet(SNAP,JSON.stringify({savedAt:Date.now(),data:S}))){toast("Not enough space to keep an undo copy. Nothing was changed.");inp.value="";return}
S=next;save();renderAll();toast("Restored");
inp.value="";
};
r.readAsText(f);
});
function undo(){
var raw=lsGet(SNAP),s;
try{s=JSON.parse(raw).data}catch(e){s=null}
if(!s||!Array.isArray(s.logs)){toast("Nothing to undo");refresh();return}
if(!confirm("Go back to the data you had before the last restore?"))return;
S=s;save();try{localStorage.removeItem(SNAP)}catch(e){}
renderAll();toast("Restore undone");
}

/* Screen additions: backup status, undo, nudge, iPhone hint. */
var rb=document.getElementById("restoreBtn");
var ub=document.createElement("button");ub.id="hxUndo";ub.type="button";ub.className="btn2 quiet";ub.textContent="Undo last restore";ub.style.display="none";
ub.addEventListener("click",undo);
var info=document.createElement("div");info.id="hxInfo";info.className="note";info.style.padding="0 0 10px";
rb.parentNode.insertBefore(ub,rb.nextSibling);
rb.parentNode.insertBefore(info,ub.nextSibling);

var bar=document.getElementById("installBar");
var ios=document.createElement("div");ios.id="hxIos";
var nudge=document.createElement("div");nudge.id="hxNudge";
bar.parentNode.insertBefore(ios,bar.nextSibling);
bar.parentNode.insertBefore(nudge,ios.nextSibling);

function banner(text,label,onClick){
var b=document.createElement("div");b.className="banner inst";
var s=document.createElement("span");s.textContent=text;
var btn=document.createElement("button");btn.type="button";btn.textContent=label;btn.addEventListener("click",onClick);
b.appendChild(s);b.appendChild(btn);return b;
}
function daysSince(){var t=+lsGet(LAST);return t?Math.floor((Date.now()-t)/864e5):null}
function refresh(){
var n=daysSince();
var real=(S&&S.logs?S.logs:[]).filter(function(l){return !l.sample}).length;
nudge.textContent="";
if(real>=3&&(n===null||n>=7)){
nudge.appendChild(banner(n===null?"You haven't saved a backup yet":"Last backup "+n+" days ago","Back up",function(){window.backup()}));
}
info.textContent=n===null?"No backup saved yet.":n===0?"Last backup: today.":"Last backup: "+n+" day"+(n===1?"":"s")+" ago.";
ub.style.display=lsGet(SNAP)?"block":"none";
}
var isIos=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
if(isIos&&!standalone()&&!lsGet(HINT)){
ios.appendChild(banner("On iPhone: tap Share, then Add to Home Screen. Progress made in a Safari tab will not carry over.","Got it",function(){lsSet(HINT,"1");ios.textContent=""}));
}
var ra=window.renderAll;
if(typeof ra==="function"){window.renderAll=function(){var r=ra.apply(this,arguments);refresh();return r}}
refresh();
}catch(err){try{console.error("hardening.js",err)}catch(e){}}
})();
