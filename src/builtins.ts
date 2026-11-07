// Справочные данные о языке: встроенные функции (mono/mono.toml компилятора и
// функции, которые компилятор обрабатывает сам: len, push, ok, ...), ключевые
// слова, типы и метки. Используется в автодополнении, hover и подсказках сигнатур.

export interface BuiltinFunction {
    name: string;
    ret: string;
    params: { type: string; name: string }[];
    doc: string;
    pure?: boolean;
}

const p = (type: string, name: string) => ({ type, name });

export const BUILTIN_FUNCTIONS: BuiltinFunction[] = [
    // Ввод-вывод
    { name: 'echo', ret: 'void', params: [p('string', 'text')], doc: 'Выводит строку в stdout с переводом строки.' },
    { name: 'input', ret: 'string', params: [], doc: 'Читает строку из stdin.' },

    // Строки (mono/std/strings)
    { name: 'scat', ret: 'string', params: [p('string', 'a'), p('string', 'b')], doc: 'Склейка двух строк. Обычно проще `a + b`.', pure: true },
    { name: 'substr', ret: 'string', params: [p('string', 's'), p('i32', 'start'), p('i32', 'length')], doc: 'Подстрока `length` байт с позиции `start`. Выход за границы — паника.', pure: true },
    { name: 'strfind', ret: 'i32', params: [p('string', 's'), p('string', 'needle')], doc: 'Позиция первого вхождения `needle` в байтах или `-1`.', pure: true },
    { name: 'startsWith', ret: 'i1', params: [p('string', 's'), p('string', 'prefix')], doc: 'Начинается ли строка с `prefix`.', pure: true },
    { name: 'count', ret: 'i32', params: [p('string', 's'), p('string', 'needle')], doc: 'Число вхождений без перекрытий, как `str.count` в Python.', pure: true },
    { name: 'split', ret: 'array<string>', params: [p('string', 's'), p('string', 'delimiter')], doc: 'Делит строку по разделителю. Пустой разделитель — паника.', pure: true },
    { name: 'toInt', ret: 'i32', params: [p('string', 's')], doc: 'Разбирает целое число из строки.', pure: true },
    { name: 'toArray', ret: 'array<char>', params: [p('string', 's')], doc: 'Копия строки в виде массива байт.', pure: true },
    { name: 'joinChars', ret: 'string', params: [p('array<char>', 'chars')], doc: 'Собирает строку из массива `char`.', pure: true },
    { name: 'toString_int', ret: 'string', params: [p('i32', 'value')], doc: 'Преобразует `i32` в строку.', pure: true },
    { name: 'toString_long', ret: 'string', params: [p('i64', 'value')], doc: 'Преобразует `i64` в строку.', pure: true },
    { name: 'toString_float', ret: 'string', params: [p('float', 'value')], doc: 'Преобразует `float` в строку.', pure: true },
    { name: 'toString_f64', ret: 'string', params: [p('f64', 'value')], doc: 'Преобразует `f64` в строку.', pure: true },
    { name: 'toString_bool', ret: 'string', params: [p('i1', 'value')], doc: 'Преобразует `i1` в `"true"` / `"false"`.', pure: true },
    { name: 'toString_char', ret: 'string', params: [p('char', 'value')], doc: 'Строка из одного символа.', pure: true },
    { name: 'cstr', ret: 'string', params: [p('T', 'value')], doc: 'Число, `char` или строка в строку — так же, как в склейке `"x=" + n`.', pure: true },

    // Коллекции (обрабатываются компилятором)
    { name: 'len', ret: 'i32', params: [p('T', 'collection')], doc: 'Длина массива, `map` или строки (в байтах).', pure: true },
    { name: 'push', ret: 'void', params: [p('array<T>', 'items'), p('T', 'value')], doc: 'Добавляет элемент в конец массива.' },
    { name: 'pop', ret: 'T', params: [p('array<T>', 'items')], doc: 'Удаляет и возвращает последний элемент массива.' },
    { name: 'has', ret: 'i1', params: [p('map<K, V>', 'm'), p('K', 'key')], doc: 'Есть ли ключ в `map`.', pure: true },
    { name: 'del', ret: 'void', params: [p('map<K, V>', 'm'), p('K', 'key')], doc: 'Удаляет ключ из `map`.' },
    { name: 'copy', ret: 'T', params: [p('T', 'object')], doc: 'Поверхностная копия массива, `map` или структуры.', pure: true },
    { name: 'range', ret: 'range', params: [p('i32', 'from'), p('i32', 'to')], doc: 'Диапазон для `for`: `range(n)` — от `0` до `n - 1`, `range(a, b)` — от `a` до `b - 1`.\n\n```ms\nfor i in range(10)\n|   echo(cstr(i))\n```', pure: true },

    // result<T>
    { name: 'ok', ret: 'result<T>', params: [p('T', 'value')], doc: 'Успешный `result<T>`. Для `result<void>` — `ok()`.', pure: true },
    { name: 'err', ret: 'result<T>', params: [p('i32', 'code'), p('string', 'message')], doc: 'Ошибка в `result<T>`. Код можно опустить: `err("message")`.', pure: true },

    // Память
    { name: 'gc_collect', ret: 'void', params: [], doc: 'Принудительно запускает сборщик мусора.' }
];

/** Поля `result<T>`, доступные через точку. */
export const RESULT_MEMBERS: { name: string; type: (inner: string) => string; doc: string }[] = [
    { name: 'ok', type: () => 'i1', doc: '`true`, если значение есть. То же, что `?r`.' },
    { name: 'value', type: inner => inner, doc: 'Значение. Чтение из ошибки останавливает программу с исходным сообщением.' },
    { name: 'code', type: () => 'i32', doc: 'Код ошибки.' },
    { name: 'error', type: () => 'string', doc: 'Текст ошибки.' }
];

export const KEYWORDS: Record<string, string> = {
    if: 'Условие. Скобки не нужны, тело — блок `|` на следующей строке.\n\n```ms\nif x > 0\n|   echo("positive")\n```',
    else: 'Альтернативная ветка `if`. Можно `else if ...`.',
    while: 'Цикл с условием.\n\n```ms\nwhile i < 10\n|   i = i + 1\n```',
    for: 'Цикл по диапазону, массиву, ключам `map` или байтам строки.\n\n```ms\nfor i in range(10)\nfor x in items\nfor key in ports\nfor c in text\n```',
    in: 'Часть конструкции `for x in ...`.',
    return: 'Возврат значения из функции.',
    break: 'Выход из цикла.',
    continue: 'Переход к следующей итерации цикла.',
    and: 'Логическое И. Правая часть вычисляется, только если нужна.',
    or: 'Логическое ИЛИ. Правая часть вычисляется, только если нужна.',
    use: 'Импорт модулей.\n\n```ms\nuse\n|> http_server\n|> math -> sqrt\n|> math -> pow : power\n```',
    const: 'Константа с явным типом: `const i32 MAX = 10`.',
    final: 'Константа: `final k ^= 10`, `final i32 k = 10` или `final i32 k` с присваиванием позже (на каждом пути до чтения).',
    self: 'Текущий объект внутри метода структуры.',
    true: 'Логическая истина (`i1`).',
    false: 'Логическая ложь (`i1`).'
};

export const TYPES: Record<string, string> = {
    i1: 'Логическое значение: `true` / `false`.',
    i8: '8-битное целое со знаком.',
    i16: '16-битное целое со знаком.',
    i32: '32-битное целое со знаком.',
    i64: '64-битное целое со знаком.',
    float: '32-битное число с плавающей точкой.',
    f64: '64-битное число с плавающей точкой. Тип дробных литералов по умолчанию.',
    char: 'Один байт: `\'a\'`, `\'\\n\'`. `s[i]`, `for c in s` и `len(s)` работают в байтах.',
    string: 'Неизменяемая строка, байты в UTF-8.',
    void: 'Отсутствие значения (тип возврата функций).',
    auto: 'Выводимый тип.',
    array: 'Массив: `array<T>`. Передаётся по ссылке, `copy(a)` — копия.',
    map: 'Словарь: `map<K, V>`, ключи — целые или строки, порядок вставки сохраняется.',
    func: 'Функция как параметр: `func: keep(T: x) -> i1`. Передаётся по имени.',
    result: 'Успех или ошибка: `result<T>`. Поля `ok`, `value`, `code`, `error`, проверка `?r`.',
    struct: 'Пользовательская структура: `[struct]Name`.'
};

export const LABELS: Record<string, string> = {
    '@entry': 'Точка входа программы вместо `main`.',
    '@strict': 'Без неявных приведений и вывода типов, нельзя смешивать числовые типы в операциях.',
    '@pure': 'Без побочных эффектов: нельзя вызывать нечистые функции, читать глобальные переменные и менять переданные объекты. Проверяется компилятором.',
    '@private': 'Функция не видна при импорте модуля.',
    '@overwrite': 'Намеренно заменяет импортированную функцию с тем же именем.'
};

export const CASTABLE_TYPES = ['i1', 'i8', 'i16', 'i32', 'i64', 'float', 'f64', 'char'];

export function builtinSignature(f: BuiltinFunction): string {
    const vars = [...new Set((f.ret + ' ' + f.params.map(x => x.type).join(' ')).match(/\b[TKV]\b/g) ?? [])];
    const generic = vars.length ? `<${vars.join(', ')}>` : '';
    return `[${f.ret}]${f.name}${generic}(${f.params.map(x => `${x.type}: ${x.name}`).join(', ')})${f.pure ? ' @pure' : ''}`;
}
