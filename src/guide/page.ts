// HTML-страница справочника для webview: оглавление, поиск по тексту,
// переключение RU/EN, подсветка примеров и кнопки «Открыть в редакторе» / «Копировать».
// Без зависимостей от vscode — страницу можно открыть и в обычном браузере.

import { RenderedGuide } from './render';
import { GuideLanguage } from './sections';

const UI: Record<GuideLanguage, Record<string, string>> = {
    ru: { title: 'Справочник MONOSCRIPT', search: 'Поиск по справочнику', open: 'Открыть в редакторе', copy: 'Копировать', copied: 'Скопировано', nothing: 'Ничего не найдено', other: 'English' },
    en: { title: 'MONOSCRIPT Reference', search: 'Search the reference', open: 'Open in editor', copy: 'Copy', copied: 'Copied', nothing: 'Nothing found', other: 'Русский' }
};

export function guideTitle(lang: GuideLanguage): string {
    return UI[lang].title;
}

export function buildPage(guide: RenderedGuide, lang: GuideLanguage, scrollId?: string): string {
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
    const ui = UI[lang];
    const toc = guide.headings
        .filter(h => h.level === 2 || h.level === 3)
        .map(h => `<a class="toc-l${h.level}" href="#${h.id}" data-id="${h.id}" title="${escape(h.text)}">${escape(h.text)}</a>`)
        .join('\n');
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src https: data:;`;
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<nav id="toc">
  <div class="toc-head">
    <div class="brand" aria-label="MONOSCRIPT"><b>MONO</b><span>SCRIPT</span></div>
    <div class="brand-sub">${ui.title.replace('MONOSCRIPT', '').trim()}</div>
    <div class="toc-tools">
      <input id="search" type="search" placeholder="${ui.search}" aria-label="${ui.search}" autocomplete="off" spellcheck="false">
      <button id="lang" title="${ui.other}">${lang === 'ru' ? 'EN' : 'RU'}</button>
    </div>
  </div>
  <div id="toc-list">${toc}
    <div id="nothing" hidden>${ui.nothing}</div>
  </div>
</nav>
<main id="content"><article>${guide.html}</article></main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const UI = ${JSON.stringify({ open: ui.open, copy: ui.copy, copied: ui.copied })};
const LANG = ${JSON.stringify(lang)};
const content = document.querySelector('#content article');
const tocList = document.getElementById('toc-list');

function scrollToId(id, instant) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: instant ? 'instant' : 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
  markActive(id);
}

// Кнопки у примеров кода
for (const pre of content.querySelectorAll('pre.code')) {
  const code = pre.querySelector('code').textContent;
  const bar = document.createElement('div');
  bar.className = 'code-actions';
  const mk = (label, type) => {
const b = document.createElement('button');
b.textContent = label;
b.addEventListener('click', () => {
  vscode.postMessage({ type, code });
  if (type === 'copy') { b.textContent = UI.copied; setTimeout(() => b.textContent = UI.copy, 1200); }
});
return b;
  };
  if (pre.dataset.lang === 'ms') bar.appendChild(mk(UI.open, 'openCode'));
  bar.appendChild(mk(UI.copy, 'copy'));
  pre.appendChild(bar);
}

// Ссылки: якоря внутри, другой язык справочника, внешние сайты
document.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  e.preventDefault();
  if (href.startsWith('#')) { scrollToId(decodeURIComponent(href.slice(1))); return; }
  const other = href.match(/language\\.(ru|en)\\.md$/);
  if (other) { vscode.postMessage({ type: 'language', lang: other[1] }); return; }
  vscode.postMessage({ type: 'external', href });
});

document.getElementById('lang').addEventListener('click', () => {
  vscode.postMessage({ type: 'language', lang: LANG === 'ru' ? 'en' : 'ru' });
});

// Поиск: оставляет в оглавлении разделы, в тексте которых есть запрос
const sections = [];
{
  let current = null;
  for (const el of content.children) {
if (/^H[1-3]$/.test(el.tagName)) { current = { id: el.id, text: el.textContent.toLowerCase() }; sections.push(current); }
else if (current) current.text += ' ' + el.textContent.toLowerCase();
  }
}
const tocLinks = [...document.querySelectorAll('#toc-list a')];
const search = document.getElementById('search');
search.addEventListener('keydown', e => {
  // Enter — к первому найденному разделу, Esc — сбросить поиск
  if (e.key === 'Enter') {
    const first = tocLinks.find(a => !a.hidden && !a.classList.contains('context'));
    if (first) scrollToId(first.dataset.id);
  } else if (e.key === 'Escape') {
    search.value = '';
    search.dispatchEvent(new Event('input'));
  }
});
search.addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  let parent = null; // раздел второго уровня: показываем его, если нашлось в подразделе
  for (const a of tocLinks) {
    const s = sections.find(x => x.id === a.dataset.id);
    const hit = !q || (s && s.text.includes(q));
    a.hidden = !hit;
    a.classList.toggle('context', false);
    if (a.classList.contains('toc-l2')) parent = a;
    else if (hit && parent && parent.hidden) { parent.hidden = false; parent.classList.add('context'); }
    if (hit) shown++;
  }
  document.getElementById('nothing').hidden = shown > 0;
});

// Текущий раздел в оглавлении
function markActive(id) {
  for (const a of tocLinks) {
    const active = a.dataset.id === id;
    a.classList.toggle('active', active);
    // Прокручиваем только оглавление, не всю страницу
    if (active && !a.hidden) {
      const top = a.offsetTop; // #toc-list — position: relative
      if (top < tocList.scrollTop || top + a.offsetHeight > tocList.scrollTop + tocList.clientHeight) {
        tocList.scrollTop = top - tocList.clientHeight / 3;
      }
    }
  }
}
const observer = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) markActive(en.target.id);
}, { rootMargin: '0px 0px -70% 0px' });
content.querySelectorAll('h2, h3').forEach(h => observer.observe(h));

window.addEventListener('message', e => { if (e.data.type === 'scroll') scrollToId(e.data.id); });
${scrollId ? `// Первый переход — после раскладки страницы и без анимации, иначе он промахивается
const initial = () => requestAnimationFrame(() => scrollToId(${JSON.stringify(scrollId)}, true));
if (document.readyState === 'complete') initial(); else window.addEventListener('load', initial);` : ''}
</script>
</body>
</html>`;
}

function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STYLE = `
/* Чёрно-белая тема в духе логотипа MONOSCRIPT: жирное MONO и тонкое SCRIPT,
   моноширинный шрифт, только оттенки серого. Цвета темы VS Code не используются:
   страница чёрная в тёмных темах и белая в светлых. */
:root, body.vscode-dark, body.vscode-high-contrast {
  --bg: #0d0d0d;
  --ink: #f2f2f2;
  --side: #000000;
  --surface: #141414;
  --surface-2: #1b1b1b;
  --line: #262626;
  --line-strong: #3a3a3a;
  --muted: #a6a6a6;
  --faint: #656565;
  --select: rgba(255, 255, 255, 0.22);
  --toc-width: 264px;
  --radius: 6px;
  --mono: var(--vscode-editor-font-family, "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace);
  --sans: var(--vscode-font-family, system-ui, "Segoe UI", sans-serif);
}
body.vscode-light, body.vscode-high-contrast-light {
  --bg: #ffffff;
  --ink: #0d0d0d;
  --side: #f7f7f7;
  --surface: #f6f6f6;
  --surface-2: #ededed;
  --line: #e4e4e4;
  --line-strong: #cccccc;
  --muted: #545454;
  --faint: #8c8c8c;
  --select: rgba(0, 0, 0, 0.14);
}
/* Контрастные темы: все линии в цвет текста */
body.vscode-high-contrast, body.vscode-high-contrast-light { --line: var(--ink); --line-strong: var(--ink); --faint: var(--muted); }

* { box-sizing: border-box; }
body { margin: 0; padding: 0; color: var(--ink); background: var(--bg);
  font-family: var(--sans); font-size: 14px; line-height: 1.7; -webkit-font-smoothing: antialiased; }
::selection { background: var(--select); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border: 3px solid transparent; background-clip: content-box; border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background-color: var(--faint); }
::-webkit-scrollbar-track { background: transparent; }

/* ---------- Оглавление ---------- */
#toc { position: fixed; top: 0; left: 0; bottom: 0; width: var(--toc-width); display: flex; flex-direction: column;
  background: var(--side); border-right: 1px solid var(--line); z-index: 2; }
.toc-head { flex: none; padding: 22px 18px 16px; background: var(--side); border-bottom: 1px solid var(--line); }
.brand { font-family: var(--mono); font-size: 22px; line-height: 1; letter-spacing: 0.02em; color: var(--ink); white-space: nowrap; }
.brand b { font-weight: 800; }
.brand span { font-weight: 300; font-size: 0.72em; letter-spacing: 0.08em; margin-left: 1px; }
.brand-sub { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--faint); margin: 8px 0 16px; }
.toc-tools { display: flex; gap: 6px; }
#search { flex: 1; min-width: 0; height: 32px; padding: 0 10px; color: var(--ink); background: var(--bg);
  border: 1px solid var(--line-strong); border-radius: var(--radius); font: inherit; font-size: 13px; }
#search::placeholder { color: var(--faint); }
#search:focus { outline: none; border-color: var(--ink); }
button { color: var(--ink); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius);
  padding: 0 10px; height: 32px; font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; }
button:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }
button:focus-visible { outline: 1px solid var(--ink); outline-offset: 2px; }
#toc-list { position: relative; flex: 1; overflow-y: auto; padding: 12px 10px 40px; }
#toc a { display: block; position: relative; padding: 4px 10px; margin: 1px 0; border-radius: 4px;
  color: var(--muted); text-decoration: none; font-size: 13px; line-height: 1.45; }
#toc a.toc-l2 { color: var(--ink); font-weight: 600; margin-top: 10px; }
#toc a.toc-l2:first-child { margin-top: 0; }
#toc a.toc-l3 { padding-left: 22px; font-size: 12.5px; }
#toc a:hover { background: var(--surface-2); color: var(--ink); text-decoration: none; }
#toc a.active { background: var(--ink); color: var(--bg); }
#toc a[hidden] { display: none; }
#toc a.context { opacity: 0.5; font-style: italic; }
#nothing { padding: 8px 10px; color: var(--faint); font-size: 13px; }

/* ---------- Текст ---------- */
#content { margin-left: var(--toc-width); padding: 24px 56px 120px; }
article { max-width: 820px; margin: 0 auto; }
@media (max-width: 1000px) { #content { padding: 16px 28px 96px; } }
@media (max-width: 720px) {
  #toc { position: static; width: auto; max-height: 45vh; border-right: none; border-bottom: 1px solid var(--line); }
  #content { margin-left: 0; padding: 8px 20px 64px; }
}
h1, h2, h3 { font-family: var(--mono); line-height: 1.25; scroll-margin-top: 20px; color: var(--ink); }
h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.01em; margin: 24px 0 8px; }
h1 + p { color: var(--muted); font-size: 15px; margin-bottom: 40px; }
h2 { font-size: 21px; font-weight: 800; margin: 64px 0 18px; padding-top: 22px; border-top: 2px solid var(--ink); }
h3 { font-size: 15.5px; font-weight: 700; margin: 36px 0 10px; }
h3::before { content: "/ "; color: var(--faint); font-weight: 300; }
h2 code, h3 code { font-size: 0.95em; background: none; border: none; padding: 0; }
p, ul, ol { margin: 10px 0; }
ul, ol { padding-left: 22px; }
li { margin: 4px 0; }
li::marker { color: var(--faint); }
strong { font-weight: 700; color: var(--ink); }
hr { border: none; border-top: 1px solid var(--line); margin: 32px 0; }
.flash { animation: flash 1.4s ease-out; }
@keyframes flash { from { background: var(--select); } to { background: transparent; } }
a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--ink); }

/* ---------- Код ---------- */
code { font-family: var(--mono); font-size: 0.88em; }
:not(pre) > code { padding: 1px 5px; border-radius: 4px; background: var(--surface-2); color: var(--ink); overflow-wrap: anywhere; }
pre.code { position: relative; margin: 16px 0; padding: 16px 18px; border-radius: var(--radius); overflow-x: auto; line-height: 1.6;
  background: var(--surface); border: 1px solid var(--line); }
pre.code code { font-size: 13px; }
.code-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; }
.code-actions button { height: 24px; padding: 0 9px; font-size: 11px; font-weight: 600; background: var(--bg); }
.code-actions button:hover { background: var(--ink); color: var(--bg); }
pre.code:hover .code-actions, pre.code:focus-within .code-actions { opacity: 1; }

/* ---------- Таблицы ---------- */
.table { overflow-x: auto; margin: 16px 0; border: 1px solid var(--line); border-radius: var(--radius); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { padding: 9px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
tbody tr:last-child td { border-bottom: none; }
th { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--line-strong); }
tbody tr:hover td { background: var(--surface); }
td:first-child { min-width: 120px; }
blockquote { margin: 16px 0; padding: 12px 18px; border-left: 3px solid var(--ink); background: var(--surface); color: var(--ink); }
blockquote p { margin: 4px 0; }

/* ---------- Подсветка: только оттенки серого, различие — насыщенностью и начертанием ---------- */
pre.code code { color: var(--ink); }
.tok-keyword { color: var(--ink); font-weight: 700; }
.tok-type { color: var(--ink); font-weight: 600; font-style: italic; }
.tok-function, .tok-builtin { color: var(--ink); }
.tok-builtin { text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.tok-ident { color: var(--ink); opacity: 0.88; }
.tok-string { color: var(--muted); }
.tok-number, .tok-constant { color: var(--ink); font-weight: 600; }
.tok-comment { color: var(--faint); font-style: italic; }
.tok-label { color: var(--ink); font-weight: 700; }
.tok-self { color: var(--ink); font-style: italic; }
.tok-guide { color: var(--line-strong); }
.tok-operator { color: var(--muted); }
`;
