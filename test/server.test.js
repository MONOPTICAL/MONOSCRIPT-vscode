// Проверка языкового сервера через настоящий протокол: сервер запускается
// как отдельный процесс (`--stdio`), тест шлёт ему запросы LSP.
// Запуск: npm test (сначала собирает проект)
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rpc = require('vscode-jsonrpc/node');
const { URI } = require('vscode-uri');

// MS_SERVER — путь к другому server.js, например из установленного расширения
const SERVER = process.env.MS_SERVER || path.join(__dirname, '..', 'out', 'server', 'server.js');

const LIB = `[i32]helper(i32: x)
|   return x * 2
`;

const MAIN = `[struct]User
|   i32 age = 18
|   string name = "anon"
|
|   [void]birthday()
|   |   self.age = self.age + 1

[result<i32>]parse(string: s)
|   if len(s) != 1
|   |   return err(1, "bad")
|   return ok(s[0]->i32)

[i32]main()
|   User u = User()
|   u.birthday()
|   n ^= helper(2)
|   r ^= parse("7")
|   for c in u.name
|   |   echo(cstr(c))
|   x ^= missing(1)
|   |   echo("deep")
|   char bad = 'ab'
|   echo("open)
|   return n
`;

let proc, conn, dir, mainUri, libUri;
const diagnostics = new Map();
const missingCompiler = [];

const at = (line, character) => ({ textDocument: { uri: mainUri }, position: { line, character } });
const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeout = 3000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const value = check();
        if (value) { return value; }
        await wait(50);
    }
    throw new Error('timeout');
}

before(async () => {
    assert.ok(fs.existsSync(SERVER), 'нет out/server/server.js — сначала npm run compile');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-lsp-'));
    fs.writeFileSync(path.join(dir, 'lib.ms'), LIB);
    fs.writeFileSync(path.join(dir, 'main.ms'), MAIN);
    mainUri = URI.file(path.join(dir, 'main.ms')).toString();
    libUri = URI.file(path.join(dir, 'lib.ms')).toString();

    proc = cp.spawn(process.execPath, [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
    conn = rpc.createMessageConnection(new rpc.StreamMessageReader(proc.stdout), new rpc.StreamMessageWriter(proc.stdin));
    conn.onNotification('textDocument/publishDiagnostics', p => diagnostics.set(p.uri, p.diagnostics));
    conn.onNotification('monoscript/compilerMissing', p => missingCompiler.push(p.path));
    conn.onRequest('workspace/configuration', () => [{ compilerPath: 'ms-not-installed-for-tests', diagnostics: { enable: true, lint: true }, indentUnit: '|   ' }]);
    conn.onRequest('client/registerCapability', () => null);
    conn.listen();

    const root = URI.file(dir).toString();
    await conn.sendRequest('initialize', {
        processId: process.pid, rootUri: root, workspaceFolders: [{ uri: root, name: 'ws' }],
        capabilities: { workspace: { configuration: true } }
    });
    conn.sendNotification('initialized', {});
    conn.sendNotification('textDocument/didOpen', { textDocument: { uri: mainUri, languageId: 'ms', version: 1, text: MAIN } });
});

after(async () => {
    try { await conn.sendRequest('shutdown'); conn.sendNotification('exit'); } catch { /* сервер уже остановлен */ }
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('быстрые проверки находят ошибки без компилятора', async () => {
    const list = await waitFor(() => diagnostics.get(mainUri)?.length ? diagnostics.get(mainUri) : undefined);
    const codes = list.map(d => `${d.range.start.line + 1}:${d.code}`).sort();
    assert.deepEqual(codes, ['20:unknown-function', '21:indent', '22:bad-char', '23:unclosed-string'].sort());
    assert.ok(list.every(d => d.source === 'ms-lint'));
});

test('без компилятора клиент получает уведомление', async () => {
    await waitFor(() => missingCompiler.length);
    assert.equal(missingCompiler[0], 'ms-not-installed-for-tests');
});

test('автодополнение членов структуры через переменную и self', async () => {
    const viaVar = await conn.sendRequest('textDocument/completion', at(14, 6));
    assert.deepEqual(viaVar.map(c => c.label), ['age', 'name', 'birthday']);
    const viaSelf = await conn.sendRequest('textDocument/completion', at(5, 13));
    assert.deepEqual(viaSelf.map(c => c.label), ['age', 'name', 'birthday']);
});

test('автодополнение видит функции из других файлов и встроенные', async () => {
    const items = await conn.sendRequest('textDocument/completion', at(16, 4));
    const labels = items.map(c => c.label);
    for (const name of ['helper', 'parse', 'u', 'len', 'push', 'if', 'msfunc']) { assert.ok(labels.includes(name), name); }
});

test('hover и переход к определению в другом файле', async () => {
    const hover = await conn.sendRequest('textDocument/hover', at(15, 10));
    assert.match(hover.contents.value, /\[i32\]helper\(i32: x\)/);
    const def = await conn.sendRequest('textDocument/definition', at(15, 10));
    assert.equal(def.uri, libUri);
    assert.equal(def.range.start.line, 0);
    const method = await conn.sendRequest('textDocument/definition', at(14, 7));
    assert.equal(method.range.start.line, 4);
});

test('подсказка у ключевого слова и встроенной функции ведёт в справочник', async () => {
    const kw = await conn.sendRequest('textDocument/hover', at(8, 4));     // if
    assert.match(kw.contents.value, /command:monoscript\.openGuide\?%5B%22control%22%5D/);
    const fn = await conn.sendRequest('textDocument/hover', at(9, 15));    // err
    assert.match(fn.contents.value, /command:monoscript\.openGuide\?%5B%22result%22%5D/);
});

test('подсказка сигнатуры', async () => {
    const help = await conn.sendRequest('textDocument/signatureHelp', at(16, 15));
    assert.equal(help.signatures[0].label, '[result<i32>]parse(string: s)');
});

test('подсказки выведенных типов', async () => {
    const hints = await conn.sendRequest('textDocument/inlayHint', { textDocument: { uri: mainUri }, range: { start: { line: 0, character: 0 }, end: { line: 30, character: 0 } } });
    assert.deepEqual(hints.map(h => `${h.position.line}${h.label}`), ['15: i32', '16: result<i32>', '17: char']);
});

test('ссылки на поле находятся только после точки', async () => {
    const refs = await conn.sendRequest('textDocument/references', { ...at(1, 8), context: { includeDeclaration: true } });
    assert.deepEqual(refs.map(r => `${r.range.start.line}:${r.range.start.character}`).sort(), ['1:8', '5:13', '5:24'].sort());
});

test('переименование функции меняет оба файла', async () => {
    const edit = await conn.sendRequest('textDocument/rename', { ...at(15, 10), newName: 'twice' });
    assert.deepEqual(Object.keys(edit.changes).sort(), [libUri, mainUri].sort());
    const local = await conn.sendRequest('textDocument/rename', { ...at(15, 4), newName: 'm' });
    assert.deepEqual(Object.keys(local.changes), [mainUri]);
    assert.equal(local.changes[mainUri].length, 2); // объявление и return n
});

test('структура документа и символы рабочей области', async () => {
    const symbols = await conn.sendRequest('textDocument/documentSymbol', { textDocument: { uri: mainUri } });
    assert.deepEqual(symbols.map(s => s.name), ['User', 'parse', 'main']);
    assert.deepEqual(symbols[0].children.map(c => c.name), ['age', 'name', 'birthday']);
    const found = await conn.sendRequest('workspace/symbol', { query: 'help' });
    assert.deepEqual(found.map(s => s.name), ['helper']);
});

test('после исправления ошибка отступа пропадает', async () => {
    const fixed = MAIN.replace('|   |   echo("deep")\n', '');
    conn.sendNotification('textDocument/didChange', { textDocument: { uri: mainUri, version: 2 }, contentChanges: [{ text: fixed }] });
    await waitFor(() => !diagnostics.get(mainUri).some(d => d.code === 'indent'));
});
