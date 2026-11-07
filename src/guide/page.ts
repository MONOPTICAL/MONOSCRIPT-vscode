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
        .map(h => `<a class="toc-l${h.level}" href="#${h.id}" data-id="${h.id}">${escape(h.text)}</a>`)
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
<input id="search" type="search" placeholder="${ui.search}" aria-label="${ui.search}">
<button id="lang" title="${ui.other}">${lang === 'ru' ? 'EN' : 'RU'}</button>
  </div>
  <div id="toc-list">${toc}</div>
  <div id="nothing" hidden>${ui.nothing}</div>
</nav>
<main id="content">${guide.html}</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const UI = ${JSON.stringify({ open: ui.open, copy: ui.copy, copied: ui.copied })};
const LANG = ${JSON.stringify(lang)};
const content = document.getElementById('content');

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
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
document.getElementById('search').addEventListener('input', e => {
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
    if (active) a.scrollIntoView({ block: 'nearest' });
  }
}
const observer = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) markActive(en.target.id);
}, { rootMargin: '0px 0px -70% 0px' });
content.querySelectorAll('h2, h3').forEach(h => observer.observe(h));

window.addEventListener('message', e => { if (e.data.type === 'scroll') scrollToId(e.data.id); });
${scrollId ? `scrollToId(${JSON.stringify(scrollId)});` : ''}
</script>
</body>
</html>`;
}

function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STYLE = `
:root { --toc-width: 240px; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.6; }
#toc { position: fixed; top: 0; left: 0; bottom: 0; width: var(--toc-width); overflow-y: auto; padding: 12px 8px 24px;
  border-right: 1px solid var(--vscode-panel-border, transparent); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
.toc-head { display: flex; gap: 6px; margin-bottom: 10px; position: sticky; top: 0; }
#search { flex: 1; min-width: 0; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font: inherit; }
#search:focus { outline: 1px solid var(--vscode-focusBorder); }
button { color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  border: none; border-radius: 2px; padding: 3px 8px; font: inherit; font-size: 0.9em; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
#toc a { display: block; padding: 2px 8px; border-radius: 3px; color: var(--vscode-foreground); text-decoration: none; opacity: 0.85;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#toc a.toc-l3 { padding-left: 22px; font-size: 0.92em; opacity: 0.7; }
#toc a:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
#toc a.active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); opacity: 1; }
#toc a[hidden] { display: none; }
#toc a.context { opacity: 0.5; font-style: italic; }
.code-actions button { font-family: var(--vscode-font-family); }
#nothing { padding: 4px 8px; opacity: 0.6; }
#content { margin-left: var(--toc-width); padding: 8px 32px 64px; max-width: calc(var(--toc-width) + 900px); }
@media (max-width: 640px) {
  #toc { position: static; width: auto; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
  #content { margin-left: 0; padding: 8px 16px 48px; }
}
h1, h2, h3 { line-height: 1.3; scroll-margin-top: 12px; }
h1 { font-size: 1.9em; margin: 0.6em 0 0.4em; }
h2 { font-size: 1.45em; margin-top: 1.8em; padding-bottom: 0.25em; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); }
h3 { font-size: 1.15em; margin-top: 1.4em; }
.flash { animation: flash 1.2s ease-out; }
@keyframes flash { from { background: var(--vscode-editor-findMatchHighlightBackground, rgba(255,200,0,0.3)); } to { background: transparent; } }
a { color: var(--vscode-textLink-foreground); }
a:hover { color: var(--vscode-textLink-activeForeground); }
code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; }
:not(pre) > code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15)); }
pre.code { position: relative; padding: 10px 12px; border-radius: 4px; overflow-x: auto; line-height: 1.45;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12)); }
pre.code code { font-size: var(--vscode-editor-font-size, 0.92em); }
.code-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
pre.code:hover .code-actions, pre.code:focus-within .code-actions { opacity: 1; }
.table { overflow-x: auto; margin: 0.8em 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); padding: 4px 10px; text-align: left; vertical-align: top; }
th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1)); }
blockquote { margin: 0; padding: 0 12px; border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.5)); opacity: 0.9; }
.tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); }
.tok-type { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
.tok-function, .tok-builtin { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
.tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.tok-number, .tok-constant { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.tok-comment { color: var(--vscode-descriptionForeground, #6a9955); font-style: italic; }
.tok-label { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
.tok-self { color: var(--vscode-symbolIcon-variableForeground, #569cd6); font-style: italic; }
.tok-guide { color: var(--vscode-editorIndentGuide-activeBackground1, #707070); }
.tok-operator { opacity: 0.85; }
`;
