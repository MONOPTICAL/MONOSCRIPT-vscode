import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, MsDocument } from '../analyzer';

// Индекс .ms файлов для языкового сервера: открытые документы берутся из
// редактора, остальные читаются с диска (при старте и по уведомлениям об изменениях).

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'out', '.vscode-test']);
const MAX_FILES = 2000;

export interface IndexedFile {
    uri: string;
    text: string;
    doc: MsDocument;
}

export class WorkspaceIndex {
    private readonly cache = new Map<string, { version: number; doc: MsDocument }>();
    private readonly disk = new Map<string, IndexedFile>();
    private roots: string[] = [];

    constructor(private readonly documents: TextDocuments<TextDocument>) { }

    setRoots(uris: string[]): void {
        this.roots = uris.map(u => URI.parse(u).fsPath);
        this.scan();
    }

    get(document: TextDocument): MsDocument {
        const hit = this.cache.get(document.uri);
        if (hit && hit.version === document.version) { return hit.doc; }
        const doc = analyze(document.getText(), name => this.externalReturnType(document.uri, name));
        this.cache.set(document.uri, { version: document.version, doc });
        return doc;
    }

    /** Тип возврата функции `name` из других файлов (без шаблонов). */
    private externalReturnType(uri: string, name: string): string | undefined {
        const docs = [...[...this.disk.values()].filter(f => f.uri !== uri).map(f => f.doc),
            ...[...this.cache.entries()].filter(([u]) => u !== uri).map(([, c]) => c.doc)];
        for (const d of docs) {
            const fn = d.symbols.find(s => s.kind === 'function' && s.name === name);
            if (fn?.type && !fn.typeParams) { return fn.type; }
        }
        return undefined;
    }

    forget(uri: string): void {
        this.cache.delete(uri);
    }

    /** Все файлы: открытые — в актуальном состоянии, остальные — с диска. */
    all(): IndexedFile[] {
        const result = new Map<string, IndexedFile>(this.disk);
        for (const d of this.documents.all()) {
            result.set(d.uri, { uri: d.uri, text: d.getText(), doc: this.get(d) });
        }
        return [...result.values()];
    }

    /** Файл с диска изменился, создан или удалён. */
    fileChanged(uri: string, deleted: boolean): void {
        if (deleted) { this.disk.delete(uri); return; }
        this.load(URI.parse(uri).fsPath);
    }

    private scan(): void {
        this.disk.clear();
        let count = 0;
        const walk = (dir: string) => {
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                if (count >= MAX_FILES) { return; }
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) { walk(full); }
                } else if (e.name.endsWith('.ms')) {
                    count++;
                    this.load(full);
                }
            }
        };
        this.roots.forEach(walk);
    }

    private load(file: string): void {
        const uri = URI.file(file).toString();
        try {
            const text = fs.readFileSync(file, 'utf8');
            this.disk.set(uri, { uri, text, doc: analyze(text) });
        } catch {
            this.disk.delete(uri);
        }
    }
}
