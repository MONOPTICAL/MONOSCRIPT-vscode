import * as vscode from 'vscode';
import * as path from 'path';

// Интеграция с компилятором `ms` (https://github.com/MONOPTICAL/MONOSCRIPT):
// задачи и команды для запуска, компиляции и просмотра стадий. Проверку файлов
// компилятором при сохранении делает языковой сервер (src/server/diagnostics.ts).

const TASK_TYPE = 'monoscript';
export type Action = 'run' | 'compile' | 'check' | 'tokens' | 'ast' | 'semantic';

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

function extraArgs(): string[] {
    return config().get<string[]>('extraArgs', []).filter(a => typeof a === 'string' && a.length > 0);
}

function argsFor(def: MsTaskDefinition, file: string): string[] {
    switch (def.action) {
        case 'run': return ['run', file, ...extraArgs()];
        case 'compile': return ['--compile', def.output || defaultOutput(file), file, ...extraArgs()];
        case 'tokens': return ['--tokens', file];
        case 'ast': return ['--ast', file];
        case 'semantic': return ['--semantic', file];
        default: return [file];
    }
}

function defaultOutput(file: string): string {
    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    return process.platform === 'win32' ? base + '.exe' : base;
}

const TITLES: Record<Action, string> = {
    run: 'Run', compile: 'Compile', check: 'Check', tokens: 'Show tokens', ast: 'Show AST', semantic: 'Show semantic analysis'
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
