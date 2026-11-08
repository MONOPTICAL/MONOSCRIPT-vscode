// Быстрые проверки .ms файла без компилятора: работают на каждое изменение.
// Проверяется только то, в чём можно не ошибиться по одному файлу:
// отступы `|`, метки, незакрытые строки и символы, синтаксис, которого
// больше нет в языке, и вызовы неизвестных функций.

import { HANDLER_RE, LineInfo, MsDocument, PREFIX_RE, countDepth, inlineColon, opensBlock, splitTopLevel, tryElse, visibleSymbols } from '../analyzer';
import { BUILTIN_FUNCTIONS } from '../builtins';

export interface LintDiagnostic {
    line: number;
    start: number;
    end: number;
    message: string;
    severity: 'error' | 'warning';
    code: string;
}

const KNOWN_LABELS = new Set(['strict', 'pure', 'entry', 'private', 'overwrite', 'public', 'test']);
const NOT_CALLS = new Set(['if', 'while', 'for', 'return', 'and', 'or', 'in', 'else', 'array', 'map', 'result', 'func']);

export interface MaskedLine {
    /** Строка, где содержимое строк, символов и комментариев заменено пробелами (длина та же) */
    text: string;
    /** Есть ли на строке незакрытая строка `"` (позиция кавычки) */
    unclosedString?: number;
    /** Литералы `'...'`: позиция и содержимое между кавычками */
    chars: { start: number; end: number; body: string }[];
    endsInBlockComment: boolean;
}

/** Маскирует строки, символы и комментарии, сохраняя позиции. */
export function maskLine(raw: string, inBlockComment: boolean): MaskedLine {
    const out = raw.split('');
    const chars: MaskedLine['chars'] = [];
    let unclosedString: number | undefined;
    let i = 0;
    const blank = (from: number, to: number) => { for (let k = from; k < to && k < out.length; k++) { out[k] = ' '; } };

    while (i < raw.length) {
        if (inBlockComment) {
            const end = raw.indexOf('*/', i);
            if (end < 0) { blank(i, raw.length); i = raw.length; break; }
            blank(i, end + 2);
            i = end + 2;
            inBlockComment = false;
            continue;
        }
        const ch = raw[i];
        if (ch === '/' && raw[i + 1] === '/') { blank(i, raw.length); break; }
        if (ch === '/' && raw[i + 1] === '*') { inBlockComment = true; blank(i, i + 2); i += 2; continue; }
        if (ch === '"') {
            let j = i + 1;
            while (j < raw.length && raw[j] !== '"') { j += raw[j] === '\\' ? 2 : 1; }
            if (j >= raw.length) { unclosedString = i; blank(i + 1, raw.length); break; }
            blank(i + 1, j);
            i = j + 1;
            continue;
        }
        if (ch === "'") {
            let j = i + 1;
            while (j < raw.length && raw[j] !== "'") { j += raw[j] === '\\' ? 2 : 1; }
            const end = Math.min(j, raw.length);
            chars.push({ start: i, end: end + 1, body: raw.slice(i + 1, end) });
            blank(i + 1, end);
            i = end + 1;
            continue;
        }
        i++;
    }
    return { text: out.join(''), unclosedString, chars, endsInBlockComment: inBlockComment };
}

/**
 * `attempt` и его обработчики на той же глубине: `else error` (ошибки `?`)
 * и `panic info` (паники). Нужен хотя бы один, каждый — не больше одного раза.
 * `panic info` без `attempt` перед ним — ошибка.
 */
function lintAttempts(doc: MsDocument, push: (line: number, start: number, end: number, message: string, severity: LintDiagnostic['severity'], code: string) => void) {
    const lines = doc.lines;
    const consumed = new Set<number>();
    const where = (info: LineInfo) => info.prefix.length;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].blank || lines[i].code !== 'attempt') { continue; }
        const depth = lines[i].depth;
        const seen = new Set<string>();
        for (let j = i + 1; j < lines.length; j++) {
            const info = lines[j];
            if (info.blank || info.depth > depth) { continue; }
            const h = info.depth === depth ? info.code.match(HANDLER_RE) : null;
            if (!h) { break; }
            consumed.add(j);
            if (seen.has(h[1])) {
                push(j, where(info), where(info) + info.code.length, `Второй обработчик \`${h[1]}\` у одного \`attempt\``, 'error', 'attempt');
            }
            seen.add(h[1]);
        }
        if (!seen.size) {
            push(i, where(lines[i]), where(lines[i]) + 7, '`attempt` без обработчика: добавьте `else error` или `panic info` на том же уровне после тела', 'error', 'attempt');
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const info = lines[i];
        if (info.blank || consumed.has(i) || !/^panic\s+\w+$/.test(info.code)) { continue; }
        push(i, where(info), where(info) + info.code.length, '`panic info` пишется сразу после блока `attempt` (или после его `else error`)', 'error', 'attempt');
    }
}

const VALID_CHAR =/^(?:\\[nrtfb0'"\\]|[\x00-\x7f])$/;

export function lint(text: string, doc: MsDocument, workspaceNames: Set<string>): LintDiagnostic[] {
    const rawLines = text.split(/\r?\n/);
    const result: LintDiagnostic[] = [];
    const push = (line: number, start: number, end: number, message: string, severity: LintDiagnostic['severity'], code: string) =>
        result.push({ line, start, end: Math.max(end, start + 1), message, severity, code });

    const hasImports = rawLines.some(l => /^\s*use\s*$/.test(l));
    const known = new Set<string>([...workspaceNames, ...BUILTIN_FUNCTIONS.map(f => f.name)]);
    for (const s of doc.all) {
        if (s.kind === 'function' || s.kind === 'struct') { known.add(s.name); }
    }

    let inBlock = false;
    let prev: { line: number; depth: number; code: string } | undefined;
    const masked: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        const startedInBlock = inBlock;
        const m = maskLine(raw, inBlock);
        inBlock = m.endsInBlockComment;
        masked.push(m.text);
        if (startedInBlock && m.text.trim() === '') { continue; }

        const prefix = (raw.match(PREFIX_RE) ?? [''])[0];
        const code = m.text.slice(prefix.length).trim();

        if (m.unclosedString !== undefined) {
            push(i, m.unclosedString, raw.length, 'Строка не закрыта: нет второй `"`', 'error', 'unclosed-string');
        }
        for (const c of m.chars) {
            if (c.body === '') {
                push(i, c.start, c.end, 'Пустой символ `\'\'`', 'error', 'bad-char');
            } else if (!raw.slice(c.end - 1, c.end).startsWith("'")) {
                push(i, c.start, raw.length, 'Символ не закрыт: нет второй `\'`', 'error', 'bad-char');
            } else if (!VALID_CHAR.test(c.body)) {
                const message = /^\\/.test(c.body)
                    ? `Неизвестное экранирование \`${c.body}\``
                    : '`char` — один байт: в нём помещается только один ASCII-символ. Для текста используйте строку `"..."`';
                push(i, c.start, c.end, message, 'error', 'bad-char');
            }
        }

        if (code === '') { continue; }
        const depth = countDepth(prefix);

        // Отступы
        if (prev) {
            if (depth > prev.depth + 1) {
                push(i, 0, prefix.length, `Отступ на ${depth - prev.depth} уровня глубже предыдущей строки, ожидается не больше одного`, 'error', 'indent');
            } else if (depth === prev.depth + 1 && !opensBlock(prev.code)) {
                push(i, 0, prefix.length, 'Лишний уровень `|`: предыдущая строка не открывает блок', 'warning', 'indent');
            }
            if (opensBlock(prev.code) && depth <= prev.depth) {
                push(prev.line, 0, rawLines[prev.line].length, 'Пустой блок: тело должно начинаться на следующей строке с ещё одной `|`', 'warning', 'empty-block');
            }
        } else if (depth > 0) {
            push(i, 0, prefix.length, 'Отступ `|` у первой строки программы', 'error', 'indent');
        }
        prev = { line: i, depth, code };

        const line = m.text;

        // Ветка в одну строку: `if x: return 1`, `else: echo("no")`
        const colon = inlineColon(code);
        if (colon >= 0) {
            const body = code.slice(colon + 1).trim();
            const at = prefix.length + m.text.slice(prefix.length).indexOf(code) + colon;
            if (body === '') {
                push(i, at, at + 1, 'После `:` нужна инструкция на той же строке. Для блока уберите `:` и начните тело со следующей строки', 'error', 'inline-if');
            } else if (/^(?:if|else|while|for|use)\b/.test(body) || /^\[/.test(body)) {
                push(i, at + 1, raw.length, 'В ветке через `:` — ровно одна простая инструкция. Вложенный `if`, цикл или объявление пишутся блоком с отступом', 'error', 'inline-if');
            }
        } else if (/^while\b.*:\s*\S/.test(code) && !/[([{]/.test(code.slice(code.indexOf(':')))) {
            const at = m.text.indexOf(':', prefix.length);
            push(i, at, raw.length, 'Ветка через `:` есть только у `if` / `else`. Тело `while` пишется блоком с отступом', 'error', 'inline-if');
        }

        // Обработка ошибок: `attempt` и `r? else ...`
        const codeAt = prefix.length + m.text.slice(prefix.length).indexOf(code);
        if (/^attempt\b\s*\S/.test(code)) {
            push(i, codeAt + 7, raw.length, 'После `attempt` ничего не пишется: тело — блок с отступом на следующей строке', 'error', 'attempt');
        }
        const elseAt = tryElse(code);
        if (elseAt >= 0) {
            const after = code.slice(elseAt + 4);
            const at = codeAt + elseAt;
            const action = after.match(/^\s*:(.*)$/);
            if (action) {
                const statements = splitTopLevel(action[1], ';');
                const last = statements[statements.length - 1];
                if (!statements.length) {
                    push(i, at, at + 5, 'После `? else:` нужна инструкция на той же строке, например `return`', 'error', 'try-else');
                } else if (statements.some(s => /^\[/.test(s) || /^(?:if|else|while|for|use|attempt|panic)\b/.test(s))) {
                    push(i, at, raw.length, 'В `? else:` — только простые инструкции через `;`. Для сложной обработки используйте `attempt`', 'error', 'try-else');
                } else if (!/^(?:return|break|continue)\b/.test(last)) {
                    push(i, at, raw.length, 'Обработчик `? else:` должен заканчиваться `return`, `break` или `continue`', 'error', 'try-else');
                }
            } else if (after.trim() === '') {
                push(i, at, at + 4, 'После `? else` нужно значение-замена или `:` и инструкции', 'error', 'try-else');
            }
        }

        // Метки
        for (const lm of line.matchAll(/@(\w+)/g)) {
            const name = lm[1];
            if (KNOWN_LABELS.has(name)) { continue; }
            const start = lm.index ?? 0;
            const message = name === 'decl'
                ? 'Метки `@decl` больше нет: нативные функции объявляются в `mono/mono.toml`'
                : `Неизвестная метка \`@${name}\`. Есть: @entry, @strict, @pure, @private, @overwrite`;
            push(i, start, start + name.length + 1, message, 'error', 'unknown-label');
        }

        // Синтаксис, которого больше нет или ещё нет
        const assoc = line.match(/^\s*(?:\|[ \t]*)*\[[^\]]+\]\s*(\w+)\s*::/);
        if (assoc) {
            const start = line.indexOf(assoc[1]);
            push(i, start, line.indexOf('::') + 2, 'Объявления `[T]Struct::method` больше нет: объявите метод внутри блока структуры', 'error', 'removed-syntax');
        }
        const lambda = line.match(/\^=\s*(\[[^\]]*\]\s*\()/);
        if (lambda) {
            const start = (lambda.index ?? 0) + lambda[0].indexOf('[');
            push(i, start, start + lambda[1].length, 'Лямбды пока не реализованы: объявите функцию и передайте её по имени', 'error', 'not-implemented');
        }
        for (const pm of line.matchAll(/\*\*/g)) {
            push(i, pm.index ?? 0, (pm.index ?? 0) + 2, 'Оператор `**` пока не реализован', 'error', 'not-implemented');
        }

        // Неизвестные функции. С `use` имена приходят из модулей, которые здесь не разбираются
        if (!hasImports && !/^\[/.test(code)) {
            const visible = new Set(visibleSymbols(doc, i).map(s => s.name));
            for (const cm of line.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)) {
                const name = cm[1];
                if (NOT_CALLS.has(name) || known.has(name) || visible.has(name)) { continue; }
                const start = cm.index ?? 0;
                push(i, start, start + name.length, `Функция \`${name}\` не найдена`, 'warning', 'unknown-function');
            }
        }
    }

    if (prev && opensBlock(prev.code)) {
        push(prev.line, 0, rawLines[prev.line].length, 'Пустой блок: тело должно начинаться на следующей строке с ещё одной `|`', 'warning', 'empty-block');
    }
    lintAttempts(doc, push);
    return result;
}
