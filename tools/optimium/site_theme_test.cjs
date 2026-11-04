const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../../chrome/browser/resources/optimium_site_theme');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const flush = () => new Promise(resolve => setImmediate(resolve));
let passed = 0, failures = [];
async function test(name, run) {
  try { await run(); console.log('PASS', name); passed++; }
  catch (error) { console.log('FAIL', name + ':', error.message); failures.push(name); }
}
function worker(values = {}) {
  const out = {values, queries: [], messages: [], runtimeListener: null, prefListener: null};
  const chrome = {
    runtime: {onMessage: {addListener(fn) {out.runtimeListener = fn;}}, lastError: null},
    settingsPrivate: {
      getPref(name, callback) { callback({key:name, value: values[name]}); },
      onPrefsChanged: {addListener(fn) {out.prefListener = fn;}},
    },
    tabs: {query: async query => {out.queries.push(query);return [{id:1},{id:2}];}, sendMessage: async (id,msg) => {out.messages.push({id,msg});}},
  };
  vm.runInNewContext(background, {chrome, Promise, console});
  return out;
}
function page({hostname='www.youtube.com', pathname='/', theme={enabled:true,dark:true,colors:{}}, rootPresent=true}={}) {
  const out={styles:[],messages:[],listener:null,ready:null};
  const attrs=new Set();
  const parent={appendChild(style){out.styles.push(style);},hasAttribute(name){return attrs.has(name);},toggleAttribute(name,enabled){if(enabled)attrs.add(name);else attrs.delete(name);}};
  out.hasDark=()=>attrs.has('dark');
  const document={head:rootPresent?parent:null,documentElement:rootPresent?parent:null,createElement(tag){assert.equal(tag,'style');return {textContent:'',remove(){out.styles=out.styles.filter(s=>s!==this);}};},addEventListener(event,fn){assert.equal(event,'DOMContentLoaded');out.ready=fn;}};
  const chrome={runtime:{onMessage:{addListener(fn){out.listener=fn;}},sendMessage:async message=>{out.messages.push(message);return theme;}}};
  class MutationObserver { constructor(callback){this.callback=callback;} observe(){} disconnect(){} }
  vm.runInNewContext(content,{chrome,location:{hostname,pathname},document,MutationObserver,console});
  out.mount=()=>{document.head=parent;document.documentElement=parent;out.ready?.();};
  return out;
}
(async()=>{
 await test('manifest key matches stable private API allowlist',()=>{
  const id=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  assert.equal(id,'pkifalllenffcjhpoknhfaggcbbhfbbf');
  assert.equal(crypto.createHash('sha1').update(id).digest('hex').toUpperCase(),'CB4E76F19948CB94D9611F3B6E15630666E7B5A5');
 });
 await test('worker rejects unrelated and forged domain messages',()=>{
  const w=worker();
  for(const url of ['https://youtube.com.evil.example/','http://youtube.com/','https://evil.example/','javascript:alert(1)']){
   assert.equal(w.runtimeListener({type:'optimium-theme'},{tab:{id:1},url},()=>assert.fail()),false);
  }
  assert.equal(w.runtimeListener({type:'optimium-theme'},{url:'https://youtube.com/'},()=>assert.fail()),false);
 });
 await test('worker sends only sanitized theme and honors disabled pref',async()=>{
  const w=worker({'optimium.appearance.website_theme_enabled':false,'optimium.appearance.theme':{dark:false,colors:{ntp_background:'#ABC123',ntp_text:'red; background:url(https://bad)',history:'secret'}}});
  let result;
  assert.equal(w.runtimeListener({type:'optimium-theme'},{tab:{id:1},url:'https://www.youtube.com/'},v=>result=v),true);
  await flush();
  assert.equal(result.enabled,false);assert.equal(result.dark,false);
  assert.equal(result.colors.ntp_background,'#ABC123');assert.equal(result.colors.ntp_text,undefined);assert.equal(result.colors.history,undefined);
 });
 await test('pref event filters unrelated prefs, broadcasts recognized change',async()=>{
  const w=worker({'optimium.appearance.website_theme_enabled':true});
  await w.prefListener([{key:'other',value:1}]);assert.equal(w.queries.length,0);
  await w.prefListener([{key:'optimium.appearance.theme',value:{}}]);
  assert.equal(w.queries.length,1);assert.equal(w.messages.length,2);assert.equal(w.messages[0].msg.theme.enabled,true);
 });
 await test('YouTube colors do not alter video or image opacity/filter',async()=>{
  const p=page();await flush();assert.equal(p.styles.length,1);
  assert.match(p.styles[0].textContent,/--yt-spec-base-background/);
  assert.doesNotMatch(p.styles[0].textContent,/\b(?:video|img|canvas)\s*[,\{]|\b(?:opacity|filter)\s*:/);
  p.listener({type:'optimium-theme',theme:{enabled:false}});assert.equal(p.styles.length,0);
 });
 await test('YouTube dark mode follows palette and restores previous mode on disable',async()=>{
  const p=page();await flush();assert.equal(p.hasDark(),true);
  p.listener({type:'optimium-theme',theme:{enabled:false}});assert.equal(p.hasDark(),false);
 });
 await test('invalid CSS color payload uses fixed safe fallback',async()=>{
  const p=page({theme:{enabled:true,dark:true,colors:{ntp_background:'#fff;} body{display:none}/*'}}});await flush();
  assert.doesNotMatch(p.styles[0].textContent,/display:none/);assert.match(p.styles[0].textContent,/#211e29/);
 });
 await test('account signin pages stay untouched',async()=>{
  const p=page({hostname:'accounts.google.com',pathname:'/v3/signin'});await flush();assert.equal(p.messages.length,0);assert.equal(p.styles.length,0);
 });
 await test('initial theme waits if root is absent at document_start',async()=>{
  const p=page({rootPresent:false});await flush();assert.equal(p.styles.length,0);p.mount();assert.equal(p.styles.length,1);
 });
 await test('pref-update theme before document root must not throw',async()=>{
  const p=page({rootPresent:false});await flush();
  assert.doesNotThrow(()=>p.listener({type:'optimium-theme',theme:{enabled:true,dark:true,colors:{}}}));
 });
 await test('account origin root must remain untouched too',async()=>{
  const p=page({hostname:'accounts.google.com',pathname:'/'});await flush();assert.equal(p.styles.length,0);
 });
 await test('latest broadcast before DOM wins over stale initial response',async()=>{
  const p=page({rootPresent:false,theme:{enabled:true,dark:true,colors:{ntp_background:'#111111'}}});
  p.listener({type:'optimium-theme',theme:{enabled:true,dark:true,colors:{ntp_background:'#222222'}}});
  p.listener({type:'optimium-theme',theme:{enabled:true,dark:true,colors:{ntp_background:'#333333'}}});
  await flush();p.mount();
  assert.equal(p.styles.length,1);assert.match(p.styles[0].textContent,/#333333/);
  assert.doesNotMatch(p.styles[0].textContent,/#111111|#222222/);
 });
 await test('disabled latest broadcast survives stale initial response before DOM',async()=>{
  const p=page({rootPresent:false,theme:{enabled:true,dark:true,colors:{}}});
  p.listener({type:'optimium-theme',theme:{enabled:false}});
  await flush();p.mount();assert.equal(p.styles.length,0);
 });
 await test('theme change replaces style rather than accumulating DOM nodes',async()=>{
  const p=page();await flush();
  p.listener({type:'optimium-theme',theme:{enabled:true,dark:false,colors:{ntp_background:'#fafafa'}}});
  p.listener({type:'optimium-theme',theme:{enabled:true,dark:true,colors:{ntp_background:'#232323'}}});
  assert.equal(p.styles.length,1);assert.match(p.styles[0].textContent,/#232323/);
 });
 console.log(JSON.stringify({passed,failed:failures.length,failures}));
 process.exitCode=failures.length?1:0;
})();
