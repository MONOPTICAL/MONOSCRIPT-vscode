// Лёгкий построчный разбор .ms файлов: структура блоков по `|`, объявления
// структур, функций, методов, полей и переменных. Не зависит от vscode API,
// чтобы его можно было гонять в обычном node.

import { BUILTIN_FUNCTIONS } from './builtins';

export type SymbolKind = 'struct' | 'function' | 'method' | 'field' | 'variable' | 'parameter';

export interface Param {
    type: string;
    name: string;
}

export interface MsSymbol {
    name: string;
    kind: SymbolKind;
    /** Тип переменной/поля или тип возврата функции */
    type?: string;
    params?: Param[];
    /** Параметры шаблона: `[T]first<T>(...)` — `['T']` */
    typeParams?: string[];
    labels?: string[];
    /** Для метода — структура, внутри которой он объявлен */
    owner?: string;
    line: number;
    character: number;
    /** Последняя строка блока (включительно) */
    endLine: number;
    depth: number;
    doc?: string;
    children: MsSymbol[];
    parent?: MsSymbol;
}

export interface LineInfo {
    /** Префикс отступа (`|   |   `) */
    prefix: string;
    depth: number;
    /** Текст после префикса без комментария и хвостовых пробелов */
    code: string;
    /** Строка пустая, только отступ или только комментарий */
    blank: boolean;
    inBlockComment: boolean;
}

export interface MsDocument {
    lines: LineInfo[];
    symbols: MsSymbol[];
    /** Все символы плоским списком (включая параметры и локальные переменные) */
    all: MsSymbol[];
}

export const PREFIX_RE = /^[ \t]*(?:\|(?!>)[ \t]*)*/;
const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
export const TYPE = `${IDENT}(?:<(?:[\\w\\s,]|<(?:[\\w\\s,]|<[\\w\\s,]*>)*>)*>)?`;

const NOT_TYPES = new Set([
    'if', 'else', 'attempt', 'panic', 'while', 'for', 'in', 'return', 'break', 'continue', 'and', 'or', 'is',
    'use', 'const', 'final', 'public', 'private', 'this', 'self', 'defined', 'true', 'false', 'null', 'none'
]);

const STRUCT_RE = new RegExp(`^\\[\\s*struct\\s*\\]\\s*(${IDENT})\\s*((?:@\\w+\\s*)*)$`);
// [ret]name<T, U>(params) @labels
const FUNC_RE = new RegExp(`^\\[\\s*(${TYPE})\\s*\\]\\s*(${IDENT})\\s*(?:<([\\w\\s,]*)>)?\\s*\\((.*)\\)\\s*((?:@\\w+\\s*)*)$`);
const DYN_VAR_RE = new RegExp(`^(final\\s+)?(${IDENT})\\s*\\^=\\s*(.*)$`);
// i32 x = 1 / const i32 x = 1 / final i32 x (присваивание позже)
const TYPED_VAR_RE = new RegExp(`^((?:const|final)\\s+)?(${TYPE})\\s+(${IDENT})\\s*(?:=(?!=)\\s*(.*))?$`);
const FOR_RE = new RegExp(`^for\\s+(${IDENT})\\s+in\\s+(.*)$`);
const CALL_RE = new RegExp(`^(${IDENT})\\s*\\(.*\\)$`);

const BLOCK_OPENERS: RegExp[] = [
    /^\[.+?\]\s*\w+\s*(?:<[\w\s,]*>)?\s*\(.*\)\s*(?:@\w+\s*)*$/,  // функция / метод / шаблон
    /^\[\s*struct\s*\]\s*\w+\s*(?:@\w+\s*)*$/,                     // структура
    /^(?:if|while)\b.*$/,
    /^for\s+\w+\s+in\b.*$/,
    /^else(?:\s+if\b.*|\s+[A-Za-z_]\w*)?$/,                        // else / else if / обработчик `else error`
    /^attempt$/,
    /^panic\s+[A-Za-z_]\w*$/
];

/** Обработчик блока `attempt`: `else error` или `panic info`. */
export const HANDLER_RE = new RegExp(`^(else|panic)\\s+(${IDENT})$`);

/** Тип имени, которое связывает обработчик: ошибка из `result` или снимок паники. */
export function handlerBindingType(kind: string): string {
    return kind === 'panic' ? 'panic_info' : 'result<void>';
}

/**
 * Позиция слова `else` в `r? else ...` (замена или обработчик в строку) или -1.
 * Строки, символы и скобки пропускаются.
 */
export function tryElse(code: string): number {
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '"' || ch === "'") {
            for (i++; i < code.length && code[i] !== ch; i++) { if (code[i] === '\\') { i++; } }
            continue;
        }
        if (ch === '/' && code[i + 1] === '/') { return -1; }
        if ('([{'.includes(ch)) { depth++; }
        else if (')]}'.includes(ch)) { depth--; }
        else if (ch === '?' && depth === 0) {
            const m = code.slice(i).match(/^\?+\s*else\b/);
            if (m) { return i + m[0].length - 4; }
        }
    }
    return -1;
}

/** Строка (без префикса `|` и комментария) открывает блок на следующей строке. */
export function opensBlock(code: string): boolean {
    if (inlineColon(code) >= 0) { return false; } // `if x: return 1` — ветка в одну строку
    return BLOCK_OPENERS.some(re => re.test(code));
}

/**
 * Позиция `:` инлайн-ветки `if cond: stmt`, `else if cond: stmt`, `else: stmt`
 * или -1. Двоеточия внутри строк, символов и скобок не считаются.
 */
export function inlineColon(code: string): number {
    if (!/^(?:if|else)\b/.test(code)) { return -1; }
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '"' || ch === "'") {
            for (i++; i < code.length && code[i] !== ch; i++) { if (code[i] === '\\') { i++; } }
            continue;
        }
        if (ch === '/' && code[i + 1] === '/') { return -1; }
        if ('([{'.includes(ch)) { depth++; }
        else if (')]}'.includes(ch)) { depth--; }
        else if (ch === ':' && depth === 0) { return i; }
    }
    return -1;
}

/** `r?`, `r??`: каждый постфиксный `?` разворачивает один `result<T>`. */
export function unwrapTry(type: string | undefined, count: number): string | undefined {
    for (let k = 0; k < count && type; k++) {
        const m = type.match(/^result<(.*)>$/);
        type = m ? m[1].trim() : undefined;
    }
    return type;
}

export function countDepth(prefix: string): number {
    let n = 0;
    for (const ch of prefix) {
        if (ch === '|') { n++; }
    }
    return n;
}

/** Убирает `//` комментарий, не трогая `//` внутри строк. */
export function stripLineComment(text: string): string {
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; }
            else if (ch === '"') { inString = false; }
        } else if (ch === '"') {
            inString = true;
        } else if (ch === '/' && text[i + 1] === '/') {
            return text.slice(0, i);
        }
    }
    return text;
}

/** Делит по запятым верхнего уровня (не внутри <>, (), [], строк). */
export function splitTopLevel(text: string, sep = ','): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; }
            else if (ch === '"') { inString = false; }
            continue;
        }
        if (ch === '"') { inString = true; }
        else if ('<([{'.includes(ch)) { depth++; }
        else if (ch === '>' && text[i - 1] === '-') { continue; } // стрелка `->`
        else if ('>)]}'.includes(ch)) { depth--; }
        else if (ch === sep && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

export function parseParams(text: string): Param[] {
    const result: Param[] = [];
    for (const part of splitTopLevel(text)) {
        const func = part.match(new RegExp(`^func\\s*:\\s*(${IDENT})?\\s*\\((.*)\\)\\s*->\\s*(${TYPE})$`));
        if (func) {
            const inner = parseParams(func[2]).map(p => p.type);
            result.push({ type: `func<${[...inner, func[3]].join(', ')}>`, name: func[1] ?? '' });
            continue;
        }
        const m = part.match(new RegExp(`^(${TYPE})\\s*:\\s*(${IDENT})$`));
        if (m) {
            result.push({ type: m[1].replace(/\s+/g, ''), name: m[2] });
        }
    }
    return result;
}

/** Грубый вывод типа по правой части `x ^= ...`. */
export function inferType(rhs: string): string | undefined {
    const value = rhs.trim();
    if (/^"/.test(value)) { return 'string'; }
    if (/^'(?:\\.|[^'\\])'$/.test(value)) { return 'char'; }
    // Дробный литерал по умолчанию — f64
    if (/^-?\d+\.\d*$/.test(value)) { return 'f64'; }
    if (/^-?\d+$/.test(value)) {
        // Как в компиляторе: целый литерал получает самый узкий подходящий тип
        const n = Number(value);
        if (n === 0 || n === 1) { return 'i1'; }
        if (n >= -128 && n <= 127) { return 'i8'; }
        if (n >= -32768 && n <= 32767) { return 'i16'; }
        if (n >= -2147483648 && n <= 2147483647) { return 'i32'; }
        return 'i64';
    }
    if (/^(true|false)$/.test(value)) { return 'i1'; }
    if (/^\[/.test(value) && !/^\[\s*[\w<>, ]+\s*\]\s*\(/.test(value)) { return 'array'; }
    if (/^\{/.test(value)) { return 'map'; }
    const ctor = value.match(new RegExp(`^(${IDENT})\\s*\\(`));
    if (ctor && /^[A-Z]/.test(ctor[1])) { return ctor[1]; }
    const cast = value.match(/->\s*(i1|i8|i16|i32|i64|float|f64|char)\s*$/);
    if (cast) { return cast[1]; }
    return undefined;
}

/** `name(...)`, где закрывающая скобка вызова — последний символ. Возвращает имя. */
function wholeCall(value: string): string | undefined {
    const m = value.match(CALL_RE);
    if (!m) { return undefined; }
    let depth = 0;
    let inString = false;
    for (let i = value.indexOf('('); i < value.length; i++) {
        const ch = value[i];
        if (inString) {
            if (ch === '\\') { i++; } else if (ch === '"') { inString = false; }
            continue;
        }
        if (ch === '"') { inString = true; }
        else if (ch === '(') { depth++; }
        else if (ch === ')' && --depth === 0) { return i === value.length - 1 ? m[1] : undefined; }
    }
    return undefined;
}

/** Тип элемента при обходе: `array<T>` -> T, `map<K, V>` -> K, `string` -> char. */
export function elementType(type: string | undefined): string | undefined {
    if (!type) { return undefined; }
    if (type === 'string') { return 'char'; }
    const m = type.match(/^(array|map)<(.*)>$/);
    if (!m) { return undefined; }
    const args = splitTopLevel(m[2]);
    return args[0];
}

/** Зависит ли тип от параметров шаблона: `array<T>` при `<T>`. */
function hasTypeParams(type: string, typeParams: string[] | undefined): boolean {
    return !!typeParams?.some(t => new RegExp(`\\b${t}\\b`).test(type));
}

export function analyzeLines(text: string): LineInfo[] {
    const result: LineInfo[] = [];
    let inBlock = false;
    for (const raw of text.split(/\r?\n/)) {
        const startedInBlock = inBlock;
        let line = raw;
        // Вырезаем /* ... */ (в т.ч. многострочные)
        let visible = '';
        let i = 0;
        while (i < line.length) {
            if (inBlock) {
                const end = line.indexOf('*/', i);
                if (end < 0) { i = line.length; break; }
                inBlock = false;
                i = end + 2;
                visible += ' ';
            } else {
                const start = line.indexOf('/*', i);
                const lineComment = stripLineComment(line.slice(i));
                if (start < 0 || start - i >= lineComment.length) {
                    visible += lineComment;
                    break;
                }
                visible += line.slice(i, start);
                inBlock = true;
                i = start + 2;
            }
        }
        line = visible;
        const prefix = (raw.match(PREFIX_RE) ?? [''])[0];
        const code = line.slice(Math.min(prefix.length, line.length)).trim();
        result.push({
            prefix,
            depth: countDepth(prefix),
            code,
            blank: code.length === 0,
            inBlockComment: startedInBlock
        });
    }
    return result;
}

/** Последняя непустая строка блока, начатого на `line` с глубиной `depth`. */
export function blockEnd(lines: LineInfo[], line: number, depth: number): number {
    let end = line;
    for (let i = line + 1; i < lines.length; i++) {
        const info = lines[i];
        if (info.blank) {
            // Строки только из `|` тоже принадлежат блоку
            if (info.depth > depth) { end = i; }
            continue;
        }
        if (info.depth <= depth) { break; }
        end = i;
    }
    return end;
}

function collectDoc(rawLines: string[], line: number): string | undefined {
    const docs: string[] = [];
    for (let i = line - 1; i >= 0; i--) {
        const m = rawLines[i].match(/^[ \t]*(?:\|(?!>)[ \t]*)*\/\/\s?(.*)$/);
        if (!m) { break; }
        docs.unshift(m[1]);
    }
    return docs.length ? docs.join('\n') : undefined;
}

/** `external` — тип возврата функции из других файлов (для `x ^= f()`, когда `f` объявлена не здесь). */
export function analyze(text: string, external?: (name: string) => string | undefined): MsDocument {
    const rawLines = text.split(/\r?\n/);
    const lines = analyzeLines(text);
    const symbols: MsSymbol[] = [];
    const all: MsSymbol[] = [];
    // Стек открытых блочных символов (структуры, функции, методы)
    const stack: MsSymbol[] = [];
    const pendingCalls: { sym: MsSymbol; callee: string; tries: number }[] = [];
    const pendingFors: { sym: MsSymbol; iterable: string }[] = [];

    const attach = (sym: MsSymbol) => {
        while (stack.length && (stack[stack.length - 1].depth >= sym.depth || stack[stack.length - 1].endLine < sym.line)) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        if (parent) {
            sym.parent = parent;
            parent.children.push(sym);
        } else {
            symbols.push(sym);
        }
        all.push(sym);
    };

    for (let i = 0; i < lines.length; i++) {
        const info = lines[i];
        if (info.blank || info.inBlockComment && info.code === '') { continue; }
        const code = info.code;
        const col = info.prefix.length;
        const base = { line: i, character: col, depth: info.depth, children: [] as MsSymbol[] };

        const declareVar = (name: string, type: string | undefined, offset: number): MsSymbol | undefined => {
            // Повторное присваивание уже объявленной переменной — не новое объявление
            const scope = enclosing(stack, i);
            const existing = all.find(s => s.name === name && (s.kind === 'variable' || s.kind === 'field' || s.kind === 'parameter') && s.parent === scope);
            if (existing && !TYPED_VAR_RE.test(code)) { return undefined; }
            const isField = scope?.kind === 'struct';
            const sym: MsSymbol = {
                ...base, character: col + offset, name, kind: isField ? 'field' : 'variable', type,
                endLine: scope ? scope.endLine : lines.length - 1, doc: collectDoc(rawLines, i)
            };
            if (isField || !scope) {
                attach(sym);
            } else {
                sym.parent = scope;
                all.push(sym);
            }
            return sym;
        };


        let m = code.match(STRUCT_RE);
        if (m) {
            const sym: MsSymbol = { ...base, name: m[1], kind: 'struct', labels: labelsOf(m[2]), endLine: blockEnd(lines, i, info.depth), doc: collectDoc(rawLines, i) };
            attach(sym);
            stack.push(sym);
            continue;
        }

        m = code.match(FUNC_RE);
        if (m) {
            const labels = labelsOf(m[5]);
            const params = parseParams(m[4]);
            const typeParams = m[3]?.split(',').map(t => t.trim()).filter(t => t.length > 0);
            const parentStruct = stack.find(s => s.kind === 'struct' && s.depth < info.depth && s.endLine >= i);
            const kind: SymbolKind = parentStruct ? 'method' : 'function';
            const sym: MsSymbol = {
                ...base,
                character: col + code.indexOf(m[2], code.indexOf(']')),
                name: m[2], kind, type: m[1].replace(/\s+/g, ''), params, labels,
                typeParams: typeParams?.length ? typeParams : undefined,
                owner: parentStruct?.name,
                endLine: blockEnd(lines, i, info.depth), doc: collectDoc(rawLines, i)
            };
            attach(sym);
            stack.push(sym);
            addParams(sym, params, i, all, rawLines[i]);
            continue;
        }

        m = code.match(FOR_RE);
        if (m) {
            const owner = enclosing(stack, i) ?? stack[stack.length - 1];
            const sym: MsSymbol = { ...base, character: col + code.indexOf(m[1], 3), name: m[1], kind: 'variable', endLine: blockEnd(lines, i, info.depth), parent: owner };
            all.push(sym);
            pendingFors.push({ sym, iterable: m[2].trim() });
            continue;
        }

        // `else error` / `panic info` после `attempt`: имя видно только внутри обработчика
        m = code.match(HANDLER_RE);
        if (m) {
            const owner = enclosing(stack, i) ?? stack[stack.length - 1];
            all.push({
                ...base, character: col + code.lastIndexOf(m[2]), name: m[2], kind: 'variable',
                type: handlerBindingType(m[1]), endLine: blockEnd(lines, i, info.depth), parent: owner
            });
            continue;
        }
        // `r? else: ...` связывает `error` до конца строки
        const elseAt = tryElse(code);
        if (elseAt >= 0 && /^else\s*:/.test(code.slice(elseAt))) {
            const owner = enclosing(stack, i) ?? stack[stack.length - 1];
            all.push({ ...base, character: col + elseAt, name: 'error', kind: 'variable', type: 'result<void>', endLine: i, parent: owner });
        }

        m = code.match(DYN_VAR_RE);
        if (m) {
            if (m[2] === '_') { continue; } // `_ ^= save()` — результат игнорируется
            // `x ^= toInt(s)?` — тип вызова без одного `result<>` на каждый `?`.
            // `x ^= toInt(s)? else 0` — тот же тип: замена должна ему подходить
            const fallback = tryElse(m[3]);
            const rhs = (fallback >= 0 ? m[3].slice(0, fallback) : m[3]).trim();
            const tries = (rhs.match(/\?+$/) ?? [''])[0].length;
            const callExpr = rhs.slice(0, rhs.length - tries).trim();
            const sym = declareVar(m[2], tries ? undefined : inferType(rhs), code.indexOf(m[2]));
            const callee = sym && !sym.type ? wholeCall(callExpr) : undefined;
            if (sym && callee) { pendingCalls.push({ sym, callee, tries }); }
            continue;
        }

        m = code.match(TYPED_VAR_RE);
        if (m && !NOT_TYPES.has(m[2]) && !NOT_TYPES.has(m[3])) {
            declareVar(m[3], m[2].replace(/\s+/g, ''), code.indexOf(m[3], m[2].length + (m[1]?.length ?? 0)));
            continue;
        }

    }

    // Типы, которые известны только после разбора всего файла:
    // `x ^= f()` (функцию можно вызывать до объявления) и переменная цикла `for`
    const callType = (callee: string) => returnTypeOf(all, callee) ?? external?.(callee);
    for (const { sym, callee, tries } of pendingCalls) {
        sym.type = unwrapTry(callType(callee), tries);
    }
    for (const { sym, iterable } of pendingFors) {
        if (/^range\s*\(/.test(iterable)) { sym.type = 'i32'; continue; }
        const callee = wholeCall(iterable);
        if (callee) { sym.type = elementType(callType(callee)); continue; }
        // items / self.scores / player.inventory.items
        if (/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*$/.test(iterable)) {
            sym.type = elementType(typeOfPath(all, iterable.split('.').map(x => x.trim()), sym.line));
        }
    }

    return { lines, symbols, all };
}

/** Тип выражения `a.b.c` в строке `line`: переменная (или `self`), затем поля структур. */
function typeOfPath(all: MsSymbol[], path: string[], line: number): string | undefined {
    let type: string | undefined;
    if (path[0] === 'self') {
        type = all.filter(s => s.kind === 'method' && s.line <= line && s.endLine >= line).sort((a, b) => b.depth - a.depth)[0]?.owner;
    } else {
        type = all
            .filter(s => s.name === path[0] && (s.kind === 'variable' || s.kind === 'parameter') && s.line <= line && s.endLine >= line)
            .sort((a, b) => b.line - a.line)[0]?.type;
    }
    for (const field of path.slice(1)) {
        const struct = all.find(s => s.kind === 'struct' && s.name === type);
        type = struct?.children.find(c => c.kind === 'field' && c.name === field)?.type;
    }
    return type;
}

/** Параметр в том виде, как он пишется в коде: `i32: x`, `func: keep(T: x) -> i1`. */
export function formatParam(p: Param): string {
    const fn = p.type.match(/^func<(.*)>$/);
    if (!fn) { return `${p.type}: ${p.name}`; }
    const types = splitTopLevel(fn[1]);
    const ret = types.pop() ?? 'void';
    return `func: ${p.name}(${types.join(', ')}) -> ${ret}`;
}

function returnTypeOf(all: MsSymbol[], callee: string): string | undefined {
    if (/^[A-Z]/.test(callee) && all.some(s => s.kind === 'struct' && s.name === callee)) { return callee; }
    const fn = all.find(s => s.kind === 'function' && s.name === callee);
    if (fn) { return fn.type && !hasTypeParams(fn.type, fn.typeParams) ? fn.type : undefined; }
    const builtin = BUILTIN_FUNCTIONS.find(f => f.name === callee);
    return builtin && !/\b[TKV]\b/.test(builtin.ret) && builtin.ret !== 'range' ? builtin.ret : undefined;
}

function enclosing(stack: MsSymbol[], line: number): MsSymbol | undefined {
    for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].endLine >= line && stack[k].line < line) { return stack[k]; }
    }
    return undefined;
}

function labelsOf(text: string | undefined): string[] {
    return (text ?? '').match(/@\w+/g) ?? [];
}

function addParams(owner: MsSymbol, params: Param[], line: number, all: MsSymbol[], raw: string) {
    const open = raw.indexOf('(');
    for (const p of params) {
        const re = new RegExp(`:\\s*(${p.name})\\b`);
        const m = re.exec(raw.slice(open));
        all.push({
            name: p.name, kind: 'parameter', type: p.type,
            line, character: m ? open + m.index + m[0].length - p.name.length : owner.character,
            endLine: owner.endLine, depth: owner.depth + 1, children: [], parent: owner
        });
    }
}

export function signatureOf(sym: MsSymbol): string {
    switch (sym.kind) {
        case 'struct':
            return `[struct]${sym.name}`;
        case 'function':
        case 'method': {
            const params = (sym.params ?? []).map(formatParam).join(', ');
            const labels = sym.labels?.length ? ' ' + sym.labels.join(' ') : '';
            const generic = sym.typeParams?.length ? `<${sym.typeParams.join(', ')}>` : '';
            return `[${sym.type}]${sym.name}${generic}(${params})${labels}`;
        }
        default:
            return sym.type ? `${sym.type} ${sym.name}` : `${sym.name} ^= …`;
    }
}

/** Самая глубокая функция/метод/структура, внутри которой находится строка. */
export function scopeAt(doc: MsDocument, line: number): MsSymbol | undefined {
    let best: MsSymbol | undefined;
    for (const s of doc.all) {
        if ((s.kind === 'function' || s.kind === 'method' || s.kind === 'struct') && s.line <= line && s.endLine >= line) {
            if (!best || s.depth >= best.depth) { best = s; }
        }
    }
    return best;
}

/** Метод, внутри которого находится строка (для `self`). */
export function methodAt(doc: MsDocument, line: number): MsSymbol | undefined {
    for (let s = scopeAt(doc, line); s; s = s.parent) {
        if (s.kind === 'method') { return s; }
    }
    return undefined;
}

/**
 * Символы, видимые в строке `line`: глобальные + из всех объемлющих областей, объявленные выше.
 * Поля и методы структуры сюда не входят: внутри метода к ним обращаются через `self.`.
 */
export function visibleSymbols(doc: MsDocument, line: number): MsSymbol[] {
    const scopes = new Set<MsSymbol | undefined>([undefined]);
    for (let s = scopeAt(doc, line); s; s = s.parent) { scopes.add(s); }
    const result: MsSymbol[] = [];
    for (const sym of doc.all) {
        if (!scopes.has(sym.parent)) { continue; }
        if (sym.kind === 'field' || sym.kind === 'method') { continue; }
        const isLocal = sym.kind === 'variable' || sym.kind === 'parameter';
        // Переменная цикла и имя обработчика видны только внутри своего блока
        if (isLocal && sym.parent && (sym.line > line || sym.endLine < line)) { continue; }
        result.push(sym);
    }
    return result;
}
