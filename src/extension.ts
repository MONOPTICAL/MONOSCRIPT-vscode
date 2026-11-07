import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { BlockGuides } from './blockGuides';
import { GuidePanel } from './guidePanel';
import { MsTaskProvider, runAction } from './compiler';
import { indentLines, onBackspace, onEnter, outdentLines } from './indent';

// Клиентская часть: запускает языковой сервер (src/server) и держит то, что
// работает только внутри VS Code — умные Enter/Backspace, подсветку `|`, задачи.

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
    client = startClient(context);

    context.subscriptions.push(
        new BlockGuides(),
        vscode.tasks.registerTaskProvider('monoscript', new MsTaskProvider()),

        // Старые id команд сохранены для совместимости с пользовательскими keybindings
        vscode.commands.registerTextEditorCommand('ms.customEnter', editor => onEnter(editor)),
        vscode.commands.registerTextEditorCommand('ms.customBackspace', editor => onBackspace(editor)),
        vscode.commands.registerTextEditorCommand('monoscript.indentLines', editor => indentLines(editor)),
        vscode.commands.registerTextEditorCommand('monoscript.outdentLines', editor => outdentLines(editor)),

        vscode.commands.registerCommand('monoscript.run', () => runAction('run')),
        vscode.commands.registerCommand('monoscript.compile', () => runAction('compile')),
        vscode.commands.registerCommand('monoscript.check', () => runAction('check')),
        vscode.commands.registerCommand('monoscript.showTokens', () => runAction('tokens')),
        vscode.commands.registerCommand('monoscript.showAST', () => runAction('ast')),
        vscode.commands.registerCommand('monoscript.showSemantic', () => runAction('semantic')),
        vscode.commands.registerCommand('monoscript.openGuide', (section?: string) => GuidePanel.show(context, typeof section === 'string' ? section : undefined)),
        vscode.commands.registerCommand('monoscript.searchGuide', () => searchGuide(context)),
        vscode.commands.registerCommand('monoscript.restartServer', async () => {
            await client?.stop();
            client = startClient(context);
        })
    );
}

function startClient(context: vscode.ExtensionContext): LanguageClient {
    const module = context.asAbsolutePath(path.join('out', 'server', 'server.js'));
    const serverOptions: ServerOptions = {
        run: { module, transport: TransportKind.ipc },
        debug: { module, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'ms' }],
        synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ms') },
        outputChannelName: 'MONOSCRIPT Language Server',
        // Ссылки «Справочник» в подсказках открывают панель справочника
        markdown: { isTrusted: { enabledCommands: ['monoscript.openGuide'] } }
    };
    const lc = new LanguageClient('monoscript', 'MONOSCRIPT Language Server', serverOptions, clientOptions);
    const missing = new CompilerMissing();
    context.subscriptions.push(missing);
    lc.start().then(() => {
        lc.onNotification('monoscript/compilerMissing', (p: { path: string }) => missing.report(p.path));
    });
    context.subscriptions.push({ dispose: () => { lc.stop(); } });
    return lc;
}

/** Сервер не нашёл компилятор: строка состояния и одно предупреждение за сессию. */
class CompilerMissing implements vscode.Disposable {
    private warned = false;
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    private readonly listener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('monoscript.compilerPath')) { this.warned = false; this.status.hide(); }
    });

    constructor() {
        this.status.command = { command: 'workbench.action.openSettings', title: 'Settings', arguments: ['monoscript.compilerPath'] };
    }

    report(compiler: string): void {
        this.status.text = '$(warning) MONOSCRIPT: компилятор не найден';
        this.status.tooltip = `Не удалось запустить "${compiler}". Укажите путь в monoscript.compilerPath`;
        this.status.show();
        if (this.warned) { return; }
        this.warned = true;
        vscode.window.showWarningMessage(
            `MONOSCRIPT: компилятор "${compiler}" не найден — проверка компилятором отключена, остаются быстрые проверки.`,
            'Указать путь', 'Отключить проверку'
        ).then(choice => {
            if (choice === 'Указать путь') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'monoscript.compilerPath');
            } else if (choice === 'Отключить проверку') {
                vscode.workspace.getConfiguration('monoscript').update('diagnostics.enable', false, vscode.ConfigurationTarget.Global);
            }
        });
    }

    dispose(): void {
        this.status.dispose();
        this.listener.dispose();
    }
}

/** Быстрый переход к разделу справочника по заголовку. */
async function searchGuide(context: vscode.ExtensionContext): Promise<void> {
    const items = GuidePanel.headings(context).map(h => ({
        label: h.level === 3 ? `$(dash) ${h.text}` : h.text,
        id: h.id
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'MONOSCRIPT', matchOnDescription: true });
    if (picked) { GuidePanel.show(context, picked.id); }
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
