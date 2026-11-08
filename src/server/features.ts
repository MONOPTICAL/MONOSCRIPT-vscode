import {
    CompletionItem, CompletionItemKind, DocumentHighlight, DocumentHighlightKind, DocumentSymbol,
    FoldingRange, FoldingRangeKind, Hover, InlayHint, InlayHintKind, InsertTextFormat, InsertTextMode,
    Location, MarkupKind, ParameterInformation, Position, Range, SignatureHelp, SignatureInformation,
    SymbolInformation, SymbolKind, TextEdit, WorkspaceEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    MsDocument, MsSymbol, PREFIX_RE, countDepth, formatParam, methodAt, signatureOf, visibleSymbols
} from '../analyzer';
import { BUILTIN_FUNCTIONS, CASTABLE_TYPES, KEYWORDS, LABELS, PANIC_INFO_MEMBERS, RESULT_MEMBERS, TYPES, builtinSignature } from '../builtins';
import { guideLink, sectionForWord } from '../guide/sections';
import { maskLine } from './lint';
import { IndexedFile, WorkspaceIndex } from './workspace';

// Возможности языкового сервера: всё, что работает по разбору analyzer.ts.

export interface SnippetDef {
    prefix: string;
    body: string[];
    description?: string;
}

const WORD_RE = /@?[A-Za-z_][A-Za-z0-9_]*/g;
const PARAM_HINTS = { title: '', command: 'editor.action.triggerParameterHints' };

const SYMBOL_KINDS: Record<MsSymbol['kind'], SymbolKind> = {
    struct: SymbolKind.Struct,
    function: SymbolKind.Function,
    method: SymbolKind.Method,
    field: SymbolKind.Field,
    variable: SymbolKind.Variable,
    parameter: SymbolKind.Variable
};

const COMPLETION_KINDS: Record<MsSymbol['kind'], CompletionItemKind> = {
    struct: CompletionItemKind.Struct,
    function: CompletionItemKind.Function,
    method: CompletionItemKind.Method,
    field: CompletionItemKind.Field,
    variable: CompletionItemKind.Variable,
    parameter: CompletionItemKind.Variable
};

const KIND_NAMES: Record<MsSymbol['kind'], string> = {
    struct: 'структура', function: 'функция', method: 'метод', field: 'поле', variable: 'переменная', parameter: 'параметр'
};

const codeblock = (code: string) => '```ms\n' + code + '\n```';
const md = (value: string) => ({ kind: MarkupKind.Markdown, value });

function lineText(document: TextDocument, line: number): string {
    return document.getText(Range.create(line, 0, line + 1, 0)).replace(/\r?\n$/, '');
}

function wordAt(text: string, character: number, re: RegExp = WORD_RE): { word: string; start: number; end: number } | undefined {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
        const start = m.index ?? 0;
        if (start <= character && character <= start + m[0].length) { return { word: m[0], start, end: start + m[0].length }; }
    }
    return undefined;
}

function symbolMarkdown(sym: MsSymbol): string {
    const parts = [codeblock(signatureOf(sym))];
    let kind = `*${sym.kind === 'function' && sym.typeParams ? 'шаблон функции' : KIND_NAMES[sym.kind]}*`;
    if (sym.owner && sym.kind === 'method') { kind += ` структуры \`${sym.owner}\``; }
    parts.push(kind);
    if (sym.doc) { parts.push('---', sym.doc); }
    for (const label of sym.labels ?? []) {
        if (LABELS[label]) { parts.push(`\`${label}\` — ${LABELS[label]}`); }
    }
    return parts.join('\n\n');
}

function resultInner(type: string | undefined): string | undefined {
    return type?.match(/^result<(.*)>$/)?.[1];
}

function isLocal(sym: MsSymbol): boolean {
    return sym.kind === 'parameter' || (sym.kind === 'variable' && !!sym.parent);
}

function nameRange(sym: MsSymbol): Range {
    return Range.create(sym.line, sym.character, sym.line, sym.character + sym.name.length);
}

export class Features {
    constructor(
        private readonly index: WorkspaceIndex,
        private readonly snippets: Record<string, SnippetDef>,
        private readonly indentUnit: () => Promise<string>
    ) { }

    // ---------- Структура документа ----------

    documentSymbols(document: TextDocument): DocumentSymbol[] {
        const doc = this.index.get(document);
        const convert = (sym: MsSymbol): DocumentSymbol => {
            const end = Math.min(sym.endLine, document.lineCount - 1);
            const detail = sym.kind === 'field' || sym.kind === 'variable'
                ? sym.type ?? ''
                : signatureOf(sym).replace(/^\S*?\]/, '').replace(sym.name, '').trim();
            return {
                name: sym.name, detail, kind: SYMBOL_KINDS[sym.kind],
                range: Range.create(sym.line, 0, end, lineText(document, end).length),
                selectionRange: nameRange(sym),
                children: sym.children.map(convert)
            };
        };
        return doc.symbols.map(convert);
    }

    workspaceSymbols(query: string): SymbolInformation[] {
        const q = query.toLowerCase();
        const result: SymbolInformation[] = [];
        for (const { uri, doc } of this.index.all()) {
            for (const s of doc.all) {
                if (isLocal(s)) { continue; }
                if (q && !s.name.toLowerCase().includes(q)) { continue; }
                result.push({
                    name: s.name, kind: SYMBOL_KINDS[s.kind], containerName: s.parent?.name ?? s.owner,
                    location: Location.create(uri, nameRange(s))
                });
            }
        }
        return result;
    }

    foldingRanges(document: TextDocument): FoldingRange[] {
        const doc = this.index.get(document);
        const lines = doc.lines;
        const ranges: FoldingRange[] = [];

        for (let i = 0; i < lines.length; i++) {
            const info = lines[i];
            if (info.blank) { continue; }
            let end = i;
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].blank && lines[j].depth <= info.depth) { continue; }
                if (lines[j].depth <= info.depth && !lines[j].blank) { break; }
                if (!lines[j].blank) { end = j; }
            }
            if (end > i) { ranges.push({ startLine: i, endLine: end }); }
        }

        const raw = document.getText().split(/\r?\n/);
        let commentStart = -1;
        for (let i = 0; i <= raw.length; i++) {
            const isComment = i < raw.length && raw[i].replace(PREFIX_RE, '').startsWith('//');
            if (isComment && commentStart < 0) { commentStart = i; }
            if (!isComment && commentStart >= 0) {
                if (i - 1 > commentStart) { ranges.push({ startLine: commentStart, endLine: i - 1, kind: FoldingRangeKind.Comment }); }
                commentStart = -1;
            }
        }
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].inBlockComment && i + 1 < lines.length && lines[i + 1].inBlockComment) {
                let j = i + 1;
                while (j + 1 < lines.length && lines[j + 1].inBlockComment) { j++; }
                ranges.push({ startLine: i, endLine: j, kind: FoldingRangeKind.Comment });
                i = j;
            }
        }
        const stack: number[] = [];
        raw.forEach((text, i) => {
            if (/\/\/\s*#region\b/.test(text)) { stack.push(i); }
            else if (/\/\/\s*#endregion\b/.test(text) && stack.length) {
                ranges.push({ startLine: stack.pop() as number, endLine: i, kind: FoldingRangeKind.Region });
            }
        });
        return ranges;
    }

    // ---------- Автодополнение ----------

    async completion(document: TextDocument, position: Position): Promise<CompletionItem[]> {
        const text = lineText(document, position.line);
        const before = text.slice(0, position.character);
        const doc = this.index.get(document);

        if (/\/\/.*$/.test(before.replace(/"(?:\\.|[^"\\])*"/g, '""'))) { return []; }

        const member = before.match(/([A-Za-z_]\w*)\s*\.\s*\w*$/);
        if (member) { return this.memberCompletions(doc, member[1], position.line); }

        if (/@\w*$/.test(before)) {
            const at = before.lastIndexOf('@');
            const range = Range.create(position.line, at, position.line, position.character);
            return Object.entries(LABELS).map(([label, desc]) => ({
                label, kind: CompletionItemKind.Keyword, documentation: md(desc), textEdit: TextEdit.replace(range, label)
            }));
        }

        if (/(?:^|[^\w\])])\[\s*\w*$/.test(before)) {
            return [...this.typeCompletions(doc, position.line),
                { label: 'struct', kind: CompletionItemKind.Keyword, detail: '[struct]Name' }];
        }
        if (/\bfunc\s*:.*->\s*\w*$/.test(before)) { return this.typeCompletions(doc, position.line); }
        if (/->\s*\w*$/.test(before)) {
            return CASTABLE_TYPES.map(t => ({ label: t, kind: CompletionItemKind.TypeParameter, documentation: md(TYPES[t] ?? '') }));
        }

        const items: CompletionItem[] = [];
        const seen = new Set<string>();
        const push = (item: CompletionItem) => {
            if (seen.has(item.label)) { return; }
            seen.add(item.label);
            items.push(item);
        };

        const method = methodAt(doc, position.line);
        if (method?.owner) {
            push({ label: 'self', kind: CompletionItemKind.Variable, labelDetails: { description: method.owner }, documentation: md(`Текущий объект \`${method.owner}\``), sortText: '0self' });
        }
        for (const sym of visibleSymbols(doc, position.line).sort((a, b) => b.line - a.line)) {
            push(this.symbolItem(sym, '0'));
        }
        for (const { doc: other } of this.index.all()) {
            if (other === doc) { continue; }
            for (const sym of other.symbols) {
                if (sym.kind === 'struct' || sym.kind === 'function') { push(this.symbolItem(sym, '2')); }
            }
        }
        for (const f of BUILTIN_FUNCTIONS) {
            push({
                label: f.name, kind: CompletionItemKind.Function,
                labelDetails: { detail: `(${f.params.map(p => p.type).join(', ')})`, description: f.ret },
                documentation: md(codeblock(builtinSignature(f)) + '\n\n' + f.doc),
                insertText: f.params.length ? `${f.name}($1)` : `${f.name}()`,
                insertTextFormat: InsertTextFormat.Snippet,
                command: PARAM_HINTS,
                sortText: '1' + f.name
            });
        }
        for (const [kw, desc] of Object.entries(KEYWORDS)) {
            push({ label: kw, kind: CompletionItemKind.Keyword, documentation: md(desc), sortText: '3' + kw });
        }
        this.typeCompletions(doc, position.line).forEach(push);
        items.push(...await this.snippetItems(text, position));
        return items;
    }

    /**
     * Сниппеты отдаёт сервер, а не contributes.snippets: при вставке VS Code копирует
     * в следующие строки только пробельный отступ, и `|`-префикс терялся.
     */
    private async snippetItems(text: string, position: Position): Promise<CompletionItem[]> {
        const prefix = (text.match(PREFIX_RE) ?? [''])[0];
        if (position.character < prefix.length) { return []; }
        const atLineStart = /^\w*$/.test(text.slice(prefix.length, position.character));
        const wordStart = position.character - (text.slice(0, position.character).match(/\w*$/)?.[0].length ?? 0);
        const range = Range.create(position.line, wordStart, position.line, position.character);
        const unit = await this.indentUnit();
        const linePrefix = prefix.endsWith('|') ? prefix + unit.slice(1) : prefix;

        const items: CompletionItem[] = [];
        for (const [name, def] of Object.entries(this.snippets)) {
            if (def.body.length > 1 && !atLineStart) { continue; }
            const body = def.body.map((l, i) => i === 0 ? l : linePrefix + l).join('\n');
            items.push({
                label: def.prefix, kind: CompletionItemKind.Snippet,
                labelDetails: { description: name },
                detail: def.description,
                documentation: md(codeblock(def.body.join('\n'))),
                textEdit: TextEdit.replace(range, body),
                insertTextFormat: InsertTextFormat.Snippet,
                insertTextMode: InsertTextMode.asIs,
                sortText: '5' + def.prefix
            });
        }
        return items;
    }

    private symbolItem(sym: MsSymbol, sortPrefix: string): CompletionItem {
        const callable = sym.kind === 'function' || sym.kind === 'method';
        const item: CompletionItem = {
            label: sym.name, kind: COMPLETION_KINDS[sym.kind],
            labelDetails: { detail: callable ? `(${(sym.params ?? []).map(p => p.type).join(', ')})` : undefined, description: sym.type },
            documentation: md(symbolMarkdown(sym)),
            sortText: sortPrefix + sym.name
        };
        if (callable) {
            item.insertText = sym.params?.length ? `${sym.name}($1)` : `${sym.name}()`;
            item.insertTextFormat = InsertTextFormat.Snippet;
            item.command = PARAM_HINTS;
        } else if (sym.kind === 'struct') {
            item.insertText = `${sym.name}()`;
        }
        return item;
    }

    private typeCompletions(doc: MsDocument, line: number): CompletionItem[] {
        const snippetFor: Record<string, string> = { array: 'array<${1:i32}>', map: 'map<${1:string}, ${2:i32}>', result: 'result<${1:i32}>' };
        const items: CompletionItem[] = Object.entries(TYPES).filter(([t]) => t !== 'struct' && t !== 'panic_info').map(([t, desc]) => ({
            label: t, kind: CompletionItemKind.TypeParameter, documentation: md(desc), sortText: '4' + t,
            ...(snippetFor[t] ? { insertText: snippetFor[t], insertTextFormat: InsertTextFormat.Snippet } : {})
        }));
        for (const s of this.structNames(doc)) {
            items.push({ label: s, kind: CompletionItemKind.Struct, sortText: '4' + s });
        }
        // Параметры шаблона объемлющей функции: T, K, V
        const fn = doc.all.find(s => s.kind === 'function' && s.typeParams && s.line <= line && s.endLine >= line);
        for (const t of fn?.typeParams ?? []) {
            items.push({ label: t, kind: CompletionItemKind.TypeParameter, detail: `параметр шаблона ${fn?.name}`, sortText: '0' + t });
        }
        return items;
    }

    private structNames(doc: MsDocument): string[] {
        const names = new Set(doc.all.filter(s => s.kind === 'struct').map(s => s.name));
        for (const { doc: d } of this.index.all()) {
            d.symbols.filter(s => s.kind === 'struct').forEach(s => names.add(s.name));
        }
        return [...names];
    }

    private findStruct(name: string | undefined, doc: MsDocument): { struct: MsSymbol; uri?: string } | undefined {
        if (!name) { return undefined; }
        const local = doc.all.find(s => s.kind === 'struct' && s.name === name);
        if (local) { return { struct: local }; }
        for (const { uri, doc: d } of this.index.all()) {
            const struct = d.all.find(s => s.kind === 'struct' && s.name === name);
            if (struct) { return { struct, uri }; }
        }
        return undefined;
    }

    private typeOf(doc: MsDocument, name: string, line: number): string | undefined {
        if (name === 'self') { return methodAt(doc, line)?.owner; }
        return this.resolveVariable(doc, name, line)?.type;
    }

    private resolveVariable(doc: MsDocument, name: string, line: number): MsSymbol | undefined {
        const candidates = visibleSymbols(doc, line).filter(s => s.name === name);
        candidates.sort((a, b) => (b.depth - a.depth) || (b.line - a.line));
        return candidates.find(s => s.line <= line) ?? candidates[0];
    }

    private memberCompletions(doc: MsDocument, objName: string, line: number): CompletionItem[] {
        const typeName = this.typeOf(doc, objName, line);
        if (typeName === 'panic_info') {
            return PANIC_INFO_MEMBERS.map(m => ({
                label: m.name, kind: CompletionItemKind.Field, labelDetails: { description: m.type }, documentation: md(m.doc), sortText: '0' + m.name
            }));
        }
        const inner = resultInner(typeName);
        if (inner !== undefined) {
            // У `result<void>` (в том числе `error` в обработчике) нет значения
            return RESULT_MEMBERS.filter(m => inner !== 'void' || m.name !== 'value').map(m => ({
                label: m.name, kind: CompletionItemKind.Field, labelDetails: { description: m.type(inner) }, documentation: md(m.doc), sortText: '0' + m.name
            }));
        }
        const found = this.findStruct(typeName, doc);
        return found ? found.struct.children.map(m => this.symbolItem(m, m.kind === 'field' ? '0' : '1')) : [];
    }

    // ---------- Hover ----------

    hover(document: TextDocument, position: Position): Hover | undefined {
        const text = lineText(document, position.line);
        const w = wordAt(text, position.character);
        if (!w) { return undefined; }
        const range = Range.create(position.line, w.start, position.line, w.end);
        const doc = this.index.get(document);
        const before = text.slice(0, w.start);

        // Ссылка на раздел справочника для слов языка
        const ref = (section: string | undefined) => section ? '\n\n' + guideLink(section) : '';

        if (w.word.startsWith('@')) {
            return LABELS[w.word] ? { contents: md(`**${w.word}** — ${LABELS[w.word]}${ref(sectionForWord(w.word) ?? 'labels')}`), range } : undefined;
        }
        if (w.word === 'self' && !/\.\s*$/.test(before)) {
            const owner = methodAt(doc, position.line)?.owner;
            if (owner) { return { contents: md(codeblock(`${owner} self`) + '\n\nТекущий объект внутри метода.' + ref('methods')), range }; }
        }
        const member = before.match(/([A-Za-z_]\w*)\s*\.\s*$/);
        const memberType = member ? this.typeOf(doc, member[1], position.line) : undefined;
        const panicMember = memberType === 'panic_info' ? PANIC_INFO_MEMBERS.find(m => m.name === w.word) : undefined;
        if (member && panicMember) {
            return { contents: md(codeblock(`${panicMember.type} ${member[1]}.${w.word}`) + '\n\n' + panicMember.doc + ref('handling')), range };
        }
        const inner = resultInner(memberType);
        const resultMember = inner !== undefined ? RESULT_MEMBERS.find(m => m.name === w.word) : undefined;
        if (member && resultMember && inner !== undefined) {
            return { contents: md(codeblock(`${resultMember.type(inner)} ${member[1]}.${w.word}`) + '\n\n' + resultMember.doc + ref('result')), range };
        }

        const target = this.resolveSymbol(document, position.line, w.start, w.word);
        if (target) { return { contents: md(symbolMarkdown(target.sym)), range }; }

        const builtin = BUILTIN_FUNCTIONS.find(f => f.name === w.word);
        if (builtin) {
            return { contents: md(codeblock(builtinSignature(builtin)) + '\n\n*встроенная функция*\n\n' + builtin.doc + ref(sectionForWord(w.word) ?? 'builtins')), range };
        }
        if (TYPES[w.word]) { return { contents: md(`**${w.word}** — ${TYPES[w.word]}${ref(sectionForWord(w.word) ?? 'types')}`), range }; }
        if (KEYWORDS[w.word]) { return { contents: md(`**${w.word}** — ${KEYWORDS[w.word]}${ref(sectionForWord(w.word))}`), range }; }
        return undefined;
    }

    // ---------- Определение, ссылки, переименование ----------

    private resolveSymbol(document: TextDocument, line: number, start: number, word: string): { sym: MsSymbol; uri: string } | undefined {
        const doc = this.index.get(document);
        const before = lineText(document, line).slice(0, start);

        const member = before.match(/([A-Za-z_]\w*)\s*\.\s*$/);
        if (member) {
            const found = this.findStruct(this.typeOf(doc, member[1], line) ?? member[1], doc);
            const sym = found?.struct.children.find(m => m.name === word);
            return sym ? { sym, uri: this.uriOf(sym, document.uri) } : undefined;
        }

        // Объявление поля или метода внутри структуры
        const own = doc.all.find(s => s.line === line && s.character === start && s.name === word);
        if (own) { return { sym: own, uri: document.uri }; }

        const local = this.resolveVariable(doc, word, line);
        if (local) { return { sym: local, uri: document.uri }; }

        for (const { uri, doc: other } of this.index.all()) {
            if (other === doc) { continue; }
            const sym = other.symbols.find(s => s.name === word && s.kind !== 'variable');
            if (sym) { return { sym, uri }; }
        }
        return undefined;
    }

    private uriOf(sym: MsSymbol, fallback: string): string {
        for (const { uri, doc } of this.index.all()) {
            if (doc.all.includes(sym)) { return uri; }
        }
        return fallback;
    }

    definition(document: TextDocument, position: Position): Location | undefined {
        const w = wordAt(lineText(document, position.line), position.character);
        if (!w) { return undefined; }
        const target = this.resolveSymbol(document, position.line, w.start, w.word);
        return target ? Location.create(target.uri, nameRange(target.sym)) : undefined;
    }

    /**
     * Все вхождения символа. Локальные — только в своей области, поля и методы — только
     * после точки, глобальные — без точки во всех файлах. Строки и комментарии пропускаются.
     */
    private occurrences(document: TextDocument, position: Position): { sym: MsSymbol; uri: string; locations: Location[] } | undefined {
        const w = wordAt(lineText(document, position.line), position.character, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!w) { return undefined; }
        const target = this.resolveSymbol(document, position.line, w.start, w.word);
        if (!target) { return undefined; }
        const { sym } = target;
        const word = sym.name;
        const isMember = sym.kind === 'field' || sym.kind === 'method';
        const re = isMember ? new RegExp(`(?<=\\.\\s*)\\b${word}\\b`, 'g') : new RegExp(`(?<![\\w.@])${word}\\b`, 'g');
        const locations: Location[] = [];

        const scan = (uri: string, text: string, from = 0, to = Number.MAX_SAFE_INTEGER) => {
            const lines = text.split(/\r?\n/);
            let inBlock = false;
            for (let i = 0; i < lines.length; i++) {
                const masked = maskLine(lines[i], inBlock);
                inBlock = masked.endsInBlockComment;
                if (i < from || i > to) { continue; }
                for (const m of masked.text.matchAll(re)) {
                    const start = m.index ?? 0;
                    locations.push(Location.create(uri, Range.create(i, start, i, start + word.length)));
                }
            }
        };

        if (isLocal(sym) && sym.parent) {
            scan(document.uri, document.getText(), sym.parent.line, sym.parent.endLine);
        } else {
            for (const f of this.index.all()) { scan(f.uri, f.text); }
            if (isMember) {
                // Объявление поля или метода стоит без точки
                const decl = Location.create(target.uri, nameRange(sym));
                if (!locations.some(l => l.uri === decl.uri && l.range.start.line === decl.range.start.line && l.range.start.character === decl.range.start.character)) {
                    locations.push(decl);
                }
            }
        }
        return { sym, uri: target.uri, locations };
    }

    references(document: TextDocument, position: Position, includeDeclaration: boolean): Location[] {
        const found = this.occurrences(document, position);
        if (!found) { return []; }
        if (includeDeclaration) { return found.locations; }
        return found.locations.filter(l => !(l.uri === found.uri && l.range.start.line === found.sym.line && l.range.start.character === found.sym.character));
    }

    documentHighlights(document: TextDocument, position: Position): DocumentHighlight[] {
        const found = this.occurrences(document, position);
        if (!found) { return []; }
        return found.locations.filter(l => l.uri === document.uri).map(l => {
            const isDecl = l.range.start.line === found.sym.line && l.range.start.character === found.sym.character;
            return DocumentHighlight.create(l.range, isDecl ? DocumentHighlightKind.Write : DocumentHighlightKind.Read);
        });
    }

    prepareRename(document: TextDocument, position: Position): Range | undefined {
        const w = wordAt(lineText(document, position.line), position.character, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!w || w.word === 'self') { return undefined; }
        const target = this.resolveSymbol(document, position.line, w.start, w.word);
        return target ? Range.create(position.line, w.start, position.line, w.end) : undefined;
    }

    rename(document: TextDocument, position: Position, newName: string): WorkspaceEdit | undefined {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) { throw new Error(`«${newName}» — не имя в MONOSCRIPT`); }
        if (KEYWORDS[newName] || TYPES[newName]) { throw new Error(`«${newName}» — ключевое слово или тип`); }
        const found = this.occurrences(document, position);
        if (!found) { return undefined; }
        const changes: Record<string, TextEdit[]> = {};
        for (const l of found.locations) {
            (changes[l.uri] ??= []).push(TextEdit.replace(l.range, newName));
        }
        return { changes };
    }

    // ---------- Подсказка сигнатуры ----------

    signatureHelp(document: TextDocument, position: Position): SignatureHelp | undefined {
        const before = lineText(document, position.line).slice(0, position.character).replace(/"(?:\\.|[^"\\])*"/g, m => '_'.repeat(m.length));
        let depth = 0;
        let commas = 0;
        let open = -1;
        for (let i = before.length - 1; i >= 0; i--) {
            const ch = before[i];
            if (ch === ')' || ch === ']' || ch === '}') { depth++; }
            else if (ch === '(' || ch === '[' || ch === '{') {
                if (depth === 0) { if (ch === '(') { open = i; } break; }
                depth--;
            } else if (ch === ',' && depth === 0) { commas++; }
        }
        if (open < 0) { return undefined; }
        const callee = before.slice(0, open).match(/(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*$/);
        if (!callee) { return undefined; }
        const [, objName, name] = callee;
        const doc = this.index.get(document);

        let label: string | undefined;
        let params: string[] = [];
        let documentation: string | undefined;

        const builtin = BUILTIN_FUNCTIONS.find(f => f.name === name);
        if (builtin && !objName) {
            label = builtinSignature(builtin);
            params = builtin.params.map(p => `${p.type}: ${p.name}`);
            documentation = builtin.doc;
        } else {
            let sym: MsSymbol | undefined;
            if (objName) {
                sym = this.findStruct(this.typeOf(doc, objName, position.line) ?? objName, doc)?.struct.children.find(m => m.name === name);
            } else if (this.findStruct(name, doc)) {
                label = `${name}()`;
                documentation = 'Новый объект, поля получают значения по умолчанию.';
            } else {
                sym = this.resolveVariable(doc, name, position.line);
                if (!sym?.params) {
                    for (const { doc: other } of this.index.all()) {
                        sym = other.symbols.find(s => s.name === name && s.params);
                        if (sym) { break; }
                    }
                }
            }
            if (sym?.params) {
                label = signatureOf(sym);
                params = sym.params.map(formatParam);
                documentation = sym.doc;
            } else if (sym?.kind === 'parameter' && sym.type?.startsWith('func<')) {
                // Вызов параметра-функции: keep(x)
                label = formatParam({ type: sym.type, name: sym.name });
                params = (sym.type.slice(5, -1).split(',').slice(0, -1)).map(t => t.trim());
            }
        }
        if (!label) { return undefined; }

        const info = SignatureInformation.create(label, documentation, ...params.map(p => ParameterInformation.create(p)));
        return { signatures: [info], activeSignature: 0, activeParameter: Math.min(commas, Math.max(params.length - 1, 0)) };
    }

    // ---------- Подсказки типов ----------

    /** Выведенные типы: `x ^= f()` → `x: i32`, переменная цикла `for x in items` → `x: T`. */
    inlayHints(document: TextDocument, range: Range): InlayHint[] {
        const doc = this.index.get(document);
        const raw = document.getText().split(/\r?\n/);
        const hints: InlayHint[] = [];
        for (const s of doc.all) {
            if (s.kind !== 'variable' && s.kind !== 'field') { continue; }
            if (!s.type || s.line < range.start.line || s.line > range.end.line) { continue; }
            const text = raw[s.line] ?? '';
            const after = text.slice(s.character + s.name.length);
            const inferred = /^\s*\^=/.test(after);
            const loopVar = /^\s*in\b/.test(after) && /^\s*(?:\|[ \t]*)*for\s/.test(text);
            if (!inferred && !loopVar) { continue; }
            hints.push({
                position: Position.create(s.line, s.character + s.name.length),
                label: `: ${s.type}`,
                kind: InlayHintKind.Type
            });
        }
        return hints;
    }

    // ---------- Форматирование ----------

    async format(document: TextDocument): Promise<TextEdit[]> {
        const unit = await this.indentUnit();
        const doc = this.index.get(document);
        const raw = document.getText().split(/\r?\n/);
        const edits: TextEdit[] = [];
        let blankRun = 0;

        for (let i = 0; i < raw.length; i++) {
            const text = raw[i];
            if (doc.lines[i]?.inBlockComment) { blankRun = 0; continue; }
            const prefix = (text.match(PREFIX_RE) ?? [''])[0];
            const rest = text.slice(prefix.length).trimEnd();
            const depth = countDepth(prefix);
            let newText: string;

            if (text.trim() === '') {
                newText = '';
                blankRun++;
                if (blankRun > 2 && i + 1 < raw.length) {
                    edits.push(TextEdit.del(Range.create(i, 0, i + 1, 0)));
                    continue;
                }
            } else {
                blankRun = 0;
                if (rest.startsWith('|>') || depth === 0) {
                    newText = prefix + rest;
                } else if (rest === '') {
                    newText = unit.repeat(depth - 1) + '|';
                } else {
                    newText = unit.repeat(depth) + rest;
                }
            }
            if (newText !== text) { edits.push(TextEdit.replace(Range.create(i, 0, i, text.length), newText)); }
        }
        return edits;
    }
}

export type { IndexedFile };
