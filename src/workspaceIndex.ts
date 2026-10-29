import * as vscode from 'vscode';
import { analyze, MsDocument } from './analyzer';

// Кэш разобранных .ms файлов: открытые документы берутся из редактора,
// остальные читаются с диска и обновляются через FileSystemWatcher.
export class WorkspaceIndex implements vscode.Disposable {
    private readonly cache = new Map<string, { version: number; doc: MsDocument }>();
    private readonly disk = new Map<string, MsDocument>();
    private readonly disposables: vscode.Disposable[] = [];
    private ready: Thenable<void> | undefined;

    constructor() {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.ms');
        watcher.onDidCreate(uri => this.loadFromDisk(uri), null, this.disposables);
        watcher.onDidChange(uri => this.loadFromDisk(uri), null, this.disposables);
        watcher.onDidDelete(uri => this.disk.delete(uri.toString()), null, this.disposables);
        this.disposables.push(watcher);
        vscode.workspace.onDidCloseTextDocument(d => this.cache.delete(d.uri.toString()), null, this.disposables);
    }

    get(document: vscode.TextDocument): MsDocument {
        const key = document.uri.toString();
        const hit = this.cache.get(key);
        if (hit && hit.version === document.version) { return hit.doc; }
        const doc = analyze(document.getText());
        this.cache.set(key, { version: document.version, doc });
        return doc;
    }

    /** Все файлы рабочей области (открытые — в актуальном состоянии). */
    async all(): Promise<{ uri: vscode.Uri; doc: MsDocument }[]> {
        await this.scan();
        const result = new Map<string, { uri: vscode.Uri; doc: MsDocument }>();
        for (const [key, doc] of this.disk) { result.set(key, { uri: vscode.Uri.parse(key), doc }); }
        for (const d of vscode.workspace.textDocuments) {
            if (d.languageId === 'ms') { result.set(d.uri.toString(), { uri: d.uri, doc: this.get(d) }); }
        }
        return [...result.values()];
    }

    private scan(): Thenable<void> {
        if (!this.ready) {
            this.ready = vscode.workspace.findFiles('**/*.ms', '**/{node_modules,.git,build,out}/**', 2000)
                .then(uris => Promise.all(uris.map(u => this.loadFromDisk(u))))
                .then(() => undefined);
        }
        return this.ready;
    }

    private async loadFromDisk(uri: vscode.Uri): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            this.disk.set(uri.toString(), analyze(Buffer.from(bytes).toString('utf8')));
        } catch {
            this.disk.delete(uri.toString());
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
