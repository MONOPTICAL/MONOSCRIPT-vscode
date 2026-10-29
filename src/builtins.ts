// Справочные данные о языке: встроенные функции (из mono/mono.toml компилятора),
// ключевые слова, типы и метки. Используется в автодополнении, hover и подсказках сигнатур.

export interface BuiltinFunction {
    name: string;
    ret: string;
    params: { type: string; name: string }[];
    doc: string;
}

export const BUILTIN_FUNCTIONS: BuiltinFunction[] = [
    { name: 'echo', ret: 'void', params: [{ type: 'string', name: 'text' }], doc: 'Выводит строку в stdout с переводом строки.' },
    { name: 'scat', ret: 'string', params: [{ type: 'string', name: 'a' }, { type: 'string', name: 'b' }], doc: 'Конкатенация двух строк.' },
    { name: 'sum', ret: 'i32', params: [{ type: 'i32', name: 'a' }, { type: 'i32', name: 'b' }], doc: 'Сумма двух чисел (тестовая функция std).' },
    { name: 'toString_int', ret: 'string', params: [{ type: 'i32', name: 'value' }], doc: 'Преобразует `i32` в строку.' },
    { name: 'toString_long', ret: 'string', params: [{ type: 'i64', name: 'value' }], doc: 'Преобразует `i64` в строку.' },
    { name: 'toString_float', ret: 'string', params: [{ type: 'float', name: 'value' }], doc: 'Преобразует `float` в строку.' },
    { name: 'toString_bool', ret: 'string', params: [{ type: 'i1', name: 'value' }], doc: 'Преобразует `i1` в `"true"` / `"false"`.' },
    { name: 'range', ret: 'array<i32>', params: [{ type: 'array<T>', name: 'source' }], doc: 'Итерация по индексам массива: `for i in range(arr)`.' },
    { name: 'test', ret: 'void', params: [], doc: 'Печатает `Hello from D!` — проверка связи с std.' }
];

export const KEYWORDS: Record<string, string> = {
    if: 'Условие. Тело — блок `|` на следующей строке.\n\n```ms\nif (x > 0)\n|   echo("positive")\n```',
    else: 'Альтернативная ветка `if`. Можно `else if (...)`.',
    while: 'Цикл с условием.\n\n```ms\nwhile (i < 10)\n|   i = i + 1\n```',
    for: 'Цикл по диапазону.\n\n```ms\nfor i in range(arr)\n|   echo(toString_int(arr[i]))\n```',
    in: 'Часть конструкции `for x in ...`.',
    return: 'Возврат значения из функции.',
    break: 'Выход из цикла.',
    continue: 'Переход к следующей итерации цикла.',
    and: 'Логическое И.',
    or: 'Логическое ИЛИ.',
    not: 'Логическое НЕ (то же, что `!`).',
    is: 'Проверка типа.',
    use: 'Импорт модулей.\n\n```ms\nuse\n|> http_server\n|> math -> sqrt : sqrtAlias\n```',
    const: 'Константа с явным типом: `const i32 MAX = 10`.',
    final: 'Константа с выведенным типом: `final k ^= 10`.',
    public: 'Модификатор доступа.',
    private: 'Модификатор доступа.',
    this: 'Ссылка на текущий экземпляр структуры.',
    defined: 'Проверяет, определено ли значение.',
    true: 'Логическая истина (`i1`).',
    false: 'Логическая ложь (`i1`).',
    null: 'Отсутствие значения.',
    none: 'Пустое значение.'
};

export const TYPES: Record<string, string> = {
    i1: 'Логическое значение / 1-битное целое.',
    i8: '8-битное целое.',
    i16: '16-битное целое.',
    i32: '32-битное целое.',
    i64: '64-битное целое.',
    float: 'Число с плавающей точкой.',
    string: 'Строка.',
    void: 'Отсутствие значения (тип возврата функций).',
    auto: 'Выводимый тип.',
    array: 'Массив: `array<T>`.',
    map: 'Словарь: `map<K, V>`.',
    func: 'Функциональный тип для параметров: `func: f (i32: a) -> i32`.',
    struct: 'Пользовательская структура: `[struct]Name`.'
};

export const LABELS: Record<string, string> = {
    '@entry': 'Точка входа программы (по умолчанию — `main`).',
    '@strict': 'Строгая проверка типов: запрещает неявные преобразования.',
    '@pure': 'Чистая функция: не может вызывать нечистые функции и иметь побочные эффекты.',
    '@public': 'Публичная функция модуля.',
    '@private': 'Приватная функция модуля.',
    '@test': 'Тестовая функция.',
    '@decl': 'Только объявление, без тела (реализация в другом месте / нативная).'
};

export const CASTABLE_TYPES = ['i1', 'i8', 'i16', 'i32', 'i64', 'float'];

export function builtinSignature(f: BuiltinFunction): string {
    return `[${f.ret}]${f.name}(${f.params.map(p => `${p.type}: ${p.name}`).join(', ')})`;
}
