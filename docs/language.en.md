# MONOSCRIPT language reference

[Русская версия](language.ru.md)

MONOSCRIPT is a statically typed language with type inference. It compiles through LLVM. You can run a program right away with the JIT or build a native executable.

This reference describes the language on the `dev` branch of the [compiler](https://github.com/MONOPTICAL/MONOSCRIPT/tree/dev). The examples come from its test suite (`tests/frontend`). A `// →` comment shows what the program prints. `// error:` shows the start of the compiler message.

## Contents

1. [Running programs](#running-programs)
2. [Program structure](#program-structure)
3. [Types](#types)
4. [Variables and constants](#variables-and-constants)
5. [Numbers and casts](#numbers-and-casts)
6. [Strings and characters](#strings-and-characters)
7. [Operators](#operators)
8. [Conditions and loops](#conditions-and-loops)
9. [Functions](#functions)
10. [Arrays](#arrays)
11. [Maps](#maps)
12. [Structs and methods](#structs-and-methods)
13. [Generic functions](#generic-functions)
14. [Passing functions](#passing-functions)
15. [Errors as values: result](#errors-as-values-result)
16. [Labels: @strict, @pure and others](#labels)
17. [Modules](#modules)
18. [Built-in functions](#built-in-functions)
19. [Runtime errors](#runtime-errors)
20. [Native functions in D](#native-functions-in-d)
21. [Not implemented yet](#not-implemented-yet)

## Running programs

| Command | What it does |
|---|---|
| `ms file.ms` | Check only: lexer, parser, semantic analysis |
| `ms run file.ms` | Run through the JIT. The exit code is what `main` returns |
| `ms --compile out file.ms` | Build the executable `out` |
| `ms run file.ms --timings` | Show how long each compiler stage took |
| `ms run file.ms --offOptimization` | Run without LLVM optimization |
| `ms --tokens file.ms`, `--ast`, `--semantic` | Show tokens, the AST or the semantic analysis |
| `ms --run_tests [FILTER]` | Run the compiler test suite |

In the extension, these actions are the commands `MONOSCRIPT: Run File` (`Ctrl+F5`), `Compile to Executable`, `Check File`, `Show Tokens`, `Show AST` and `Show Semantic Analysis`.

## Program structure

### Blocks

Blocks use a vertical bar `|` instead of braces. The body of a function, an `if` branch or a loop starts on the next line, one `|` deeper:

```ms
[i32]main()
|   for i in range(10)
|   |   if i % 2 == 0
|   |   |   echo("even: " + i)
|   return 0
```

An empty line inside a block can be a single `|`. The extension inserts `|` when you press `Enter` and removes a whole level with `Backspace`.

### Comments

```ms
// to the end of the line
/* block comment,
   can span lines */
```

### Entry point

A program starts at `main`. It can return `i32` (the exit code) or `void`:

```ms
[void]main()
|   echo("x")                // → x
```

To start from another function, mark it with `@entry`. The entry point cannot take parameters yet:

```ms
[i32]foo() @entry
|   echo("in foo")
|   return 3                 // exit code 3
```

Without `main` or `@entry`, the program fails to start with `entry function not found`.

### Global variables

Variables can be declared outside functions. They are initialized at startup, before `main`, and an initializer can call functions:

```ms
[i32]f()
|   return 7

i32 g = f()

[void]inc()
|   g = g + 1

[i32]main()
|   inc()
|   echo(cstr(g))            // → 8
|   return 0
```

## Types

| Type | Description |
|---|---|
| `i1` | Boolean: `true` / `false` (the same as `1` / `0`) |
| `i8`, `i16`, `i32`, `i64` | Signed integers |
| `float` | 32-bit floating point |
| `f64` | 64-bit floating point, the default for fractional literals |
| `char` | One byte: `'a'`, `'\n'` |
| `string` | Immutable string, bytes in UTF-8 |
| `void` | No value |
| `array<T>` | Array |
| `map<K, V>` | Map that keeps insertion order |
| `result<T>` | A value or an error |
| `func` | Function parameter: `func: f(i32: x) -> i1` |
| Struct name | User-defined type: `User`, `Finding` |

**Numbers are copied, objects are not.** Arrays, maps and structs live on a garbage-collected heap and are passed by reference. An object reference is never `null`. Use `copy(x)` for a separate shallow copy.

## Variables and constants

| Form | Meaning |
|---|---|
| `i32 count = 0` | Explicit type |
| `name ^= "value"` | Type inferred from the value |
| `i32 x` | No value: numbers get `0`, a string gets `""`, `i1` gets `false` |
| `const i32 limit = 10` | Constant with an explicit type |
| `final limit ^= 10` | Constant with an inferred type |
| `final i32 limit = 10` | The same, with an explicit type |
| `final i32 limit` | Constant assigned later |

Only scalars can be declared without a value. Arrays, maps, structs and results need one:

```ms
i32 x                        // OK, x == 0
array<i32> a                 // error: ... must have a value
array<i32> b = null          // error
```

### Literal types

An integer literal gets the narrowest type that fits: `0` and `1` are `i1`, up to `127` is `i8`, up to `32767` is `i16`, then `i32` and `i64`. A variable inferred from a small number is narrow too:

```ms
x ^= 1
x = 2                        // error: ... does not fit
y ^= -5                      // i8
y = 100                      // OK
```

When you need a wider variable, give the type: `i32 count = 0`.

A fractional literal is always `f64`:

```ms
v ^= 0.1
echo(cstr(v + 0.2))          // → 0.30000000000000004
```

An empty `[]` or `{}` cannot be inferred: `x ^= []` is an error. Write `array<i32> x = []`.

### `final` assigned later

The value must be assigned exactly once on every path before it is first read:

```ms
i32 n = 0
final i32 x
if n > 0
|   x = 1
else
|   x = 2
echo(cstr(x))                // → 2
```

Compiler errors:
- assigning twice: `Final variable 'x' is already assigned`;
- reading too early: `Final variable 'x' is used before it is assigned`;
- assigning in a loop: `cannot be assigned in a loop`.

### Constant objects

`const` forbids both rebinding and changing the contents:

```ms
const array<i32> a = [1]
a[0] = 2                     // error: constant
```

### Scope

A variable declared inside an `if`, `while` or `for` block is visible only in that block. You can declare the name again after it:

```ms
i32 n = 1
if n == 1
|   i32 y = 2
i32 y = 9
echo(cstr(y))                // → 9
```

## Numbers and casts

### Widening and narrowing

Widening (`i8` to `i32` to `i64`, integer to floating point, `float` to `f64`) happens automatically. Anything that can lose data needs an explicit `->` cast:

```ms
i32 big = 300
i64 wide = big               // OK
i8 small = big->i8           // OK: you asked for it
i8 oops = big                // error: use explicit cast ->i8

f64 a = 0.5
float b = a                  // error: use explicit cast
```

Literals are checked by value: `i8 y = -128` is fine, while `i8 y = -129` fails with `does not fit`.

A cast goes right after the value and can be used inside expressions: `a + n->i64`, `(c->i32 + 1)->char`.

### Booleans are numbers

`true` is `1` and `false` is `0`. Arithmetic on `i1` gives ordinary numbers:

```ms
x ^= 1
y ^= 1
echo("=" + (x + y))          // → =2
```

A cast to `i1` tests for zero: `2->i1` and `-1->i1` are `true`, and `0->i1` is `false`. `while 1` is a valid loop.

### Overflow and division

- Integer `+`, `-` and `*` wrap around on overflow: `2147483647 + 1` in `i32` is `-2147483648`.
- Dividing by zero stops the program: `division by zero at line N`.
- Dividing the smallest value of a type by `-1` also stops it: `integer overflow`.
- The remainder of a division by `-1` is always `0`. The sign of a remainder follows the dividend: `-5 % 3 == -2`.
- Floating-point division by zero gives `inf`, and `0.0 / 0.0` gives `nan`.

### Floating point to integer

If the value does not fit the target type, the program stops:

```ms
float a = 128.0
i8 x = a->i8                 // Runtime Error: float value out of range for i8 at line 4
```

Floating-point numbers print in their shortest form: `1.5`, `3.0`, `0.1`, `1.7e+09`.

## Strings and characters

### Strings

`string` is an immutable sequence of UTF-8 bytes. The length is stored with the string, so `len(s)` and `s[i]` take constant time. Escapes are `\n`, `\t`, `\r`, `\f`, `\b`, `\'`, `\"` and `\\`. The same escapes work in `char` literals, plus `'\0'`.

A string cannot contain a NUL byte: the literal `"a\0b"` fails with `Strings cannot contain a NUL byte`, and `cstr('\0')` stops the program.

```ms
string s = "abc"
echo(cstr(s[0]))             // → a
echo(cstr(len(s)))           // → 3
s[0] = 'x'                   // error: Strings are immutable
```

- `s[i]` returns a `char`. The index can be any integer type, and an index out of bounds stops the program.
- Strings compare with `==`, `!=`, `<`, `>`, `<=` and `>=`: `"abc" < "abd"`.
- `for c in s` walks the bytes, and the loop variable is a `char`.

```ms
[string]rev(string: s)
|   string out = ""
|   i32 i = len(s) - 1
|   while i >= 0
|   |   out = out + s[i]
|   |   i = i - 1
|   return out
```

### Joining

`+` joins a string with another string, a number, a `char` or an `i1`:

```ms
i32 seen = 4
i1 done = true
echo("seen " + seen + ", done " + done)   // → seen 4, done true
```

You cannot join a string with an array, map, struct or result: `Cannot join string with array<i32>`.

`cstr(x)` turns a number, `char` or string into a string, the same way joining does.

### Characters

`char` is one byte, so `'я'` does not fit: `A char is one byte`. There is no arithmetic on `char`. To shift a character, cast it to a number and back:

```ms
char c = 'a'
char d = (c->i32 + 1)->char  // 'b'
i32 digit = '3'->i32 - '0'->i32   // 3
char up = (c->i32 - 32)->char     // 'A'
```

Restrictions on `char`:
- A `char` compares with a `char` (`c < 'z'`), but not with a string: `c == "a"` is an error.
- `char c = 65` is an error. Write `65->char`.
- `i32 n = c` is an error. Write `c->i32`.

## Operators

| Operator | Meaning |
|---|---|
| `=` | Assignment |
| `^=` | Declaration with an inferred type |
| `+ - * / %` | Arithmetic, `+` also joins strings |
| `== != < > <= >=` | Comparison of numbers, chars and strings |
| `and`, `or` | Logic. The right side is evaluated only when needed |
| `!` | Logical NOT |
| `->` | Cast |
| `?r` | Whether a `result` has a value (the same as `r.ok`) |

Precedence, from highest to lowest:
1. `->` and the unary `!`, `-`, `?`;
2. `*` `/` `%`;
3. `+` `-`;
4. comparisons;
5. `and`;
6. `or`.

Operators on the same level are left-associative: `10 - 3 - 2 == 5`.

Arrays, maps, structs and results cannot be compared.

## Conditions and loops

Conditions need no parentheses:

```ms
if x < lo
|   return lo
else if x > hi
|   return hi
else
|   return x
```

A condition must be a number or an `i1`. `if c` with a `char c` fails with `If condition must be ...`.

### One-line branches

A single simple statement can follow `:` on the same line. `else` and `else if` still start on their own lines, and one-line branches mix with indented ones:

```ms
[i32]sign(i32: n)
|   if n < 0: return -1
|   else if n == 0: return 0
|   else: return 1

[void]show(i32: n)
|   if n > 100
|   |   echo("big")
|   |   echo("very big")
|   else: echo("small")
```

- A branch holds exactly one statement: an assignment, a call, `return`, `break`, `continue`, `const` or `final`. A nested `if` or loop fails with `Inline if/else requires a single simple statement`; write those as blocks.
- `if x:` with nothing after the colon fails with `Expected a statement after ':'`.
- Only `if` / `else` have the `:` form. `while x: ...` does not parse.

### while

```ms
i32 i = 0
while i < 10
|   i = i + 1
|   if i % 2 == 0
|   |   continue
|   if i > 7
|   |   break
```

### for

| Form | Loop variable |
|---|---|
| `for i in range(n)` | from `0` to `n - 1` |
| `for i in range(a, b)` | from `a` to `b - 1` |
| `for x in array` | each element |
| `for key in map` | each key, in insertion order |
| `for c in string` | each byte, as a `char` |

```ms
array<i32> a = [10, 20, 30]
for i in range(1, len(a))
|   echo(cstr(a[i]))         // → 20, 30
```

The loop variable is a copy of the element, so writing to it does not change the array. You cannot add or remove elements of the collection you are walking. The program stops with `array changed during iteration` or `map changed during iteration`. You can change the values of existing map keys.

`range` works only in a `for` header, and its arguments are integers.

## Functions

The return type goes in square brackets, and each parameter type goes before its name:

```ms
[i64]fibonacci(i64: n) @strict @pure
|   if n < 2
|   |   return n
|   return fibonacci(n - 1) + fibonacci(n - 2)
```

- You can call a function before it is declared. Mutual recursion works too.
- A function that does not return `void` must return a value on every path, otherwise you get `Function f must return`.
- In a `void` function, a bare `return` exits early.
- Arguments convert to the parameter types by the usual rules: widening is automatic, narrowing is an error.
- Two functions with the same name are an error. Your own function named like a built-in (`copy`, `len`, `push`...) replaces the built-in.

```ms
[i32]copy(i32: x)
|   return 42

echo(cstr(copy(1)))          // → 42
```

## Arrays

```ms
array<i32> scores = [10, 20, 30]
scores[0] = 5
push(scores, 40)             // append
i32 last = pop(scores)       // remove the last element
echo(cstr(len(scores)))      // → 3

array<array<i32>> grid = [[1, 2], [3, 4]]
grid[1][1] = 9
```

- The index can be any integer. A negative index or an index out of bounds stops the program: `index 3 out of bounds (len 3)`.
- `pop` on an empty array stops the program: `pop from an empty array`.
- Assignment does not copy an array:

```ms
array<i32> a = [1]
array<i32> b = a
b[0] = 5
echo(cstr(a[0]))             // → 5
array<i32> c = copy(a)       // separate copy
```

Literal elements are checked like assignments: `array<i8> a = [300]` is an error.

## Maps

```ms
map<string, i32> ports = {"ssh": 22}
ports["http"] = 80           // add or replace
if has(ports, "ssh")
|   del(ports, "ssh")
for name in ports            // keys in insertion order
|   echo(name + " = " + ports[name])
echo(cstr(len(ports)))
```

- Keys are integers, `char` or strings. `float` values and objects cannot be keys.
- String keys compare by content.
- Reading or deleting a missing key stops the program: `key not found`.
- A repeated key in a literal is the compile error `Duplicate key`.
- Values can be anything: `map<string, array<i32>>`, `map<string, map<string, i32>>`.
- A nested write creates only the last key. `m["x"][0] = 1` with no `"x"` is a runtime error.

An example from the compiler tests that counts tags:

```ms
map<string, i32> tagCount = {}
array<string> tags = ["remote", "admin", "web", "admin"]
for t in tags
|   if has(tagCount, t)
|   |   tagCount[t] = tagCount[t] + 1
|   else
|   |   tagCount[t] = 1
for t in tagCount
|   echo("tag " + t + ": " + tagCount[t])
```

## Structs and methods

```ms
[struct]User
|   i32 age = 18
|   string name = "anon"
|
|   [void]birthday()
|   |   self.age = self.age + 1
|
|   [string]describe() @pure
|   |   return self.name + " is " + self.age

[i32]main()
|   User user = User()
|   user.birthday()
|   echo(user.describe())    // → anon is 19
|   return 0
```

### Fields

- Every field needs a default value: `i32 age = 0`, `array<i32> v = []`. Without one you get `must have a default value`.
- A field type can be inferred: `f ^= 1`.
- The default is evaluated again for each new object, so each object gets its own array or map:

```ms
i32 next = 0

[i32]nextId()
|   next = next + 1
|   return next

[struct]P
|   i32 id = nextId()

P a = P()                    // a.id == 1
P b = P()                    // b.id == 2
```

- `Name()` creates an object. Constructors with arguments do not exist yet.
- A struct cannot contain itself, directly or indirectly: `N next = N()` inside `N` is an error.
- Structs can nest and can be stored in arrays and maps.

### Methods

- Methods are declared inside the struct block, and inside a method the object is `self`.
- Fields and other methods are reached only through `self.`: writing `return a` instead of `return self.a` is an error.
- `self` cannot be reassigned.
- Method calls chain with fields and indexes: `o.inner.get()`, `o.me().v = 9`, `a[0].list()[1]`.
- A `@pure` method cannot change `self`.
- A constant (`const P p`) can call only `@pure` methods.
- Generic methods are not supported yet.

An example of a function that creates and returns a struct:

```ms
[struct]Finding
|   string host = "?"
|   i32 port = 0
|   i32 score = 0
|   array<string> tags = []

[Finding]scan(string: host, i32: port)
|   Finding f = Finding()
|   f.host = host
|   f.port = port
|   if port == 22 or port == 3389
|   |   f.score = 90
|   |   f.tags = ["remote", "admin"]
|   return f
```

## Generic functions

Type parameters go in `<...>` after the name. They are inferred from the arguments and cannot be given explicitly, so `id<i32>(1)` is an error:

```ms
[T]first<T>(array<T>: items)
|   return items[0]

[array<T>]pair<T>(T: a, T: b)
|   return [a, b]

[V]get<K, V>(map<K, V>: m, K: k)
|   return m[k]

[i32]main()
|   echo(first(["a", "b"]))          // T = string → a
|   echo(cstr(first([1, 2])))        // T = i32 → 1
|   map<string, i32> m = {"a": 7}
|   echo(cstr(get(m, "a")))          // → 7
|   return 0
```

- The compiler makes and checks a separate copy for each set of types. A generic function that is never called is not checked.
- An integer literal with no other context becomes `i32`: `id(1)` gives `T = i32`. Next to an argument of a real type, the literal adapts to it: `big(w, 1)` with `i64 w` gives `T = i64`.
- `T` can be a struct, and then its fields and methods are available in the body: `x.get()`.
- Compiler errors:
  - `Cannot infer type T of f from its arguments`, for example for `f([])`;
  - `T is both i32 and string` when the arguments disagree;
  - a generic function cannot be the `@entry` point.

## Passing functions

A function can be passed by name to a `func` parameter:

```ms
[array<T>]filter<T>(array<T>: items, func: keep(T: x) -> i1)
|   array<T> out = []
|   for x in items
|   |   if keep(x)
|   |   |   push(out, x)
|   return out

[i1]isEven(i32: x)
|   return x % 2 == 0

[i32]main()
|   array<i32> even = filter([1, 2, 3, 4], isEven)
|   return len(even)                 // 2
```

Sorting by a field, from the compiler tests:

```ms
[void]sortBy<T>(array<T>: items, func: less(T: a, T: b) -> i1)
|   for i in range(1, len(items))
|   |   i32 j = i
|   |   while j > 0 and less(items[j], items[j - 1])
|   |   |   T tmp = items[j]
|   |   |   items[j] = items[j - 1]
|   |   |   items[j - 1] = tmp
|   |   |   j = j - 1

[i1]byScore(Finding: a, Finding: b)
|   return a.score < b.score
```

- You can pass built-ins too, like `via(toString_int, 7)`, and functions without parameters: `func: f() -> i32`.
- A function can only be passed as an argument. You cannot store it in a variable (`g ^= id`), return it, put it in an array or use it in arithmetic.
- The signature of the passed function must match the parameter exactly.
- A `@pure` function accepts only `@pure` functions.

## Errors as values: result

A function that can fail returns `result<T>`. The caller checks it, and the program keeps running:

```ms
[result<i32>]parseDigit(string: s)
|   if len(s) != 1
|   |   return err(1, "expected one digit, got " + s)
|   char c = s[0]
|   if c < '0' or c > '9'
|   |   return err(2, "not a digit: " + s)
|   return ok(c->i32 - '0'->i32)

[i32]main()
|   result<i32> r = parseDigit("x")
|   if ?r                            // same as r.ok
|   |   echo("digit " + r.value)
|   else
|   |   echo("error " + r.code + ": " + r.error)
|   return 0
```

| Field | Type | Meaning |
|---|---|---|
| `r.ok` | `i1` | Whether there is a value |
| `r.value` | `T` | The value. Reading it from an error is a panic |
| `r.code` | `i32` | Error code |
| `r.error` | `string` | Error message |

### The `?` operator: pass an error up

Postfix `r?` unwraps a successful result. If `r` holds an error, the function returns it right away with the same code and message:

```ms
[result<i32>]sumNumbers(string: a, string: b)
|   i32 x = toInt(a)?
|   i32 y = toInt(b)?
|   return ok(x + y)

[i32]main()
|   r ^= sumNumbers("2", "x")
|   if !r.ok: echo(cstr(r.code) + " " + r.error)   // → 1 expected a decimal integer
|   return 0
```

- Without a handler, `?` works only in a function that itself returns `result<U>`. `U` can differ from the unwrapped type. In `main` without a handler it fails with `Postfix '?' requires a function returning result<T>`; [`attempt` and `? else`](#local-handling-attempt-and--else) handle the error in place.
- Prefix `?r` is still a success check (`i1`); postfix `r?` unwraps.
- The operand is evaluated once. `?` binds before arithmetic: `toInt(s)? * 2`.
- Cast after unwrapping with `toInt(s)?->i64`. A nested result unwraps with two marks: `r??`.
- For `result<void>`, use it as a statement: `save(path)?`.

The same by hand, without `?`:

```ms
[result<i32>]twoDigits(string: a, string: b)
|   result<i32> x = parseDigit(a)
|   if !x.ok: return err(x.code, x.error)
|   result<i32> y = parseDigit(b)
|   if !y.ok: return y
|   return ok(x.value * 10 + y.value)
```

Rules:
- **A result must be used.** Calling `act()` without reading its result is the error `The result is not used`. To ignore one on purpose, write `_ ^= act()`.
- **A result can have no value:** use `result<void>` and `return ok()`. The error code is optional: `err("disk full")`.
- **`ok()` and `err()` take their type from where they go,** so `r ^= ok(1)` fails with `Cannot infer the type of ok()`.
- **The value in `ok()` converts to `T` by the usual rules:** `ok(x)` with `i32 x` works for `result<i64>`.
- **The fields of a result are read-only.** A result cannot be compared or joined with a string.
- **Results can be stored, passed and returned:** they go into arrays and maps (`array<result<i32>>`, `map<string, result<i32>>`), into function arguments and out of methods.
- **A forgotten check is a panic with the original reason:** `result has no value: not a digit: z at line 13`. `panic info` catches it; otherwise the program exits with code `101`.

### Local handling: `attempt` and `? else`

An error can be handled right where it happens, including in an ordinary function such as `[i32]main()`:

```ms
[i32]main()
|   port ^= toInt("invalid")? else 8080
|   n ^= toInt("42")? else: echo(error.error); return error.code
|
|   attempt
|   |   value ^= toInt("7")?
|   |   array<i32> rows = [value]
|   |   echo("" + rows[9])
|   else error
|   |   echo(error.error)
|   panic info
|   |   echo(info.message + " at line " + info.line)
|   return 0
```

**`r? else value`** is a replacement on error. The result is evaluated once, the replacement only on error. It must fit the unwrapped type (`toInt(s)? else "bad"` fails with `Fallback: Type mismatch`). Replacements chain: `a()? else b()? else 3`. Inside a larger expression, put the replacement in parentheses: `"" + (r? else 'B')`. `result<void>` has no replacement value. It also works for globals: `i32 port = toInt(s)? else 8080`.

**`r? else: statements`** is a one-line action on error. Statements are separated by `;` and the last one must be `return`, `break` or `continue`. Inside it, `error` is available (`result<void>`, read-only `.ok`, `.code`, `.error`); outside it is not. The action takes the rest of the line, so put it at the end of a statement:

```ms
for s in inputs
|   n ^= toInt(s)? else: echo("skip"); continue
|   echo("" + n)
```

**`attempt`** is a block with handlers at the same level:
- `else error` takes errors from bare `?` inside the block in the **same function**. Called functions still return their errors through their own `result`.
- `panic info` takes panics, including from deeper calls: integer division by zero and overflow, invalid casts, array or string bounds, `pop` from an empty array, a missing map key, map mutation during iteration, reading `.value` from an error, and failing standard-library string functions. `info` is a read-only `panic_info` snapshot with `.message` and `.line` (`0` if unknown).

Rules:
- At least one handler is required, and each kind at most once (`Duplicate else handler`).
- Body variables are not visible in the handlers or after the `attempt`.
- When a handler finishes, execution continues after the whole `attempt`. Handlers may `return`, `break` or `continue`.
- A failure inside a handler goes to an outer `attempt`, never to a sibling handler of the same block.
- `? else` handles only `result` errors: a panic while evaluating the operand or the replacement goes to the surrounding `panic info`.
- Side effects are not rolled back. Out-of-memory and native crashes still end the program. There is no `defer` or automatic resource cleanup yet.
- A `final` variable assigned in an `attempt` body counts as assigned after it only if every handler leaves the function.

## Labels

Labels go after the parameter list and can be combined: `[i64]f(i64: n) @strict @pure`.

| Label | Effect |
|---|---|
| `@entry` | Entry point instead of `main` |
| `@strict` | Strict typing inside this function |
| `@pure` | No side effects, checked by the compiler |
| `@private` | Hidden when the module is imported |
| `@overwrite` | Replaces an imported function with the same name on purpose |

### @strict

Inside a `@strict` function:
- there is no implicit widening: `float f = a` with `i32 a` is an error;
- number types cannot be mixed in one operation: `a + n` with `i64 a` and `i32 n` fails with `Implicit cast is not allowed in @strict mode: i64 and i32`;
- a comparison result cannot be assigned to a number without a cast.

Literals still adapt to the type when the value fits:

```ms
[i64]f(i64: a, i32: n) @strict
|   i64 x = a + 1                // OK: literal
|   i64 z = a + n->i64           // OK: explicit cast
|   return x + z

[f64]g(f64: d) @strict
|   return d + 0.5
```

### @pure

A pure function changes nothing outside itself. The compiler checks that it:
- does not call impure functions such as `echo`;
- does not read or write global variables;
- does not change the objects passed to it, including through a new reference to them (`P q = x`);
- does not return an object passed to it or put one into another object or a `result`: `return a` with `array<i32>: a` is an error;
- does not copy an object when the copy still shares nested mutable objects with the argument: `copy(a)` of an `array<array<i32>>` is an error, because `copy` detaches only the outer array;
- accepts only `@pure` functions in `func` parameters.

The last two checks are conservative and can reject safe code. Both report `Pure function cannot create a new reference to object passed to it`.

It can change its own local objects and copies:

```ms
[i32]f(P: x) @pure
|   P q = copy(x)
|   q.age = 5                    // OK: this is a copy
|   return q.age

[void]g(array<i32>: x) @pure
|   x[0] = 7                     // error: cannot modify object
```

The string built-ins and `len`, `has`, `copy` and `cstr` are pure. `echo`, `input`, and `push` or `del` on objects the function does not own are not.

## Modules

```ms
use
|> http_server               // whole module
|> math -> sqrt              // one function
|> math -> pow : power       // function under another name
```

- A module is a file `name.ms`. The compiler looks for it in the standard library (`mono/`) first, then next to the importing file.
- Importing a single function hides the rest of the module.
- `@private` functions are visible only inside their own module.
- Structs and generic functions are imported too.

A function with the same name as an imported one is the error `conflicts`. There are two ways to resolve it:

```ms
use
|> lib2

[i32]helper() @overwrite     // 1) replace it on purpose
|   return 100
```

```ms
use
|> runlib -> helper : lh     // 2) import it under another name

[i32]helper()
|   return 100
```

## Built-in functions

### Input and output

| Function | Description |
|---|---|
| `echo(string)` | Print a string and a newline |
| `input() -> string` | Read a line from stdin |

### Strings

| Function | Description |
|---|---|
| `cstr(x) -> string` | Number, `char` or string to string |
| `substr(s, start, length)` | Substring. Going out of range stops the program |
| `strfind(s, sub) -> i32` | Position of the first match, or `-1` |
| `startsWith(s, prefix) -> i1` | Whether the string starts with the prefix |
| `count(s, sub) -> i32` | Non-overlapping matches: `count("abcabc", "abc") == 2` |
| `split(s, delim) -> array<string>` | Split: `split("a,bb,c", ",")` gives `["a", "bb", "c"]` |
| `reverse(s) -> string` | The string reversed (by bytes): `reverse("abc") == "cba"` |
| `toInt(s) -> result<i32>` | Strict parsing: digits with an optional leading `+` / `-`. `"42"`, `"+7"`, `"-2147483648"` succeed; `""`, `" 1"`, `"12abc"`, `"-"` fail with code `1`; `"2147483648"` fails with code `2` (outside `i32`) |
| `toArray(s) -> array<char>` | Copy of the string as an array of bytes |
| `joinChars(array<char>) -> string` | String from an array of `char` |
| `toString_int`, `toString_long`, `toString_float`, `toString_f64`, `toString_bool`, `toString_char` | A value of a specific type to string |

Special cases of `split`:
- `split("", ",")` gives `[""]`, and `split(",", ",")` gives `["", ""]`;
- an empty delimiter stops the program: `split: empty delimiter`.

### Collections

| Function | Description |
|---|---|
| `len(x) -> i32` | Length of an array, map or string (in bytes) |
| `push(a, x)` | Append to an array |
| `pop(a) -> T` | Remove and return the last element |
| `has(m, k) -> i1` | Whether a map has the key |
| `del(m, k)` | Remove a key from a map |
| `copy(x)` | Shallow copy of an array, map or struct |
| `range(n)`, `range(a, b)` | Range for `for` |

### Results and memory

| Function | Description |
|---|---|
| `ok(x)`, `ok()` | Successful `result` |
| `err(code, message)`, `err(message)` | Error. Without a code, the code is `0` |
| `gc_collect()` | Force a garbage collection |

## Runtime errors

These are panics: the `panic info` handler of an `attempt` catches them, including from called functions (see [local handling](#local-handling-attempt-and--else)). Without a handler, the program stops with a message, the line number and exit code `101`:

```
Runtime Error: index 3 out of bounds (len 3) at line 5
```

| Message | Cause |
|---|---|
| `index N out of bounds (len M)` | Array or string index out of range |
| `key not found` | Reading or deleting a missing map key |
| `division by zero` | Integer division or remainder by zero |
| `integer overflow` | Dividing the smallest value by `-1` |
| `float value out of range for i8` | A floating-point cast that does not fit |
| `pop from an empty array` | `pop` on an empty array |
| `array changed during iteration`, `map changed during iteration` | `push`, `pop` or `del` while walking the collection |
| `result has no value: ...` | Reading `value` from an error |
| `substr: range is outside the string`, `split: empty delimiter` | Bad arguments to string functions |
| `strings cannot contain a NUL byte` | `cstr('\0')` or `toString_char('\0')` |

## Native functions in D

The standard library is written in D. A new native function is an `extern(C)` function in `mono/std/...` plus one entry in `mono/mono.toml`:

```toml
[[function]]
name = "strfind"
pure = true
ret = "i32"
args = ["string", "string"]
```

A native function that returns `result<T>` builds it with `resultOk`, `resultErr`, `resultVoidOk` and `resultVoidErr` from `mono/std/core/abi.d`.

For `panic info` to catch a native function's failures, set `panic_context = true` in its entry. The function then takes a final `MsPanicContext*` argument (after the `args`), reports a failure with `ms_raise(message, line, context)` and **returns immediately**. It also passes on failures from its own helpers before using their result. A function without this flag stays a plain C call, and `ms_panic` still exits. Rebuild programs and native libraries after this calling-convention change.

Strings are passed as a C-compatible data pointer, with a `u64` length stored right before the data. A string that a native function returns must come from `newString(length)`, `stringFromBytes(data, length)` or `stringFromCString(text)` in the same module. Do not return a C/D literal or a `malloc` buffer. `resultErr` copies the error message into this format itself. Rebuild native extensions and programs after updating the runtime.

## Not implemented yet

The compiler gives a clear `not implemented` error for these:
- lambdas such as `[i32](i32: a) -> a + 1`;
- `|>` pipes inside expressions (they work in `use`);
- the `**` operator;
- null safety and embedding into other programs, which are planned.
