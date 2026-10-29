import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { analyzeLines, PREFIX_RE } from './analyzer';

// Интеграция с компилятором `ms` (https://github.com/MONOPTICAL/MONOSCRIPT):
// проверка файла при сохранении (запуск без флагов = лексер + парсер + семантика)
// и задачи для запуска/компиляции.

const TASK_TYPE = 'monoscript';
type Action = 'run' | 'compile' | 'check' | 'tokens' | 'ast';

interface MsTaskDefinition extends vscode.TaskDefinition {
    action: Action;
    file?: string;
    output?: string;
}

function config() {
    return vscode.workspace.getConfiguration('monoscript');
}

function compilerPath(): string {
    return config().get<string>('compilerPath', 'ms') || 'ms';
}

function argsFor(def: MsTaskDefinition, file: string): string[] {
    switch (def.action) {
        case 'run': return ['--run', file];
        case 'compile': return ['--compile', def.output || defaultOutput(file), file];
        case 'tokens': return ['--tokens', file];
        case 'ast': return ['--ast', file];
        default: return [file];
    }
}

function defaultOutput(file: string): string {
    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    return process.platform === 'win32' ? base + '.exe' : base;
}

const TITLES: Record<Action, string> = {
    run: 'Run', compile: 'Compile', check: 'Check', tokens: 'Show tokens', ast: 'Show AST'
};

function makeTask(def: MsTaskDefinition, scope: vscode.TaskScope | vscode.WorkspaceFolder, file: string): vscode.Task {
    const exec = new vscode.ShellExecution(compilerPath(), argsFor(def, file), { cwd: path.dirname(file) });
    const task = new vscode.Task(def, scope, `${TITLES[def.action]}: ${path.basename(file)}`, 'MONOSCRIPT', exec, []);
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    if (def.action === 'compile') { task.group = vscode.TaskGroup.Build; }
    return task;
}

export class MsTaskProvider implements vscode.TaskProvider {
    provideTasks(): vscode.Task[] {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'ms' || editor.document.uri.scheme !== 'file') { return []; }
        const file = editor.document.uri.fsPath;
        const scope = vscode.workspace.getWorkspaceFolder(editor.document.uri) ?? vscode.TaskScope.Workspace;
        return (['run', 'compile', 'check'] as Action[]).map(action => makeTask({ type: TASK_TYPE, action }, scope, file));
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as MsTaskDefinition;
        const file = def.file ?? vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!file) { return undefined; }
        return makeTask(def, task.scope ?? vscode.TaskScope.Workspace, file);
    }
}

export async function runAction(action: Action): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'ms') {
        vscode.window.showWarningMessage('Откройте .ms файл.');
        return;
    }
    const document = editor.document;
    if (document.isUntitled) {
        const saved = await document.save();
        if (!saved) { return; }
    } else if (document.isDirty && config().get<boolean>('saveBeforeRun', true)) {
        await document.save();
    }
    const file = document.uri.fsPath;
    const def: MsTaskDefinition = { type: TASK_TYPE, action, file };
    if (action === 'compile') {
        const output = await vscode.window.showInputBox({ prompt: 'Имя исполняемого файла', value: defaultOutput(file) });
        if (!output) { return; }
        def.output = output;
    }
    const scope = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.TaskScope.Workspace;
    await vscode.tasks.executeTask(makeTask(def, scope, file));
}

// ---------- Диагностика ----------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
// `Type mismatch [line 12, column 3]: ...`, `Parser Error [line 4]: ...`, `Warn [line 1, column 1]: ...`
const BRACKET_RE = /^(.*?)\s*\[line (\d+)(?:, column (\d+))?\]:\s*(.*)$/;
// `Parser Error: Unknown primary expression at line 5, column 2: x`, `Tokenizer Error: ... at line 3`
const AT_LINE_RE = /^(.*?(?:Error|error))\s*:\s*(.*?)\s+at line (\d+)(?:,\s*column (\d+))?(?::\s*(.*))?$/;

/**
 * Компилятор нумерует строки после удаления пустых строк и строк-комментариев
 * (Lexer::removeEmpty), поэтому `[line N]` — это N-я *непустая* строка.
 * Возвращает отображение «номер у компилятора» -> реальная строка.
 */
export function compilerLineMap(text: string): number[] {
    const raw = text.split(/\r?\n/);
    const infos = analyzeLines(text);
    const map: number[] = [];
    raw.forEach((line, i) => {
        const trimmed = line.trim();
        const info = infos[i];
        const dropped = trimmed === '' || trimmed.startsWith('//') ||
            (!info.prefix.includes('|') && info.code === '' && (info.inBlockComment || trimmed.startsWith('/*')));
        if (!dropped) { map.push(i); }
    });
    return map;
}

export interface ParsedError {
    line: number;
    message: string;
    severity: vscode.DiagnosticSeverity;
    hint?: string;
}

export function parseCompilerOutput(output: string, text: string, remap: boolean): ParsedError[] {
    const lines = output.replace(ANSI_RE, '').split(/\r?\n/);
    const map = remap ? compilerLineMap(text) : [];
    const totalLines = text.split(/\r?\n/).length;
    const result: ParsedError[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let m = line.match(BRACKET_RE);
        if (m) {
            const n = parseInt(m[2], 10) - 1;
            const real = remap ? (map[n] ?? n) : n;
            const kind = m[1].trim();
            const severity = /^warn/i.test(kind) ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const err: ParsedError = { line: clamp(real, totalLines), message: kind ? `${kind}: ${m[4]}` : m[4], severity };
            const hint = lines.slice(i + 1, i + 5).find(l => /^\s*Hint:/.test(l));
            if (hint) { err.hint = hint.replace(/^\s*Hint:\s*/, ''); }
            result.push(err);
            continue;
        }
        m = line.match(AT_LINE_RE);
        if (m) {
            const real = parseInt(m[3], 10) - 1;
            const message = `${m[1]}: ${m[2]}${m[5] ? ` (${m[5]})` : ''}`;
            result.push({ line: clamp(real, totalLines), message, severity: vscode.DiagnosticSeverity.Error });
        }
    }
    return result;
}

function clamp(line: number, total: number): number {
    return Math.max(0, Math.min(line, total - 1));
}

export class MsDiagnostics implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('monoscript');
    private readonly disposables: vscode.Disposable[] = [this.collection];
    private readonly running = new Map<string, () => void>();
    private warnedMissing = false;
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

    constructor() {
        this.status.command = { command: 'workbench.action.openSettings', title: 'Settings', arguments: ['monoscript.compilerPath'] };
        this.disposables.push(
            this.status,
            vscode.workspace.onDidSaveTextDocument(d => this.check(d)),
            vscode.workspace.onDidOpenTextDocument(d => this.check(d)),
            vscode.workspace.onDidCloseTextDocument(d => this.collection.delete(d.uri)),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('monoscript')) {
                    this.warnedMissing = false;
                    this.status.hide();
                    this.checkAll();
                }
            })
        );
        this.checkAll();
    }

    private enabled(): boolean {
        return config().get<boolean>('diagnostics.enable', true);
    }

    checkAll(): void {
        vscode.workspace.textDocuments.forEach(d => this.check(d));
    }

    check(document: vscode.TextDocument): void {
        if (document.languageId !== 'ms' || document.uri.scheme !== 'file') { return; }
        if (!this.enabled()) { this.collection.clear(); return; }

        const key = document.uri.toString();
        this.running.get(key)?.();
        const text = document.getText();
        const file = document.uri.fsPath;

        const child = execFile(compilerPath(), [file], { cwd: path.dirname(file), timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            this.running.delete(key);
            if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.reportMissingCompiler();
                return;
            }
            if (error && error.killed) { return; }
            this.status.hide();
            const parsed = parseCompilerOutput(`${stderr}\n${stdout}`, text, config().get<boolean>('diagnostics.remapLines', true));
            const diagnostics = parsed.map(p => this.toDiagnostic(document, p));
            if (!diagnostics.length && error && stderr.trim()) {
                // Ошибка без номера строки — показываем на первой строке, чтобы её не потерять
                const msg = stderr.replace(ANSI_RE, '').trim().split(/\r?\n/)[0];
                diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), msg, vscode.DiagnosticSeverity.Error));
            }
            diagnostics.forEach(d => d.source = 'ms');
            this.collection.set(document.uri, diagnostics);
        });
        this.running.set(key, () => child.kill());
    }

    private toDiagnostic(document: vscode.TextDocument, err: ParsedError): vscode.Diagnostic {
        const text = document.lineAt(err.line).text;
        const prefix = (text.match(PREFIX_RE) ?? [''])[0];
        let range = new vscode.Range(err.line, prefix.length, err.line, Math.max(prefix.length, text.trimEnd().length));
        // Если в сообщении упомянуто имя в кавычках и оно есть в строке — подсвечиваем только его
        for (const m of err.message.matchAll(/['"`]([A-Za-z_]\w*)['"`]/g)) {
            const idx = text.search(new RegExp(`\\b${m[1]}\\b`));
            if (idx >= 0) { range = new vscode.Range(err.line, idx, err.line, idx + m[1].length); break; }
        }
        const diag = new vscode.Diagnostic(range, err.hint ? `${err.message}\nHint: ${err.hint}` : err.message, err.severity);
        return diag;
    }

    private reportMissingCompiler(): void {
        this.status.text = '$(warning) MONOSCRIPT: компилятор не найден';
        this.status.tooltip = `Не удалось запустить "${compilerPath()}". Укажите путь в monoscript.compilerPath`;
        this.status.show();
        if (this.warnedMissing) { return; }
        this.warnedMissing = true;
        vscode.window.showWarningMessage(
            `MONOSCRIPT: компилятор "${compilerPath()}" не найден — проверка ошибок отключена.`,
            'Указать путь', 'Отключить проверку'
        ).then(choice => {
            if (choice === 'Указать путь') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'monoscript.compilerPath');
            } else if (choice === 'Отключить проверку') {
                config().update('diagnostics.enable', false, vscode.ConfigurationTarget.Global);
            }
        });
    }

    dispose(): void {
        this.running.forEach(kill => kill());
        this.disposables.forEach(d => d.dispose());
    }
}
