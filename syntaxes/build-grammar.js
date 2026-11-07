// Генератор syntaxes/ms.tmLanguage.json.
// Регулярки здесь пишутся обычными JS-строками (String.raw), поэтому не надо
// вручную экранировать каждый слеш в JSON. Запуск: npm run grammar
const fs = require('fs');
const path = require('path');

const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
// Тип: i32, Player, array<i32>, map<string, array<i32>>, func<i32, i32> (до трёх уровней вложенности)
const TYPE = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:<(?:[\w\s,]|<(?:[\w\s,]|<[\w\s,]*>)*>)*>)?`;
const PRIMITIVES = 'i1|i8|i16|i32|i64|float|f64|char|string|void|auto';
const CONTAINERS = 'array|map|func|result';
const KEYWORDS_NOT_TYPES = 'if|else|while|for|in|return|break|continue|and|or|is|use|const|final|public|private|this|self|defined|true|false|null|none|struct';
// Функции из mono/mono.toml и встроенные в компилятор (len, push, ok, ...)
const BUILTINS = 'echo|input|scat|substr|strfind|startsWith|count|split|toInt|toString_int|toString_char|toString_bool|toString_float|toString_f64|toString_long|toArray|joinChars|gc_collect|len|has|del|copy|push|pop|ok|err|range|cstr';

const grammar = {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'MONOSCRIPT',
    scopeName: 'source.ms',
    fileTypes: ['ms'],
    patterns: [
        { include: '#comments' },
        { include: '#block-guides' },
        { include: '#import' },
        { include: '#struct-declaration' },
        { include: '#function-declaration' },
        { include: '#statements' }
    ],
    repository: {
        comments: {
            patterns: [
                {
                    name: 'comment.block.ms',
                    begin: String.raw`/\*`,
                    end: String.raw`\*/`,
                    captures: { 0: { name: 'punctuation.definition.comment.ms' } },
                    patterns: [{ include: '#comment-tags' }]
                },
                {
                    name: 'comment.line.double-slash.ms',
                    begin: '//',
                    end: '$',
                    beginCaptures: { 0: { name: 'punctuation.definition.comment.ms' } },
                    patterns: [{ include: '#comment-tags' }]
                }
            ]
        },
        'comment-tags': {
            match: String.raw`\b(TODO|FIXME|HACK|NOTE|XXX)\b`,
            name: 'keyword.other.todo.ms'
        },

        // Вертикальные черты в начале строки — это отступы блоков, а не оператор.
        'block-guides': {
            match: String.raw`^[ \t]*((?:\|(?!>)[ \t]*)+)`,
            captures: { 1: { name: 'punctuation.section.block.ms' } }
        },

        // use
        // |> module
        // |> math -> sqrt : alias
        import: {
            patterns: [
                {
                    match: String.raw`\b(use)\b`,
                    name: 'keyword.control.import.ms'
                },
                {
                    match: String.raw`(?:^|(?<=\buse))[ \t]*(\|>)[ \t]*(${IDENT})[ \t]*(?:(->)[ \t]*(${IDENT})[ \t]*(?:(:)[ \t]*(${IDENT}))?)?[ \t]*(?=$|//)`,
                    captures: {
                        1: { name: 'keyword.operator.pipe.ms' },
                        2: { name: 'entity.name.namespace.ms' },
                        3: { name: 'keyword.operator.arrow.ms' },
                        4: { name: 'entity.name.function.ms' },
                        5: { name: 'punctuation.separator.alias.ms' },
                        6: { name: 'entity.name.function.alias.ms' }
                    }
                }
            ]
        },

        // [struct]Player
        'struct-declaration': {
            match: String.raw`(\[)\s*(struct)\s*(\])\s*(${IDENT})`,
            captures: {
                1: { name: 'punctuation.definition.type.begin.ms' },
                2: { name: 'storage.type.struct.ms' },
                3: { name: 'punctuation.definition.type.end.ms' },
                4: { name: 'entity.name.type.struct.ms' }
            }
        },

        // [i32]name(i32: a, array<i32>: b) @pure
        // [T]first<T>(array<T>: items)
        // Методы объявляются так же, внутри блока структуры
        'function-declaration': {
            name: 'meta.function.ms',
            begin: String.raw`(\[)\s*(${TYPE})\s*(\])\s*(${IDENT})\s*(?:(<)([\w\s,]*)(>))?\s*(\()`,
            beginCaptures: {
                1: { name: 'punctuation.definition.type.begin.ms' },
                2: { patterns: [{ include: '#type-expression' }] },
                3: { name: 'punctuation.definition.type.end.ms' },
                4: { name: 'entity.name.function.ms' },
                5: { name: 'punctuation.definition.typeparameters.begin.ms' },
                6: { patterns: [{ include: '#type-parameters' }] },
                7: { name: 'punctuation.definition.typeparameters.end.ms' },
                8: { name: 'punctuation.definition.parameters.begin.ms' }
            },
            end: String.raw`\)`,
            endCaptures: { 0: { name: 'punctuation.definition.parameters.end.ms' } },
            patterns: [{ include: '#parameters' }]
        },
        'type-parameters': {
            patterns: [
                { match: IDENT, name: 'entity.name.type.parameter.ms' },
                { match: ',', name: 'punctuation.separator.comma.ms' }
            ]
        },

        parameters: {
            patterns: [
                { include: '#comments' },
                {
                    // func: keep(T: x) -> i1
                    match: String.raw`\b(func)\s*(:)\s*(${IDENT})?`,
                    captures: {
                        1: { name: 'storage.type.ms' },
                        2: { name: 'punctuation.separator.parameter.ms' },
                        3: { name: 'variable.parameter.function.ms' }
                    }
                },
                {
                    match: String.raw`(${TYPE})\s*(:)\s*(${IDENT})`,
                    captures: {
                        1: { patterns: [{ include: '#type-expression' }] },
                        2: { name: 'punctuation.separator.parameter.ms' },
                        3: { name: 'variable.parameter.ms' }
                    }
                },
                {
                    begin: String.raw`\(`,
                    end: String.raw`\)`,
                    patterns: [{ include: '#parameters' }]
                },
                { match: '->', name: 'keyword.operator.arrow.ms' },
                { match: ',', name: 'punctuation.separator.comma.ms' },
                { include: '#type-expression' }
            ]
        },

        'type-expression': {
            patterns: [
                { match: String.raw`\b(${PRIMITIVES})\b`, name: 'storage.type.primitive.ms' },
                { match: String.raw`\b(${CONTAINERS})\b`, name: 'storage.type.generic.ms' },
                { match: String.raw`\bstruct\b`, name: 'storage.type.struct.ms' },
                { match: '<', name: 'punctuation.definition.generic.begin.ms' },
                { match: '>', name: 'punctuation.definition.generic.end.ms' },
                { match: ',', name: 'punctuation.separator.comma.ms' },
                { match: IDENT, name: 'entity.name.type.ms' }
            ]
        },

        statements: {
            patterns: [
                { include: '#comments' },
                { include: '#labels' },
                { include: '#for-loop' },
                { include: '#declarations' },
                { include: '#keywords' },
                { include: '#cast' },
                { include: '#expressions' }
            ]
        },

        // @entry @strict @pure @private @overwrite (+ зарезервированные @public @test)
        labels: {
            patterns: [
                {
                    match: String.raw`(@)(strict|pure|entry|public|private|test|overwrite)\b`,
                    captures: {
                        0: { name: 'storage.modifier.label.ms' },
                        1: { name: 'punctuation.definition.label.ms' }
                    }
                },
                {
                    match: String.raw`(@)${IDENT}`,
                    name: 'invalid.deprecated.label.unknown.ms',
                    captures: { 1: { name: 'punctuation.definition.label.ms' } }
                }
            ]
        },

        // for i in range(x) / for x in array / for k in map / for c in string
        'for-loop': {
            match: String.raw`\b(for)\s+(${IDENT})\s+(in)\b`,
            captures: {
                1: { name: 'keyword.control.loop.ms' },
                2: { name: 'variable.other.loop.ms' },
                3: { name: 'keyword.control.loop.ms' }
            }
        },

        declarations: {
            patterns: [
                {
                    // const i32 x = 5 / final i32 x / string name = "..." / map<string,string> info / Player p = ...
                    match: String.raw`(?:\b(const|final)\s+)?(?<![.\w])(?!(?:${KEYWORDS_NOT_TYPES})\b)(${TYPE})\s+(?!(?:${KEYWORDS_NOT_TYPES})\b)(${IDENT})\s*(?=$|//|=(?!=))`,
                    captures: {
                        1: { name: 'storage.modifier.ms' },
                        2: { patterns: [{ include: '#type-expression' }] },
                        3: { name: 'variable.other.declaration.ms' }
                    }
                },
                {
                    // final x ^= ... / x ^= ...
                    match: String.raw`(?:\b(final)\s+)?(?<![.\w])(${IDENT})\s*(?=\^=)`,
                    captures: {
                        1: { name: 'storage.modifier.ms' },
                        2: { name: 'variable.other.declaration.ms' }
                    }
                }
            ]
        },

        keywords: {
            patterns: [
                { match: String.raw`\b(if|else)\b`, name: 'keyword.control.conditional.ms' },
                { match: String.raw`\b(while|for|in)\b`, name: 'keyword.control.loop.ms' },
                { match: String.raw`\b(return|break|continue)\b`, name: 'keyword.control.flow.ms' },
                { match: String.raw`\b(and|or|is)\b`, name: 'keyword.operator.logical.ms' },
                { match: String.raw`\b(defined)\b`, name: 'keyword.operator.defined.ms' },
                { match: String.raw`\b(const|final|public|private)\b`, name: 'storage.modifier.ms' },
                { match: String.raw`\b(self|this)\b`, name: 'variable.language.self.ms' },
                // _ ^= save() — результат намеренно игнорируется
                { match: String.raw`(?<![\w.])_(?![\w])`, name: 'variable.language.discard.ms' }
            ]
        },

        // x -> i64
        cast: {
            match: String.raw`(->)\s*\b(i1|i8|i16|i32|i64|float|f64|char)\b`,
            captures: {
                1: { name: 'keyword.operator.cast.ms' },
                2: { name: 'storage.type.primitive.ms' }
            }
        },

        expressions: {
            patterns: [
                { include: '#comments' },
                { include: '#strings' },
                { include: '#chars' },
                { include: '#numbers' },
                { include: '#constants' },
                { include: '#keywords' },
                { include: '#cast' },
                { include: '#function-call' },
                { include: '#type-expression-standalone' },
                { include: '#member-access' },
                { include: '#operators' },
                { include: '#punctuation' }
            ]
        },

        strings: {
            name: 'string.quoted.double.ms',
            begin: '"',
            end: String.raw`"|$`,
            beginCaptures: { 0: { name: 'punctuation.definition.string.begin.ms' } },
            endCaptures: { 0: { name: 'punctuation.definition.string.end.ms' } },
            patterns: [
                { match: String.raw`\\[nrtfb0'"\\]`, name: 'constant.character.escape.ms' },
                { match: String.raw`\\.`, name: 'invalid.illegal.escape.ms' }
            ]
        },

        // 'a', '\n', '\''
        chars: {
            patterns: [
                {
                    match: String.raw`(')(?:(\\[nrtfb0'"\\])|([^'\\]))(')`,
                    captures: {
                        0: { name: 'string.quoted.single.ms' },
                        1: { name: 'punctuation.definition.string.begin.ms' },
                        2: { name: 'constant.character.escape.ms' },
                        3: { name: 'constant.character.ms' },
                        4: { name: 'punctuation.definition.string.end.ms' }
                    }
                },
                { match: String.raw`'(?:\\.|[^'\\])*'?`, name: 'invalid.illegal.character.ms' }
            ]
        },

        numbers: {
            patterns: [
                { match: String.raw`(?<![\w.])\d+\.\d*(?:[eE][+-]?\d+)?\b|(?<![\w.])\.\d+\b`, name: 'constant.numeric.float.ms' },
                { match: String.raw`(?<![\w.])0[xX][0-9A-Fa-f]+\b`, name: 'constant.numeric.hex.ms' },
                { match: String.raw`(?<![\w.])\d+\b`, name: 'constant.numeric.integer.ms' }
            ]
        },

        constants: {
            patterns: [
                { match: String.raw`\b(true|false)\b`, name: 'constant.language.boolean.ms' },
                { match: String.raw`\b(null|none)\b`, name: 'constant.language.null.ms' }
            ]
        },

        'function-call': {
            patterns: [
                {
                    match: String.raw`\b(${BUILTINS})\s*(?=\()`,
                    captures: { 1: { name: 'support.function.builtin.ms' } }
                },
                {
                    // Конструктор структуры: Player(...)
                    match: String.raw`(?<![.\w])([A-Z][A-Za-z0-9_]*)\s*(?=\()`,
                    captures: { 1: { name: 'entity.name.type.struct.ms' } }
                },
                {
                    match: String.raw`(?:(\.)\s*)?\b(${IDENT})\s*(?=\()`,
                    captures: {
                        1: { name: 'punctuation.accessor.ms' },
                        2: { name: 'entity.name.function.call.ms' }
                    }
                }
            ]
        },

        // Типы в выражениях: array<i32> nums, строки вида `i32 x` уже разобраны в declarations
        'type-expression-standalone': {
            patterns: [
                { match: String.raw`\b(${PRIMITIVES})\b`, name: 'storage.type.primitive.ms' },
                { match: String.raw`\b(${CONTAINERS})\b(?=\s*<)`, name: 'storage.type.generic.ms' }
            ]
        },

        'member-access': {
            match: String.raw`(\.)\s*(${IDENT})`,
            captures: {
                1: { name: 'punctuation.accessor.ms' },
                2: { name: 'variable.other.property.ms' }
            }
        },

        operators: {
            patterns: [
                { match: String.raw`\|>`, name: 'keyword.operator.pipe.ms' },
                { match: '->', name: 'keyword.operator.arrow.ms' },
                { match: String.raw`\^=`, name: 'keyword.operator.assignment.inferred.ms' },
                { match: '==|!=|<=|>=', name: 'keyword.operator.comparison.ms' },
                { match: '=', name: 'keyword.operator.assignment.ms' },
                { match: String.raw`\*\*|[+\-*/%]`, name: 'keyword.operator.arithmetic.ms' },
                { match: '<|>', name: 'keyword.operator.comparison.ms' },
                { match: '!', name: 'keyword.operator.logical.ms' },
                // ?r — то же, что r.ok
                { match: String.raw`\?(?=\s*[\w(])`, name: 'keyword.operator.result-check.ms' }
            ]
        },

        punctuation: {
            patterns: [
                { match: ',', name: 'punctuation.separator.comma.ms' },
                { match: ':', name: 'punctuation.separator.colon.ms' },
                { match: ';', name: 'punctuation.terminator.ms' },
                { match: String.raw`[()\[\]{}]`, name: 'meta.brace.ms' },
                { match: IDENT, name: 'variable.other.ms' }
            ]
        }
    }
};

const out = path.join(__dirname, 'ms.tmLanguage.json');
fs.writeFileSync(out, JSON.stringify(grammar, null, 4) + '\n');
console.log('Written', out);
