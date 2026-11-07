// Markdown справочника → HTML для панели. Без зависимостей от vscode, чтобы
// проверять в обычном node (test/guide.test.js).

import MarkdownIt from 'markdown-it';
import { escapeHtml, highlightMs } from './highlight';
import { GUIDE_SECTIONS, GuideLanguage } from './sections';

export interface GuideHeading {
    level: number;
    text: string;
    id: string;
}

export interface RenderedGuide {
    html: string;
    headings: GuideHeading[];
}

/** Якорь как на GitHub: `## Ошибки как значения: result` → `ошибки-как-значения-result`. */
export function slugify(text: string): string {
    return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** Текст заголовка без разметки: `` `final` с присваиванием `` → `final с присваиванием`. */
function plainText(inline: string): string {
    return inline.replace(/`([^`]*)`/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Оглавление в начале файла не нужно: у панели оно своё, сбоку. */
function dropContents(markdown: string): string {
    return markdown.replace(/^## (?:Содержание|Contents)\s*\n[\s\S]*?(?=^## )/m, '');
}

export function renderGuide(markdown: string): RenderedGuide {
    const md: MarkdownIt = new MarkdownIt({
        html: false,
        linkify: false,
        typographer: false,
        highlight: (code: string, lang: string): string => {
            const body = lang === 'ms' ? highlightMs(code.replace(/\n$/, '')) : escapeHtml(code.replace(/\n$/, ''));
            return `<pre class="code" data-lang="${escapeHtml(lang || 'text')}"><code>${body}</code></pre>`;
        }
    });

    const headings: GuideHeading[] = [];
    const used = new Map<string, number>();
    md.core.ruler.push('heading_ids', state => {
        const tokens = state.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== 'heading_open') { continue; }
            const text = plainText(tokens[i + 1]?.content ?? '');
            const base = slugify(text);
            const n = used.get(base) ?? 0;
            used.set(base, n + 1);
            const id = n === 0 ? base : `${base}-${n}`;
            tokens[i].attrSet('id', id);
            headings.push({ level: Number(tokens[i].tag.slice(1)), text, id });
        }
    });

    // Таблицы и код иногда шире панели: оборачиваем таблицы в прокручиваемый блок
    md.renderer.rules.table_open = () => '<div class="table"><table>';
    md.renderer.rules.table_close = () => '</table></div>';

    const html = md.render(dropContents(markdown));
    return { html, headings };
}

/** Якорь раздела по ключу из GUIDE_SECTIONS (первый заголовок с этим текстом). */
export function sectionId(guide: RenderedGuide, section: string, lang: GuideLanguage): string | undefined {
    const title = GUIDE_SECTIONS[section]?.[lang];
    if (!title) { return undefined; }
    return guide.headings.find(h => h.text === title)?.id;
}
