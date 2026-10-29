// Генератор syntaxes/ms.tmLanguage.json.
// Регулярки здесь пишутся обычными JS-строками (String.raw), поэтому не надо
// вручную экранировать каждый слеш в JSON. Запуск: npm run grammar
const fs = require('fs');
const path = require('path');

const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
// Тип: i32, Player, array<i32>, map<string, array<i32>>, func<i32, i32> (до трёх уровней вложенности)
const TYPE = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:<(?:[\w\s,]|<(?:[\w\s,]|<[\w\s,]*>)*>)*>)?`;
const PRIMITIVES = 'i1|i8|i16|i32|i64|float|string|void|auto|bool';
const CONTAINERS = 'array|map|func';
const KEYWORDS_NOT_TYPES = 'if|else|while|for|in|return|break|continue|and|or|not|is|use|const|final|public|private|this|defined|true|false|null|none|struct';
const BUILTINS = 'echo|scat|sum|toString_int|toString_long|toString_float|toString_bool|range|test';

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
        // [void]Player::method(...)
        'function-declaration': {
            name: 'meta.function.ms',
            begin: String.raw`(\[)\s*(${TYPE})\s*(\])\s*(?:(${IDENT})\s*(::)\s*)?(${IDENT})\s*(\()`,
            beginCaptures: {
                1: { name: 'punctuation.definition.type.begin.ms' },
                2: { patterns: [{ include: '#type-expression' }] },
                3: { name: 'punctuation.definition.type.end.ms' },
                4: { name: 'entity.name.type.struct.ms' },
                5: { name: 'punctuation.accessor.ms' },
                6: { name: 'entity.name.function.ms', patterns: [{ include: '#magic-names' }] },
                7: { name: 'punctuation.definition.parameters.begin.ms' }
            },
            end: String.raw`\)`,
            endCaptures: { 0: { name: 'punctuation.definition.parameters.end.ms' } },
            patterns: [{ include: '#parameters' }]
        },
        'magic-names': {
            match: String.raw`\b__\w+__\b`,
            name: 'support.function.magic.ms'
        },

        parameters: {
            patterns: [
                { include: '#comments' },
                {
                    // func: cb (i32: a) -> i32
                    match: String.raw`\b(func)\s*(:)\s*(${IDENT})?`,
                    captures: {
                        1: { name: 'storage.type.ms' },
                        2: { name: 'punctuation.separator.parameter.ms' },
                        3: { name: 'variable.parameter.ms' }
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
                { include: '#lambda' },
                { include: '#for-loop' },
                { include: '#declarations' },
                { include: '#keywords' },
                { include: '#cast' },
                { include: '#expressions' }
            ]
        },

        // @entry @strict @pure @test @decl @public @private
        labels: {
            patterns: [
                {
                    match: String.raw`(@)(strict|pure|entry|public|private|test|decl)\b`,
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

        // [i32](i32: x) -> x * x
        // [array<i32>](array<i32>: a) :
        lambda: {
            name: 'meta.lambda.ms',
            begin: String.raw`(?<![\w\])])(\[)\s*(${TYPE})\s*(\])\s*(\()`,
            beginCaptures: {
                1: { name: 'punctuation.definition.type.begin.ms' },
                2: { patterns: [{ include: '#type-expression' }] },
                3: { name: 'punctuation.definition.type.end.ms' },
                4: { name: 'punctuation.definition.parameters.begin.ms' }
            },
            end: String.raw`(\))\s*(?:(->)|(:)(?=\s*(?:$|//)))?`,
            endCaptures: {
                1: { name: 'punctuation.definition.parameters.end.ms' },
                2: { name: 'keyword.operator.arrow.lambda.ms' },
                3: { name: 'punctuation.section.lambda.begin.ms' }
            },
            patterns: [{ include: '#parameters' }]
        },

        // for i in range(x)
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
                    // const i32 x = 5 / string name = "..." / map<string,string> info / Player p = ...
                    match: String.raw`(?:\b(const)\s+)?(?<![.\w])(?!(?:${KEYWORDS_NOT_TYPES})\b)(${TYPE})\s+(?!(?:${KEYWORDS_NOT_TYPES})\b)(${IDENT})\s*(?=$|//|=(?!=))`,
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
                { match: String.raw`\b(and|or|not|is)\b`, name: 'keyword.operator.logical.ms' },
                { match: String.raw`\b(defined)\b`, name: 'keyword.operator.defined.ms' },
                { match: String.raw`\b(const|final|public|private)\b`, name: 'storage.modifier.ms' },
                { match: String.raw`\b(this)\b`, name: 'variable.language.this.ms' }
            ]
        },

        // x -> i64
        cast: {
            match: String.raw`(->)\s*\b(i1|i8|i16|i32|i64|float)\b`,
            captures: {
                1: { name: 'keyword.operator.cast.ms' },
                2: { name: 'storage.type.primitive.ms' }
            }
        },

        expressions: {
            patterns: [
                { include: '#comments' },
                { include: '#strings' },
                { include: '#numbers' },
                { include: '#constants' },
                { include: '#lambda' },
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
                { match: String.raw`\\(?:[nrt0"\\]|x[0-9A-Fa-f]{2})`, name: 'constant.character.escape.ms' },
                { match: String.raw`\\.`, name: 'invalid.illegal.escape.ms' }
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
                        2: { name: 'entity.name.function.call.ms', patterns: [{ include: '#magic-names' }] }
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
                { match: String.raw`\?(?=\s*[\w(])`, name: 'keyword.operator.null-check.ms' }
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
