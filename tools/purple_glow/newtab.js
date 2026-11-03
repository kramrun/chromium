'use strict';
const themes = {
  purple: ['#312150','#141125','#7041ad'],
  blue: ['#16365c','#0a182e','#285da2'],
  turquoise: ['#16413f','#0b2228','#287e77'],
  pink: ['#50223e','#251322','#a73d79']
};
function render(settings) {
  const theme = themes[settings.color] || themes.purple;
  ['--tone1','--tone2','--glow'].forEach((key, i) => document.documentElement.style.setProperty(key, theme[i]));
  document.body.classList.toggle('animated', settings.mode !== 'static');
}
chrome.storage.local.get({mode:'animated',color:'purple'}).then(render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.mode || changes.color)) chrome.storage.local.get({mode:'animated',color:'purple'}).then(render);
});
function updateClock(){const now=new Date();document.getElementById('clock').textContent=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(now);document.getElementById('date').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(now);}
function updateVisibility(){document.body.classList.toggle('paused',document.hidden);if(!document.hidden)updateClock();}
document.addEventListener('visibilitychange',updateVisibility);
updateVisibility();setInterval(()=>{if(!document.hidden)updateClock();},30000);
