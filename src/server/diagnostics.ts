import * as path from 'path';
import { execFile } from 'child_process';
import { URI } from 'vscode-uri';
import { Connection, Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PREFIX_RE } from '../analyzer';
import { ParsedError, parseCompilerOutput, stripAnsi } from './compilerOutput';
import { lint } from './lint';
import { WorkspaceIndex } from './workspace';

// Диагностика из двух источников:
// - `ms-lint`: быстрые проверки сервера, на каждое изменение;
// - `ms`: компилятор, при открытии и сохранении файла.

export interface Settings {
    compilerPath: string;
    diagnosticsEnable: boolean;
    lintEnable: boolean;
    indentUnit: string;
}

export const COMPILER_MISSING = 'monoscript/compilerMissing';

export class Diagnostics {
    private readonly lintResults = new Map<string, Diagnostic[]>();
    private readonly compilerResults = new Map<string, Diagnostic[]>();
    private readonly running = new Map<string, () => void>();
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly connection: Connection,
        private readonly index: WorkspaceIndex,
        private readonly settings: () => Promise<Settings>
    ) { }

    /** Изменение текста: быстрые проверки с небольшой задержкой. */
    changed(document: TextDocument): void {
        clearTimeout(this.timers.get(document.uri));
        this.timers.set(document.uri, setTimeout(() => {
            this.timers.delete(document.uri);
            this.lint(document);
        }, 200));
    }

    async lint(document: TextDocument): Promise<void> {
        const s = await this.settings();
        if (!s.lintEnable) {
            this.lintResults.delete(document.uri);
            this.publish(document.uri);
            return;
        }
        const names = new Set<string>();
        for (const f of this.index.all()) {
            if (f.uri === document.uri) { continue; }
            f.doc.symbols.forEach(sym => { if (sym.kind === 'function' || sym.kind === 'struct') { names.add(sym.name); } });
        }
        const found = lint(document.getText(), this.index.get(document), names).map(d => {
            const diag = Diagnostic.create(
                Range.create(d.line, d.start, d.line, d.end), d.message,
                d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning, d.code, 'ms-lint'
            );
            return diag;
        });
        this.lintResults.set(document.uri, found);
        this.publish(document.uri);
    }

    /** Проверка компилятором (открытие и сохранение файла). */
    async compile(document: TextDocument): Promise<void> {
        const uri = URI.parse(document.uri);
        if (uri.scheme !== 'file') { return; }
        const s = await this.settings();
        if (!s.diagnosticsEnable) {
            this.compilerResults.delete(document.uri);
            this.publish(document.uri);
            return;
        }
        this.running.get(document.uri)?.();
        const file = uri.fsPath;
        const text = document.getText();
        const child = execFile(s.compilerPath || 'ms', [file], { cwd: path.dirname(file), timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            this.running.delete(document.uri);
            if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.connection.sendNotification(COMPILER_MISSING, { path: s.compilerPath });
                return;
            }
            if (error?.killed) { return; }
            const lines = text.split(/\r?\n/);
            const diagnostics = parseCompilerOutput(`${stderr}\n${stdout}`, lines.length).map(p => toDiagnostic(lines, p));
            if (!diagnostics.length && error && stderr.trim()) {
                // Ошибка без номера строки — на первой строке, чтобы её не потерять
                const msg = stripAnsi(stderr).trim().split(/\r?\n/)[0];
                diagnostics.push(Diagnostic.create(Range.create(0, 0, 0, 0), msg, DiagnosticSeverity.Error, undefined, 'ms'));
            }
            this.compilerResults.set(document.uri, diagnostics);
            this.publish(document.uri);
        });
        this.running.set(document.uri, () => child.kill());
    }

    closed(uri: string): void {
        clearTimeout(this.timers.get(uri));
        this.running.get(uri)?.();
        this.lintResults.delete(uri);
        this.compilerResults.delete(uri);
        this.connection.sendDiagnostics({ uri, diagnostics: [] });
    }

    private publish(uri: string): void {
        this.connection.sendDiagnostics({
            uri,
            diagnostics: [...(this.compilerResults.get(uri) ?? []), ...(this.lintResults.get(uri) ?? [])]
        });
    }
}

function toDiagnostic(lines: string[], err: ParsedError): Diagnostic {
    const text = lines[err.line] ?? '';
    const prefix = (text.match(PREFIX_RE) ?? [''])[0];
    let range = Range.create(err.line, prefix.length, err.line, Math.max(prefix.length, text.trimEnd().length));
    // Имя в кавычках из сообщения, если оно есть в строке, — подсвечиваем только его
    for (const m of err.message.matchAll(/['"`]([A-Za-z_]\w*)['"`]/g)) {
        const idx = text.search(new RegExp(`\\b${m[1]}\\b`));
        if (idx >= 0) { range = Range.create(err.line, idx, err.line, idx + m[1].length); break; }
    }
    // `Variable not found: y` — имя после двоеточия
    const tail = err.message.match(/(?:not found|Unknown \w+): ([A-Za-z_]\w*)$/);
    if (tail) {
        const idx = text.search(new RegExp(`\\b${tail[1]}\\b`));
        if (idx >= 0) { range = Range.create(err.line, idx, err.line, idx + tail[1].length); }
    }
    const message = err.hint ? `${err.message}\nHint: ${err.hint}` : err.message;
    return Diagnostic.create(range, message, err.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error, undefined, 'ms');
}
