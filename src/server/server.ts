import * as fs from 'fs';
import * as path from 'path';
import {
    createConnection, DidChangeConfigurationNotification, FileChangeType, InitializeResult,
    ProposedFeatures, TextDocumentSyncKind, TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostics, Settings } from './diagnostics';
import { Features, SnippetDef } from './features';
import { WorkspaceIndex } from './workspace';

// Языковой сервер MONOSCRIPT. Запускается расширением VS Code, но работает
// с любым редактором, который умеет LSP: `node out/server/server.js --stdio`.

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const index = new WorkspaceIndex(documents);

const DEFAULTS: Settings = { compilerPath: 'ms', diagnosticsEnable: true, lintEnable: true, indentUnit: '|   ' };
let canReadConfig = false;
let settings: Promise<Settings> | undefined;

function getSettings(): Promise<Settings> {
    if (!canReadConfig) { return Promise.resolve(DEFAULTS); }
    settings ??= connection.workspace.getConfiguration({ section: 'monoscript' }).then((c: Record<string, unknown> | null) => {
        const diag = (c?.diagnostics ?? {}) as Record<string, unknown>;
        const unit = typeof c?.indentUnit === 'string' && c.indentUnit.startsWith('|') ? c.indentUnit : DEFAULTS.indentUnit;
        return {
            compilerPath: typeof c?.compilerPath === 'string' && c.compilerPath ? c.compilerPath : DEFAULTS.compilerPath,
            diagnosticsEnable: diag.enable !== false,
            lintEnable: diag.lint !== false,
            indentUnit: unit
        };
    }, () => DEFAULTS);
    return settings;
}

function loadSnippets(): Record<string, SnippetDef> {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'syntaxes', 'snippets.json'), 'utf8'));
    } catch (e) {
        connection.console.error(`MONOSCRIPT: failed to load snippets: ${e}`);
        return {};
    }
}

const features = new Features(index, loadSnippets(), async () => (await getSettings()).indentUnit);
const diagnostics = new Diagnostics(connection, index, getSettings);

connection.onInitialize((params): InitializeResult => {
    canReadConfig = !!params.capabilities.workspace?.configuration;
    const roots = params.workspaceFolders?.map(f => f.uri) ?? (params.rootUri ? [params.rootUri] : []);
    index.setRoots(roots);
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: { triggerCharacters: ['.', '@', '['] },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            documentHighlightProvider: true,
            renameProvider: { prepareProvider: true },
            documentSymbolProvider: { label: 'MONOSCRIPT' },
            workspaceSymbolProvider: true,
            foldingRangeProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [','] },
            documentFormattingProvider: true,
            inlayHintProvider: true,
            workspace: { workspaceFolders: { supported: true } }
        },
        serverInfo: { name: 'monoscript-language-server', version: '0.3.0' }
    };
});

connection.onInitialized(() => {
    if (canReadConfig) {
        connection.client.register(DidChangeConfigurationNotification.type, { section: 'monoscript' });
    }
});

connection.onDidChangeConfiguration(() => {
    settings = undefined;
    documents.all().forEach(d => { diagnostics.lint(d); diagnostics.compile(d); });
    connection.languages.inlayHint.refresh();
});

connection.onDidChangeWatchedFiles(params => {
    for (const change of params.changes) {
        if (!documents.get(change.uri)) { index.fileChanged(change.uri, change.type === FileChangeType.Deleted); }
    }
    // Новые и удалённые функции в других файлах меняют проверку неизвестных вызовов
    documents.all().forEach(d => diagnostics.changed(d));
});

documents.onDidOpen(e => { diagnostics.lint(e.document); diagnostics.compile(e.document); });
documents.onDidChangeContent(e => diagnostics.changed(e.document));
documents.onDidSave(e => diagnostics.compile(e.document));
documents.onDidClose(e => { index.forget(e.document.uri); diagnostics.closed(e.document.uri); });

const withDoc = <P extends { textDocument: { uri: string } }, R>(fn: (doc: TextDocument, p: P) => R, empty: R) =>
    (p: P): R => {
        const doc = documents.get(p.textDocument.uri);
        return doc ? fn(doc, p) : empty;
    };

connection.onCompletion(withDoc((d, p) => features.completion(d, p.position), Promise.resolve([])));
connection.onHover(withDoc((d, p) => features.hover(d, p.position) ?? null, null));
connection.onDefinition(withDoc((d, p) => features.definition(d, p.position) ?? null, null));
connection.onReferences(withDoc((d, p) => features.references(d, p.position, p.context.includeDeclaration), []));
connection.onDocumentHighlight(withDoc((d, p) => features.documentHighlights(d, p.position), []));
connection.onPrepareRename(withDoc((d, p) => features.prepareRename(d, p.position) ?? null, null));
connection.onRenameRequest(withDoc((d, p) => features.rename(d, p.position, p.newName) ?? null, null));
connection.onDocumentSymbol(withDoc(d => features.documentSymbols(d), []));
connection.onWorkspaceSymbol(p => features.workspaceSymbols(p.query));
connection.onFoldingRanges(withDoc(d => features.foldingRanges(d), []));
connection.onSignatureHelp(withDoc((d, p) => features.signatureHelp(d, p.position) ?? null, null));
connection.onDocumentFormatting(withDoc(d => features.format(d), Promise.resolve([])));
connection.languages.inlayHint.on(withDoc((d, p) => features.inlayHints(d, p.range), []));

documents.listen(connection);
connection.listen();
