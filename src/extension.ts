import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BlockGuides } from './blockGuides';
import { MsDiagnostics, MsTaskProvider, runAction } from './compiler';
import { MsLanguageFeatures, SnippetDef } from './features';
import { indentLines, onBackspace, onEnter, outdentLines } from './indent';
import { WorkspaceIndex } from './workspaceIndex';

export function activate(context: vscode.ExtensionContext) {
    const index = new WorkspaceIndex();
    new MsLanguageFeatures(index, loadSnippets(context)).register(context);

    context.subscriptions.push(
        index,
        new MsDiagnostics(),
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
        vscode.commands.registerCommand('monoscript.showAST', () => runAction('ast'))
    );
}

function loadSnippets(context: vscode.ExtensionContext): Record<string, SnippetDef> {
    try {
        return JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'syntaxes', 'snippets.json'), 'utf8'));
    } catch (e) {
        console.error('MONOSCRIPT: failed to load snippets', e);
        return {};
    }
}

export function deactivate(): void {
    // Всё освобождается через context.subscriptions
}
