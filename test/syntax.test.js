// Синтаксис новых версий компилятора: ветки `if x: stmt`, постфиксный `?`,
// toInt -> result<i32>. Проверяются анализатор и быстрые проверки напрямую.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { analyze, opensBlock, inlineColon, unwrapTry, tryElse, visibleSymbols } = require('../out/analyzer');
const { lint } = require('../out/server/lint');

const codes = text => lint(text, analyze(text), new Set()).map(d => `${d.line + 1}:${d.code}`);

test('ветка в одну строку не открывает блок', () => {
    assert.equal(opensBlock('if n < 0: return -1'), false);
    assert.equal(opensBlock('else if n == 0: return 0'), false);
    assert.equal(opensBlock('else: return 1'), false);
    assert.equal(opensBlock('if n < 0'), true);
    assert.equal(opensBlock('else'), true);
    // Двоеточие в строке, символе или скобках — не ветка
    assert.equal(inlineColon('if s == ":"'), -1);
    assert.equal(inlineColon("if c == ':'"), -1);
    assert.equal(inlineColon('if has(m, f(a: 1))'), -1);
});

test('быстрые проверки понимают ветки через двоеточие', () => {
    const ok = [
        '[i32]sign(i32: n)',
        '|   if n < 0: return -1',
        '|   else if n == 0: return 0',
        '|   else: return 1',
        '',
        '[void]show(i32: n)',
        '|   if n > 100',
        '|   |   echo("big")',
        '|   else: echo("small")'
    ].join('\n');
    assert.deepEqual(codes(ok), []);

    const bad = [
        '[i32]main()',
        '|   if 1 == 1:',
        '|   |   echo("x")',
        '|   if 1 == 1: if 2 == 2: echo("y")',
        '|   i32 i = 0',
        '|   while i < 3: i = i + 1',
        '|   return 0'
    ].join('\n');
    assert.deepEqual(codes(bad).filter(c => c.endsWith('inline-if')), ['2:inline-if', '4:inline-if', '6:inline-if']);
});

test('постфиксный ? разворачивает result в выводе типов', () => {
    assert.equal(unwrapTry('result<i32>', 1), 'i32');
    assert.equal(unwrapTry('result<result<i64>>', 2), 'i64');
    assert.equal(unwrapTry('i32', 1), undefined);

    const doc = analyze([
        '[result<i32>]half(i32: x)',
        '|   return ok(x / 2)',
        '',
        '[result<i32>]sum(string: a)',
        '|   r ^= toInt(a)',
        '|   n ^= toInt(a)?',
        '|   h ^= half(4)?',
        '|   parts ^= split(a, ",")',
        '|   return ok(n + h)'
    ].join('\n'));
    const type = name => doc.all.find(s => s.name === name)?.type;
    assert.equal(type('r'), 'result<i32>');
    assert.equal(type('n'), 'i32');
    assert.equal(type('h'), 'i32');
    assert.equal(type('parts'), 'array<string>');
});

// Обработка ошибок на месте (компилятор 8587cfa): attempt, else error, panic info, r? else

test('attempt и его обработчики открывают блоки', () => {
    assert.equal(opensBlock('attempt'), true);
    assert.equal(opensBlock('else error'), true);
    assert.equal(opensBlock('panic info'), true);
    assert.equal(opensBlock('n ^= toInt(s)? else: return 1'), false);
    assert.equal(tryElse('n ^= toInt(s)? else 0'), 15);
    assert.equal(tryElse('if ok: echo("? else")'), -1);
    assert.equal(tryElse('x ^= f(a? else 1)'), -1);
});

test('типы у r? else и имена обработчиков', () => {
    const text = [
        '[i32]main()',
        '|   port ^= toInt("x")? else 8080',
        '|   n ^= toInt("4")? else: echo(error.error); return error.code',
        '|   attempt',
        '|   |   v ^= toInt("7")?',
        '|   else error',
        '|   |   echo(error.error)',
        '|   panic info',
        '|   |   echo(info.message)',
        '|   return 0'
    ].join('\n');
    const doc = analyze(text);
    const type = name => doc.all.find(s => s.name === name)?.type;
    assert.equal(type('port'), 'i32');
    assert.equal(type('n'), 'i32');
    assert.equal(type('info'), 'panic_info');
    const visible = line => visibleSymbols(doc, line).map(s => s.name);
    assert.ok(visible(6).includes('error'));
    assert.ok(visible(8).includes('info'));
    assert.ok(!visible(9).includes('info'));
    assert.ok(!visible(9).includes('error'));
    assert.deepEqual(codes(text), []);
});

test('быстрые проверки attempt и ? else', () => {
    const bad = [
        '[i32]main()',
        '|   attempt',
        '|   |   return 1',
        '|   attempt',
        '|   |   n ^= toInt("x")?',
        '|   else error',
        '|   |   return 1',
        '|   else again',
        '|   |   return 2',
        '|   panic info',
        '|   |   echo(info.message)',
        '|   panic stray',
        '|   |   echo("x")',
        '|   a ^= toInt("3")? else:',
        '|   b ^= toInt("3")? else: echo(error.error)',
        '|   c ^= toInt("3")? else',
        '|   return 0'
    ].join('\n');
    assert.deepEqual(codes(bad).filter(c => /attempt|try-else/.test(c)),
        ['14:try-else', '15:try-else', '16:try-else', '2:attempt', '8:attempt', '12:attempt']);
});
