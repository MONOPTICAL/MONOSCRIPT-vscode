// Разделы справочника (docs/language.*.md) с устойчивыми ключами. По ключу
// языковой сервер ставит ссылку «Справочник» в подсказку, а панель справочника
// находит нужный заголовок на любом языке.

export type GuideLanguage = 'ru' | 'en';

export const GUIDE_SECTIONS: Record<string, Record<GuideLanguage, string>> = {
    running: { ru: 'Запуск', en: 'Running programs' },
    structure: { ru: 'Структура программы', en: 'Program structure' },
    entry: { ru: 'Точка входа', en: 'Entry point' },
    globals: { ru: 'Глобальные переменные', en: 'Global variables' },
    types: { ru: 'Типы', en: 'Types' },
    variables: { ru: 'Переменные и константы', en: 'Variables and constants' },
    literals: { ru: 'Вывод типа литералов', en: 'Literal types' },
    final: { ru: 'final с присваиванием позже', en: 'final assigned later' },
    numbers: { ru: 'Числа и приведение типов', en: 'Numbers and casts' },
    booleans: { ru: 'Логические значения — это числа', en: 'Booleans are numbers' },
    strings: { ru: 'Строки и символы', en: 'Strings and characters' },
    chars: { ru: 'Символы char', en: 'Characters' },
    operators: { ru: 'Операторы', en: 'Operators' },
    control: { ru: 'Условия и циклы', en: 'Conditions and loops' },
    for: { ru: 'for', en: 'for' },
    functions: { ru: 'Функции', en: 'Functions' },
    arrays: { ru: 'Массивы', en: 'Arrays' },
    maps: { ru: 'Словари map', en: 'Maps' },
    structs: { ru: 'Структуры и методы', en: 'Structs and methods' },
    methods: { ru: 'Методы', en: 'Methods' },
    generics: { ru: 'Шаблоны функций', en: 'Generic functions' },
    funcParams: { ru: 'Функции как параметры', en: 'Passing functions' },
    result: { ru: 'Ошибки как значения: result', en: 'Errors as values: result' },
    labels: { ru: 'Метки', en: 'Labels' },
    strict: { ru: '@strict', en: '@strict' },
    pure: { ru: '@pure', en: '@pure' },
    modules: { ru: 'Модули', en: 'Modules' },
    builtins: { ru: 'Встроенные функции', en: 'Built-in functions' },
    runtimeErrors: { ru: 'Ошибки во время выполнения', en: 'Runtime errors' },
    native: { ru: 'Нативные функции на D', en: 'Native functions in D' },
    notImplemented: { ru: 'Что ещё не реализовано', en: 'Not implemented yet' }
};

/** Раздел справочника для слова языка: ключевого слова, типа, метки, встроенной функции. */
export function sectionForWord(word: string): string | undefined {
    const byWord: Record<string, string> = {
        if: 'control', else: 'control', while: 'control', for: 'for', in: 'for', break: 'control', continue: 'control',
        return: 'functions', and: 'operators', or: 'operators', use: 'modules',
        const: 'variables', final: 'final', self: 'methods', true: 'booleans', false: 'booleans',
        i1: 'booleans', i8: 'numbers', i16: 'numbers', i32: 'numbers', i64: 'numbers', float: 'numbers', f64: 'numbers',
        char: 'chars', string: 'strings', void: 'functions', auto: 'variables',
        array: 'arrays', map: 'maps', result: 'result', func: 'funcParams', struct: 'structs',
        '@entry': 'entry', '@strict': 'strict', '@pure': 'pure', '@private': 'modules', '@overwrite': 'modules',
        ok: 'result', err: 'result', range: 'for', push: 'arrays', pop: 'arrays', has: 'maps', del: 'maps', copy: 'arrays'
    };
    return byWord[word];
}

/** Ссылка-команда на раздел для markdown в подсказках. */
export function guideLink(section: string, label = '📖 Справочник'): string {
    return `[${label}](command:monoscript.openGuide?${encodeURIComponent(JSON.stringify([section]))})`;
}
