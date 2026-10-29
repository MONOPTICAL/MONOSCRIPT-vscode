import * as vscode from 'vscode';
import {
    MsDocument, MsSymbol, PREFIX_RE, countDepth, signatureOf, visibleSymbols
} from './analyzer';
import { BUILTIN_FUNCTIONS, CASTABLE_TYPES, KEYWORDS, LABELS, TYPES, builtinSignature } from './builtins';
import { indentUnit } from './indent';
import { WorkspaceIndex } from './workspaceIndex';

const SELECTOR: vscode.DocumentSelector = { language: 'ms' };
const WORD_RE = /@?[A-Za-z_][A-Za-z0-9_]*/;

const SYMBOL_KINDS: Record<MsSymbol['kind'], vscode.SymbolKind> = {
    struct: vscode.SymbolKind.Struct,
    function: vscode.SymbolKind.Function,
    method: vscode.SymbolKind.Method,
    lambda: vscode.SymbolKind.Function,
    field: vscode.SymbolKind.Field,
    variable: vscode.SymbolKind.Variable,
    parameter: vscode.SymbolKind.Variable
};

const COMPLETION_KINDS: Record<MsSymbol['kind'], vscode.CompletionItemKind> = {
    struct: vscode.CompletionItemKind.Struct,
    function: vscode.CompletionItemKind.Function,
    method: vscode.CompletionItemKind.Method,
    lambda: vscode.CompletionItemKind.Function,
    field: vscode.CompletionItemKind.Field,
    variable: vscode.CompletionItemKind.Variable,
    parameter: vscode.CompletionItemKind.Variable
};

function nameRange(document: vscode.TextDocument, sym: MsSymbol): vscode.Range {
    return new vscode.Range(sym.line, sym.character, sym.line, sym.character + sym.name.length);
}

function fullRange(document: vscode.TextDocument, sym: MsSymbol): vscode.Range {
    const end = Math.min(sym.endLine, document.lineCount - 1);
    return new vscode.Range(sym.line, 0, end, document.lineAt(end).text.length);
}

function symbolMarkdown(sym: MsSymbol): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendCodeblock(signatureOf(sym), 'ms');
    const kind = { struct: 'структура', function: 'функция', method: 'метод', lambda: 'лямбда', field: 'поле', variable: 'переменная', parameter: 'параметр' }[sym.kind];
    md.appendMarkdown(`*${kind}*`);
    if (sym.owner && sym.kind === 'method') { md.appendMarkdown(` структуры \`${sym.owner}\``); }
    if (sym.doc) { md.appendMarkdown('\n\n---\n\n' + sym.doc); }
    for (const label of sym.labels ?? []) {
        if (LABELS[label]) { md.appendMarkdown(`\n\n\`${label}\` — ${LABELS[label]}`); }
    }
    return md;
}

/** Методы структуры: объявленные внутри неё и через `[T]Struct::name`. */
function structMembers(struct: MsSymbol, docs: MsDocument[]): MsSymbol[] {
    const members = [...struct.children];
    for (const d of docs) {
        for (const s of d.all) {
            if (s.kind === 'method' && s.owner === struct.name && !members.includes(s)) { members.push(s); }
        }
    }
    return members;
}

export interface SnippetDef {
    prefix: string;
    body: string[];
    description?: string;
}

export class MsLanguageFeatures implements
    vscode.DocumentSymbolProvider, vscode.FoldingRangeProvider, vscode.CompletionItemProvider,
    vscode.HoverProvider, vscode.DefinitionProvider, vscode.ReferenceProvider,
    vscode.SignatureHelpProvider, vscode.WorkspaceSymbolProvider, vscode.DocumentFormattingEditProvider {

    constructor(private readonly index: WorkspaceIndex, private readonly snippets: Record<string, SnippetDef> = {}) { }

    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.languages.registerDocumentSymbolProvider(SELECTOR, this, { label: 'MONOSCRIPT' }),
            vscode.languages.registerFoldingRangeProvider(SELECTOR, this),
            vscode.languages.registerCompletionItemProvider(SELECTOR, this, '.', '@', '['),
            vscode.languages.registerHoverProvider(SELECTOR, this),
            vscode.languages.registerDefinitionProvider(SELECTOR, this),
            vscode.languages.registerReferenceProvider(SELECTOR, this),
            vscode.languages.registerSignatureHelpProvider(SELECTOR, this, { triggerCharacters: ['(', ','], retriggerCharacters: [','] }),
            vscode.languages.registerWorkspaceSymbolProvider(this),
            vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, this)
        );
    }

    // ---------- Outline ----------

    provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const doc = this.index.get(document);
        const convert = (sym: MsSymbol): vscode.DocumentSymbol => {
            const detail = sym.kind === 'field' || sym.kind === 'variable' ? sym.type ?? '' : signatureOf(sym).replace(/^\S*?\]/, '').replace(sym.name, '').trim();
            const ds = new vscode.DocumentSymbol(sym.name, detail, SYMBOL_KINDS[sym.kind], fullRange(document, sym), nameRange(document, sym));
            ds.children = sym.children.map(convert);
            return ds;
        };
        return doc.symbols.map(convert);
    }

    async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
        const q = query.toLowerCase();
        const result: vscode.SymbolInformation[] = [];
        for (const { uri, doc } of await this.index.all()) {
            for (const s of doc.all) {
                if (s.kind === 'parameter' || (s.kind === 'variable' && s.parent)) { continue; }
                if (q && !s.name.toLowerCase().includes(q)) { continue; }
                result.push(new vscode.SymbolInformation(
                    s.name, SYMBOL_KINDS[s.kind], s.parent?.name ?? s.owner ?? '',
                    new vscode.Location(uri, new vscode.Position(s.line, s.character))
                ));
            }
        }
        return result;
    }

    // ---------- Folding ----------

    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        const doc = this.index.get(document);
        const ranges: vscode.FoldingRange[] = [];
        const lines = doc.lines;

        for (let i = 0; i < lines.length; i++) {
            const info = lines[i];
            if (info.blank) { continue; }
            // Блок = следующие строки с большей глубиной `|`
            let end = i;
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].blank && lines[j].depth <= info.depth) { continue; }
                if (lines[j].depth <= info.depth && !lines[j].blank) { break; }
                if (!lines[j].blank) { end = j; }
            }
            if (end > i) { ranges.push(new vscode.FoldingRange(i, end)); }
        }

        // Блочные комментарии и группы `//`
        let commentStart = -1;
        for (let i = 0; i <= document.lineCount; i++) {
            const text = i < document.lineCount ? document.lineAt(i).text.replace(PREFIX_RE, '') : '';
            const isComment = i < document.lineCount && text.startsWith('//');
            if (isComment && commentStart < 0) { commentStart = i; }
            if (!isComment && commentStart >= 0) {
                if (i - 1 > commentStart) { ranges.push(new vscode.FoldingRange(commentStart, i - 1, vscode.FoldingRangeKind.Comment)); }
                commentStart = -1;
            }
        }
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].inBlockComment && i + 1 < lines.length && lines[i + 1].inBlockComment) {
                let j = i + 1;
                while (j + 1 < lines.length && lines[j + 1].inBlockComment) { j++; }
                ranges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Comment));
                i = j;
            }
        }

        // Регионы: // #region ... // #endregion
        const stack: number[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            if (/\/\/\s*#region\b/.test(text)) { stack.push(i); }
            else if (/\/\/\s*#endregion\b/.test(text) && stack.length) {
                ranges.push(new vscode.FoldingRange(stack.pop()!, i, vscode.FoldingRangeKind.Region));
            }
        }
        return ranges;
    }

    // ---------- Completion ----------

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        const lineText = document.lineAt(position.line).text;
        const before = lineText.slice(0, position.character);
        const doc = this.index.get(document);

        if (/\/\/.*$/.test(before.replace(/"(?:\\.|[^"\\])*"/g, '""'))) { return []; }

        // obj.member
        const member = before.match(/([A-Za-z_]\w*)\s*\.\s*\w*$/);
        if (member) {
            return this.memberCompletions(document, doc, member[1], position.line);
        }

        // @label
        if (/@\w*$/.test(before)) {
            const at = before.lastIndexOf('@');
            const range = new vscode.Range(position.line, at, position.line, position.character);
            return Object.entries(LABELS).map(([label, desc]) => {
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
                item.documentation = new vscode.MarkdownString(desc);
                item.range = range;
                return item;
            });
        }

        // [тип] — после `[` в начале объявления
        if (/(?:^|[^\w\])])\[\s*\w*$/.test(before)) {
            return [...this.typeCompletions(await this.structNames(doc)),
                Object.assign(new vscode.CompletionItem('struct', vscode.CompletionItemKind.Keyword), { detail: '[struct]Name' })];
        }

        // x -> тип (каст)
        if (/->\s*\w*$/.test(before) && !/\]\s*\(.*\)\s*->\s*\w*$/.test(before)) {
            return CASTABLE_TYPES.map(t => new vscode.CompletionItem(t, vscode.CompletionItemKind.TypeParameter));
        }

        const items: vscode.CompletionItem[] = [];
        const seen = new Set<string>();
        const push = (item: vscode.CompletionItem) => {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            if (seen.has(label)) { return; }
            seen.add(label);
            items.push(item);
        };

        for (const sym of visibleSymbols(doc, position.line).sort((a, b) => b.line - a.line)) {
            if (sym.kind === 'method' && sym.owner) { continue; }
            push(this.symbolItem(sym, '0'));
        }
        for (const { doc: other } of await this.index.all()) {
            if (other === doc) { continue; }
            for (const sym of other.symbols) {
                if (sym.kind === 'struct' || sym.kind === 'function') { push(this.symbolItem(sym, '2')); }
            }
        }
        for (const f of BUILTIN_FUNCTIONS) {
            const item = new vscode.CompletionItem({ label: f.name, detail: `(${f.params.map(p => p.type).join(', ')})`, description: f.ret }, vscode.CompletionItemKind.Function);
            item.documentation = new vscode.MarkdownString().appendCodeblock(builtinSignature(f), 'ms').appendMarkdown(f.doc);
            item.insertText = new vscode.SnippetString(f.params.length ? `${f.name}($1)` : `${f.name}()`);
            item.command = { command: 'editor.action.triggerParameterHints', title: '' };
            item.sortText = '1' + f.name;
            push(item);
        }
        for (const [kw, desc] of Object.entries(KEYWORDS)) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.documentation = new vscode.MarkdownString(desc);
            item.sortText = '3' + kw;
            push(item);
        }
        for (const item of this.typeCompletions(await this.structNames(doc))) { push(item); }
        items.push(...this.snippetItems(lineText, position));
        return items;
    }

    /**
     * Сниппеты отдаются отсюда, а не через contributes.snippets: VS Code при вставке
     * копирует в следующие строки только пробельный отступ, и `|`-префикс терялся.
     */
    private snippetItems(lineText: string, position: vscode.Position): vscode.CompletionItem[] {
        const prefix = (lineText.match(PREFIX_RE) ?? [''])[0];
        if (position.character < prefix.length) { return []; }
        const atLineStart = lineText.slice(prefix.length, position.character).match(/^\w*$/) !== null;
        const wordStart = position.character - (lineText.slice(0, position.character).match(/\w*$/)?.[0].length ?? 0);
        const range = new vscode.Range(position.line, wordStart, position.line, position.character);
        const linePrefix = prefix.endsWith('|') ? prefix + indentUnit().slice(1) : prefix;

        return Object.entries(this.snippets).map(([name, def]) => {
            const multiline = def.body.length > 1;
            const item = new vscode.CompletionItem({ label: def.prefix, description: name }, vscode.CompletionItemKind.Snippet);
            const body = def.body.map((l, i) => i === 0 ? l : linePrefix + l).join('\n');
            item.insertText = new vscode.SnippetString(body);
            item.keepWhitespace = true;
            item.documentation = new vscode.MarkdownString().appendCodeblock(def.body.join('\n'), 'ms');
            item.detail = def.description;
            item.range = range;
            item.sortText = '5' + def.prefix;
            // Многострочные конструкции имеют смысл только в начале строки
            if (multiline && !atLineStart) { return undefined; }
            return item;
        }).filter((i): i is vscode.CompletionItem => i !== undefined);
    }

    private symbolItem(sym: MsSymbol, sortPrefix: string): vscode.CompletionItem {
        const isCallable = sym.kind === 'function' || sym.kind === 'method' || sym.kind === 'lambda';
        const item = new vscode.CompletionItem(
            { label: sym.name, detail: isCallable ? `(${(sym.params ?? []).map(p => p.type).join(', ')})` : undefined, description: sym.type },
            COMPLETION_KINDS[sym.kind]
        );
        item.documentation = symbolMarkdown(sym);
        item.sortText = sortPrefix + sym.name;
        if (isCallable) {
            item.insertText = new vscode.SnippetString(sym.params?.length ? `${sym.name}($1)` : `${sym.name}()`);
            item.command = { command: 'editor.action.triggerParameterHints', title: '' };
        } else if (sym.kind === 'struct') {
            item.insertText = new vscode.SnippetString(`${sym.name}($1)`);
            item.command = { command: 'editor.action.triggerParameterHints', title: '' };
        }
        return item;
    }

    private typeCompletions(structs: string[]): vscode.CompletionItem[] {
        const items = Object.entries(TYPES).filter(([t]) => t !== 'struct').map(([t, desc]) => {
            const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.TypeParameter);
            item.documentation = new vscode.MarkdownString(desc);
            if (t === 'array') { item.insertText = new vscode.SnippetString('array<${1:i32}>'); }
            if (t === 'map') { item.insertText = new vscode.SnippetString('map<${1:string}, ${2:i32}>'); }
            item.sortText = '4' + t;
            return item;
        });
        for (const s of structs) {
            const item = new vscode.CompletionItem(s, vscode.CompletionItemKind.Struct);
            item.sortText = '4' + s;
            items.push(item);
        }
        return items;
    }

    private async structNames(doc: MsDocument): Promise<string[]> {
        const names = new Set(doc.all.filter(s => s.kind === 'struct').map(s => s.name));
        for (const { doc: d } of await this.index.all()) {
            d.symbols.filter(s => s.kind === 'struct').forEach(s => names.add(s.name));
        }
        return [...names];
    }

    private async findStruct(name: string, doc: MsDocument): Promise<{ struct: MsSymbol; docs: MsDocument[] } | undefined> {
        const docs = [doc, ...(await this.index.all()).map(x => x.doc).filter(d => d !== doc)];
        for (const d of docs) {
            const struct = d.all.find(s => s.kind === 'struct' && s.name === name);
            if (struct) { return { struct, docs }; }
        }
        return undefined;
    }

    private resolveVariable(doc: MsDocument, name: string, line: number): MsSymbol | undefined {
        const candidates = visibleSymbols(doc, line).filter(s => s.name === name);
        // Ближайшее объявление: самая глубокая область, затем самая поздняя строка выше курсора
        candidates.sort((a, b) => (b.depth - a.depth) || (b.line - a.line));
        return candidates.find(s => s.line <= line) ?? candidates[0];
    }

    private async memberCompletions(document: vscode.TextDocument, doc: MsDocument, objName: string, line: number): Promise<vscode.CompletionItem[]> {
        const variable = this.resolveVariable(doc, objName, line);
        const typeName = variable?.type ?? (/^[A-Z]/.test(objName) ? objName : undefined);
        if (!typeName) { return []; }
        const found = await this.findStruct(typeName, doc);
        if (!found) { return []; }
        return structMembers(found.struct, found.docs)
            .filter(m => !/^__\w+__$/.test(m.name))
            .map(m => this.symbolItem(m, m.kind === 'field' ? '0' : '1'));
    }

    // ---------- Hover ----------

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const range = document.getWordRangeAtPosition(position, WORD_RE);
        if (!range) { return undefined; }
        const word = document.getText(range);

        if (word.startsWith('@')) {
            return LABELS[word] ? new vscode.Hover(new vscode.MarkdownString(`**${word}** — ${LABELS[word]}`), range) : undefined;
        }

        const target = await this.resolveSymbol(document, position, range, word);
        if (target) { return new vscode.Hover(symbolMarkdown(target.sym), range); }

        const builtin = BUILTIN_FUNCTIONS.find(f => f.name === word);
        if (builtin) {
            return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(builtinSignature(builtin), 'ms').appendMarkdown(`*встроенная функция*\n\n${builtin.doc}`), range);
        }
        if (TYPES[word]) { return new vscode.Hover(new vscode.MarkdownString(`**${word}** — ${TYPES[word]}`), range); }
        if (KEYWORDS[word]) { return new vscode.Hover(new vscode.MarkdownString(`**${word}** — ${KEYWORDS[word]}`), range); }
        return undefined;
    }

    // ---------- Definition / References ----------

    private async resolveSymbol(document: vscode.TextDocument, position: vscode.Position, range: vscode.Range, word: string): Promise<{ sym: MsSymbol; uri: vscode.Uri } | undefined> {
        const doc = this.index.get(document);
        const before = document.lineAt(position.line).text.slice(0, range.start.character);

        // obj.member
        const member = before.match(/([A-Za-z_]\w*)\s*\.\s*$/);
        if (member) {
            const variable = this.resolveVariable(doc, member[1], position.line);
            const typeName = variable?.type ?? member[1];
            const found = await this.findStruct(typeName, doc);
            if (!found) { return undefined; }
            const sym = structMembers(found.struct, found.docs).find(m => m.name === word);
            return sym ? { sym, uri: await this.uriOf(sym, document) } : undefined;
        }

        // Struct::method в объявлении
        const assoc = before.match(/([A-Za-z_]\w*)\s*::\s*$/);
        if (assoc) {
            const found = await this.findStruct(assoc[1], doc);
            const sym = found?.struct.children.find(m => m.name === word);
            if (sym) { return { sym, uri: await this.uriOf(sym, document) }; }
        }

        const local = this.resolveVariable(doc, word, position.line);
        if (local) { return { sym: local, uri: document.uri }; }

        for (const { uri, doc: other } of await this.index.all()) {
            if (other === doc) { continue; }
            const sym = other.symbols.find(s => s.name === word && s.kind !== 'variable');
            if (sym) { return { sym, uri }; }
        }
        return undefined;
    }

    private async uriOf(sym: MsSymbol, fallback: vscode.TextDocument): Promise<vscode.Uri> {
        for (const { uri, doc } of await this.index.all()) {
            if (doc.all.includes(sym)) { return uri; }
        }
        return fallback.uri;
    }

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
        const range = document.getWordRangeAtPosition(position, WORD_RE);
        if (!range) { return undefined; }
        const target = await this.resolveSymbol(document, position, range, document.getText(range));
        if (!target) { return undefined; }
        return new vscode.Location(target.uri, new vscode.Range(target.sym.line, target.sym.character, target.sym.line, target.sym.character + target.sym.name.length));
    }

    async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): Promise<vscode.Location[]> {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!range) { return []; }
        const word = document.getText(range);
        const target = await this.resolveSymbol(document, position, range, word);
        const isLocal = target && (target.sym.kind === 'parameter' || (target.sym.kind === 'variable' && target.sym.parent));
        const re = new RegExp(`(?<![\\w.@])${word}\\b|(?<=\\.)${word}\\b`, 'g');
        const result: vscode.Location[] = [];

        const scan = (uri: vscode.Uri, text: string, fromLine = 0, toLine = Number.MAX_SAFE_INTEGER) => {
            const lines = text.split(/\r?\n/);
            for (let i = fromLine; i < Math.min(lines.length, toLine + 1); i++) {
                // Пропускаем содержимое строк и комментарии
                const masked = lines[i].replace(/"(?:\\.|[^"\\])*"/g, m => ' '.repeat(m.length)).replace(/\/\/.*$/, m => ' '.repeat(m.length));
                for (const m of masked.matchAll(re)) {
                    const start = m.index ?? 0;
                    if (!context.includeDeclaration && target && target.uri.toString() === uri.toString() && target.sym.line === i && target.sym.character === start) { continue; }
                    result.push(new vscode.Location(uri, new vscode.Range(i, start, i, start + word.length)));
                }
            }
        };

        if (isLocal && target) {
            const scope = target.sym.parent!;
            scan(document.uri, document.getText(), scope.line, scope.endLine);
            return result;
        }
        const open = new Map(vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]));
        const files = await vscode.workspace.findFiles('**/*.ms', '**/{node_modules,.git,build,out}/**', 2000);
        if (!files.some(f => f.toString() === document.uri.toString())) { files.push(document.uri); }
        for (const uri of files) {
            const text = open.get(uri.toString())?.getText() ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            scan(uri, text);
        }
        return result;
    }

    // ---------- Signature help ----------

    async provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.SignatureHelp | undefined> {
        const before = document.lineAt(position.line).text.slice(0, position.character).replace(/"(?:\\.|[^"\\])*"/g, m => '_'.repeat(m.length));
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
        let params: { type: string; name: string }[] = [];
        let documentation: vscode.MarkdownString | undefined;

        const builtin = BUILTIN_FUNCTIONS.find(f => f.name === name);
        if (builtin && !objName) {
            label = builtinSignature(builtin);
            params = builtin.params;
            documentation = new vscode.MarkdownString(builtin.doc);
        } else {
            let sym: MsSymbol | undefined;
            if (objName) {
                const variable = this.resolveVariable(doc, objName, position.line);
                const found = await this.findStruct(variable?.type ?? objName, doc);
                sym = found && structMembers(found.struct, found.docs).find(m => m.name === name);
            } else {
                const found = await this.findStruct(name, doc);
                if (found) {
                    // Конструктор: параметры __init__
                    const init = structMembers(found.struct, found.docs).find(m => m.name === '__init__');
                    label = `${name}(${(init?.params ?? []).map(p => `${p.type}: ${p.name}`).join(', ')})`;
                    params = init?.params ?? [];
                    documentation = init?.doc ? new vscode.MarkdownString(init.doc) : undefined;
                } else {
                    sym = this.resolveVariable(doc, name, position.line);
                    if (!sym) {
                        for (const { doc: other } of await this.index.all()) {
                            sym = other.symbols.find(s => s.name === name && s.params);
                            if (sym) { break; }
                        }
                    }
                }
            }
            if (sym?.params) {
                label = signatureOf(sym);
                params = sym.params;
                documentation = sym.doc ? new vscode.MarkdownString(sym.doc) : undefined;
            }
        }
        if (!label) { return undefined; }

        const info = new vscode.SignatureInformation(label, documentation);
        info.parameters = params.map(p => new vscode.ParameterInformation(`${p.type}: ${p.name}`));
        const help = new vscode.SignatureHelp();
        help.signatures = [info];
        help.activeSignature = 0;
        help.activeParameter = Math.min(commas, Math.max(params.length - 1, 0));
        return help;
    }

    // ---------- Formatting ----------

    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
        const unit = indentUnit();
        const doc = this.index.get(document);
        const edits: vscode.TextEdit[] = [];
        let blankRun = 0;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const info = doc.lines[i];
            if (info.inBlockComment) { blankRun = 0; continue; }
            const text = line.text;
            const prefix = (text.match(PREFIX_RE) ?? [''])[0];
            const rest = text.slice(prefix.length).trimEnd();
            const depth = countDepth(prefix);
            let newText: string;

            if (text.trim() === '') {
                newText = '';
                blankRun++;
                if (blankRun > 2) {
                    edits.push(vscode.TextEdit.delete(line.rangeIncludingLineBreak));
                    continue;
                }
            } else {
                blankRun = 0;
                if (rest.startsWith('|>') || depth === 0) {
                    // Продолжения пайпов и строки верхнего уровня оставляем как есть
                    newText = prefix + rest;
                } else if (rest === '') {
                    newText = unit.repeat(depth - 1) + '|';
                } else {
                    newText = unit.repeat(depth) + rest;
                }
            }
            if (newText !== text) { edits.push(vscode.TextEdit.replace(line.range, newText)); }
        }
        return edits;
    }
}

