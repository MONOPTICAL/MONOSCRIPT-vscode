import * as vscode from 'vscode';
import { PREFIX_RE } from './analyzer';

// Подсветка `|`-отступов: по уровням (rainbow) или приглушённо (dim).

const RAINBOW = ['#e5c07b', '#c678dd', '#61afef', '#98c379', '#e06c75', '#56b6c2'];

export class BlockGuides implements vscode.Disposable {
    private types: vscode.TextEditorDecorationType[] = [];
    private readonly disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;

    constructor() {
        this.createTypes();
        this.disposables.push(
            vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.languageId === 'ms') { this.schedule(); }
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('monoscript.blockGuides')) {
                    this.createTypes();
                    this.updateAll();
                }
            })
        );
        this.updateAll();
    }

    private style(): string {
        return vscode.workspace.getConfiguration('monoscript').get<string>('blockGuides', 'rainbow');
    }

    private createTypes(): void {
        this.types.forEach(t => t.dispose());
        const style = this.style();
        if (style === 'rainbow') {
            this.types = RAINBOW.map(color => vscode.window.createTextEditorDecorationType({ color, opacity: '0.75' }));
        } else if (style === 'dim') {
            this.types = [vscode.window.createTextEditorDecorationType({ opacity: '0.35' })];
        } else {
            this.types = [];
        }
    }

    private schedule(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => this.updateAll(), 100);
    }

    private updateAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.languageId === 'ms') { this.update(editor); }
        }
    }

    private update(editor: vscode.TextEditor): void {
        const buckets: vscode.Range[][] = this.types.map(() => []);
        if (this.types.length) {
            const doc = editor.document;
            for (let line = 0; line < doc.lineCount; line++) {
                const text = doc.lineAt(line).text;
                const prefix = (text.match(PREFIX_RE) ?? [''])[0];
                let depth = 0;
                for (let i = 0; i < prefix.length; i++) {
                    if (prefix[i] !== '|') { continue; }
                    buckets[depth % this.types.length].push(new vscode.Range(line, i, line, i + 1));
                    depth++;
                }
            }
        }
        this.types.forEach((t, i) => editor.setDecorations(t, buckets[i]));
    }

    dispose(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.types.forEach(t => t.dispose());
        this.disposables.forEach(d => d.dispose());
    }
}
