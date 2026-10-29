// Лёгкий построчный разбор .ms файлов: структура блоков по `|`, объявления
// структур, функций, лямбд, полей и переменных. Не зависит от vscode API,
// чтобы его можно было гонять в обычном node.

export type SymbolKind = 'struct' | 'function' | 'method' | 'lambda' | 'field' | 'variable' | 'parameter';

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
    labels?: string[];
    /** Для `[void]Player::damage(...)` — `Player` */
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
    'if', 'else', 'while', 'for', 'in', 'return', 'break', 'continue', 'and', 'or', 'not', 'is',
    'use', 'const', 'final', 'public', 'private', 'this', 'defined', 'true', 'false', 'null', 'none'
]);

const STRUCT_RE = new RegExp(`^\\[\\s*struct\\s*\\]\\s*(${IDENT})\\s*((?:@\\w+\\s*)*)$`);
const FUNC_RE = new RegExp(`^\\[\\s*(${TYPE})\\s*\\]\\s*(?:(${IDENT})\\s*::\\s*)?(${IDENT})\\s*\\((.*)\\)\\s*((?:@\\w+\\s*)*)$`);
const LAMBDA_RE = new RegExp(`^(?:final\\s+)?(${IDENT})\\s*\\^=\\s*\\[\\s*(${TYPE})\\s*\\]\\s*\\((.*?)\\)\\s*(->|:)`);
const DYN_VAR_RE = new RegExp(`^(final\\s+)?(${IDENT})\\s*\\^=\\s*(.*)$`);
const TYPED_VAR_RE = new RegExp(`^(const\\s+)?(${TYPE})\\s+(${IDENT})\\s*(?:=(?!=)\\s*(.*))?$`);
const FOR_RE = new RegExp(`^for\\s+(${IDENT})\\s+in\\b`);

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
    if (/^-?\d+\.\d*$/.test(value)) { return 'float'; }
    if (/^-?\d+$/.test(value)) { return 'i32'; }
    if (/^(true|false)$/.test(value)) { return 'i1'; }
    if (/^\[/.test(value) && !/^\[\s*[\w<>, ]+\s*\]\s*\(/.test(value)) { return 'array'; }
    if (/^\{/.test(value)) { return 'map'; }
    const ctor = value.match(new RegExp(`^(${IDENT})\\s*\\(`));
    if (ctor && /^[A-Z]/.test(ctor[1])) { return ctor[1]; }
    const cast = value.match(/->\s*(i1|i8|i16|i32|i64|float)\s*$/);
    if (cast) { return cast[1]; }
    return undefined;
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

export function analyze(text: string): MsDocument {
    const rawLines = text.split(/\r?\n/);
    const lines = analyzeLines(text);
    const symbols: MsSymbol[] = [];
    const all: MsSymbol[] = [];
    // Стек открытых блочных символов (структуры, функции, лямбды)
    const stack: MsSymbol[] = [];

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

        const declareVar = (name: string, type: string | undefined, offset: number) => {
            // Повторное присваивание уже объявленной переменной — не новое объявление
            const scope = enclosing(stack, i);
            const existing = all.find(s => s.name === name && (s.kind === 'variable' || s.kind === 'field' || s.kind === 'parameter') && s.parent === scope);
            if (existing && !TYPED_VAR_RE.test(code)) { return; }
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
            const end = labels.includes('@decl') ? i : blockEnd(lines, i, info.depth);
            const parentStruct = stack.find(s => s.kind === 'struct' && s.depth < info.depth && s.endLine >= i);
            const kind: SymbolKind = m[2] || parentStruct ? 'method' : 'function';
            const sym: MsSymbol = {
                ...base,
                character: col + code.indexOf(m[3], code.indexOf(']')),
                name: m[3], kind, type: m[1].replace(/\s+/g, ''), params, labels,
                owner: m[2] ?? parentStruct?.name,
                endLine: end, doc: collectDoc(rawLines, i)
            };
            attach(sym);
            stack.push(sym);
            addParams(sym, params, i, all, rawLines[i]);
            continue;
        }

        m = code.match(LAMBDA_RE);
        if (m) {
            const params = parseParams(m[3]);
            const sym: MsSymbol = {
                ...base, name: m[1], kind: 'lambda', type: m[2].replace(/\s+/g, ''), params,
                endLine: m[4] === ':' ? blockEnd(lines, i, info.depth) : i,
                doc: collectDoc(rawLines, i)
            };
            attach(sym);
            stack.push(sym);
            addParams(sym, params, i, all, rawLines[i]);
            continue;
        }

        m = code.match(FOR_RE);
        if (m) {
            const owner = stack[stack.length - 1];
            all.push({ ...base, character: col + code.indexOf(m[1], 3), name: m[1], kind: 'variable', type: 'i32', endLine: blockEnd(lines, i, info.depth), parent: owner });
            continue;
        }

        m = code.match(DYN_VAR_RE);
        if (m) {
            declareVar(m[2], inferType(m[3]), code.indexOf(m[2]));
            continue;
        }

        m = code.match(TYPED_VAR_RE);
        if (m && !NOT_TYPES.has(m[2]) && !NOT_TYPES.has(m[3])) {
            declareVar(m[3], m[2].replace(/\s+/g, ''), code.indexOf(m[3], m[2].length + (m[1]?.length ?? 0)));
            continue;
        }

    }

    return { lines, symbols, all };
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
        case 'method':
        case 'lambda': {
            const params = (sym.params ?? []).map(p => `${p.type}: ${p.name}`).join(', ');
            const labels = sym.labels?.length ? ' ' + sym.labels.join(' ') : '';
            if (sym.kind === 'lambda') { return `${sym.name} ^= [${sym.type}](${params})`; }
            const owner = sym.owner && sym.kind === 'method' ? `${sym.owner}::` : '';
            return `[${sym.type}]${owner}${sym.name}(${params})${labels}`;
        }
        default:
            return sym.type ? `${sym.type} ${sym.name}` : `${sym.name} ^= …`;
    }
}

/** Самая глубокая функция/лямбда/структура, внутри которой находится строка. */
export function scopeAt(doc: MsDocument, line: number): MsSymbol | undefined {
    let best: MsSymbol | undefined;
    for (const s of doc.all) {
        if ((s.kind === 'function' || s.kind === 'method' || s.kind === 'lambda' || s.kind === 'struct') && s.line <= line && s.endLine >= line) {
            if (!best || s.depth >= best.depth) { best = s; }
        }
    }
    return best;
}

/** Символы, видимые в строке `line`: глобальные + из всех объемлющих областей, объявленные выше. */
export function visibleSymbols(doc: MsDocument, line: number): MsSymbol[] {
    const scopes = new Set<MsSymbol | undefined>([undefined]);
    for (let s = scopeAt(doc, line); s; s = s.parent) { scopes.add(s); }
    // Поля структуры видны внутри её методов
    const result: MsSymbol[] = [];
    for (const sym of doc.all) {
        if (!scopes.has(sym.parent)) { continue; }
        const isLocal = sym.kind === 'variable' || sym.kind === 'parameter';
        if (isLocal && sym.parent && sym.line > line) { continue; }
        result.push(sym);
    }
    for (const s of scopes) {
        if (s?.kind === 'method' && s.owner) {
            const struct = doc.all.find(x => x.kind === 'struct' && x.name === s.owner);
            if (struct) { result.push(...struct.children.filter(c => !result.includes(c))); }
        }
    }
    return result;
}
