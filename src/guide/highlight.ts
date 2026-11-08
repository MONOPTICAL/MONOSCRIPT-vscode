// Подсветка кода MONOSCRIPT в HTML для справочника. Без зависимостей от vscode:
// те же группы токенов, что и в TextMate-грамматике, но проще.

import { BUILTIN_FUNCTIONS } from '../builtins';

const KEYWORDS = new Set(['if', 'else', 'attempt', 'panic', 'while', 'for', 'in', 'return', 'break', 'continue', 'and', 'or', 'use', 'const', 'final']);
const TYPES = new Set(['i1', 'i8', 'i16', 'i32', 'i64', 'float', 'f64', 'char', 'string', 'void', 'auto', 'array', 'map', 'result', 'func', 'struct', 'panic_info']);
const CONSTANTS = new Set(['true', 'false', 'null', 'none']);
const BUILTINS = new Set(BUILTIN_FUNCTIONS.map(f => f.name));

const TOKEN_RE = new RegExp([
    String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))`,
    String.raw`(?<string>"(?:\\.|[^"\\\n])*"?)`,
    String.raw`(?<char>'(?:\\.|[^'\\\n])*'?)`,
    String.raw`(?<guide>^[ \t]*(?:\|(?!>)[ \t]*)+)`,
    String.raw`(?<label>@\w+)`,
    String.raw`(?<number>\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)`,
    String.raw`(?<word>[A-Za-z_]\w*)(?<call>\s*\()?`,
    String.raw`(?<op>\|>|->|\^=|==|!=|<=|>=|[+\-*/%<>=!?])`
].join('|'), 'gm');

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const span = (cls: string, text: string) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

/** HTML для фрагмента кода MONOSCRIPT. */
export function highlightMs(code: string): string {
    let out = '';
    let last = 0;
    for (const m of code.matchAll(TOKEN_RE)) {
        const start = m.index ?? 0;
        if (m[0] === '') { continue; }
        out += escapeHtml(code.slice(last, start));
        last = start + m[0].length;
        const g = m.groups ?? {};
        if (g.comment) { out += span('comment', g.comment); }
        else if (g.string) { out += span('string', g.string); }
        else if (g.char) { out += span('string', g.char); }
        else if (g.guide) { out += span('guide', g.guide); }
        else if (g.label) { out += span('label', g.label); }
        else if (g.number) { out += span('number', g.number); }
        else if (g.word) {
            const w = g.word;
            const call = g.call ?? '';
            let cls = 'ident';
            if (KEYWORDS.has(w)) { cls = 'keyword'; }
            else if (TYPES.has(w)) { cls = 'type'; }
            else if (CONSTANTS.has(w)) { cls = 'constant'; }
            else if (w === 'self') { cls = 'self'; }
            else if (call && BUILTINS.has(w)) { cls = 'builtin'; }
            else if (call && /^[A-Z]/.test(w)) { cls = 'type'; }
            else if (call) { cls = 'function'; }
            else if (/^[A-Z]/.test(w)) { cls = 'type'; }
            out += span(cls, w) + escapeHtml(call);
        }
        else if (g.op) { out += span('operator', g.op); }
        else { out += escapeHtml(m[0]); }
    }
    return out + escapeHtml(code.slice(last));
}
