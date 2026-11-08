// Справочник в панели: разметка, якоря разделов, подсветка примеров.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'out', 'guide');
const { renderGuide, sectionId, slugify } = require(path.join(out, 'render.js'));
const { buildPage } = require(path.join(out, 'page.js'));
const { highlightMs } = require(path.join(out, 'highlight.js'));
const { GUIDE_SECTIONS, sectionForWord, guideLink } = require(path.join(out, 'sections.js'));
const { KEYWORDS, TYPES, LABELS } = require(path.join(__dirname, '..', 'out', 'builtins.js'));

const docs = Object.fromEntries(['ru', 'en'].map(lang => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'docs', `language.${lang}.md`), 'utf8');
    return [lang, { text, guide: renderGuide(text) }];
}));

test('каждый ключ раздела находит заголовок на обоих языках', () => {
    for (const lang of ['ru', 'en']) {
        for (const key of Object.keys(GUIDE_SECTIONS)) {
            assert.ok(sectionId(docs[lang].guide, key, lang), `${lang}: ${key}`);
        }
    }
});

test('ссылки на разделы внутри файла ведут на существующие якоря', () => {
    for (const lang of ['ru', 'en']) {
        const ids = new Set(docs[lang].guide.headings.map(h => h.id));
        for (const m of docs[lang].text.matchAll(/\]\(#([^)]+)\)/g)) {
            assert.ok(ids.has(decodeURIComponent(m[1])), `${lang}: #${m[1]}`);
        }
    }
});

test('у справочников одинаковая структура', () => {
    const shape = lang => docs[lang].guide.headings.map(h => h.level).join('');
    assert.equal(shape('ru'), shape('en'));
});

test('якоря как на GitHub, повторы получают номер', () => {
    assert.equal(slugify('Ошибки как значения: result'), 'ошибки-как-значения-result');
    assert.equal(slugify('@strict'), 'strict');
    const ids = docs.ru.guide.headings.filter(h => h.text === 'Строки').map(h => h.id);
    assert.deepEqual(ids, ['строки', 'строки-1']);
});

test('оглавление из файла не дублируется в панели', () => {
    assert.ok(!docs.ru.guide.headings.some(h => h.text === 'Содержание'));
    assert.ok(!docs.en.guide.headings.some(h => h.text === 'Contents'));
});

test('подсветка: токены и экранирование HTML', () => {
    const html = highlightMs('[i32]main() @pure\n|   if x < 1 // a<b\n|   |   echo("<tag>")');
    assert.match(html, /<span class="tok-type">i32<\/span>/);
    assert.match(html, /<span class="tok-function">main<\/span>/);
    assert.match(html, /<span class="tok-label">@pure<\/span>/);
    assert.match(html, /<span class="tok-keyword">if<\/span>/);
    assert.match(html, /<span class="tok-comment">\/\/ a&lt;b<\/span>/);
    assert.match(html, /<span class="tok-string">&quot;&lt;tag&gt;&quot;<\/span>/);
    assert.match(html, /<span class="tok-builtin">echo<\/span>/);
    assert.ok(!html.includes('<tag>'));
});

test('страница панели: CSP с nonce, без внешних ресурсов', () => {
    const page = buildPage(docs.ru.guide, 'ru', 'ошибки-как-значения-result');
    const nonce = page.match(/script-src 'nonce-([a-z0-9]+)'/)[1];
    assert.equal((page.match(new RegExp(`nonce="${nonce}"`, 'g')) ?? []).length, 2);
    assert.ok(!/<script(?![^>]*nonce)/.test(page));
    assert.ok(!/src="https?:/.test(page));
    assert.match(page, /scrollToId\("ошибки-как-значения-result", true\)/);
});

test('у слов языка в подсказках есть раздел справочника', () => {
    for (const word of [...Object.keys(KEYWORDS), ...Object.keys(TYPES), ...Object.keys(LABELS)]) {
        const key = sectionForWord(word);
        assert.ok(key && GUIDE_SECTIONS[key], word);
    }
    assert.equal(guideLink('result'), `[📖 Справочник](command:monoscript.openGuide?${encodeURIComponent('["result"]')})`);
});
