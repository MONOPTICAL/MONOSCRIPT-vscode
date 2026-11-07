// Пример на MONOSCRIPT: почти все возможности языка в одном файле
/* Запуск: ms run example.ms */

[struct]Player
|   string name = "unknown"
|   i32 hp = 100
|   i1 alive = true
|   array<i32> scores = [0, 0, 0]
|
|   // Урон: hp не опускается ниже нуля
|   [void]damage(i32: amount)
|   |   self.hp = self.hp - amount
|   |   if self.hp <= 0
|   |   |   self.hp = 0
|   |   |   self.alive = false
|
|   [i32]totalScore() @pure
|   |   i32 sum = 0
|   |   for s in self.scores
|   |   |   sum = sum + s
|   |   return sum

[i32]clamp(i32: x, i32: lo, i32: hi) @pure
|   if x < lo
|   |   return lo
|   else if x > hi
|   |   return hi
|   return x

[i64]factorial(i64: n) @strict @pure
|   if n <= 1
|   |   return 1
|   return n * factorial(n - 1)

// Шаблон функции: T выводится из аргументов
[array<T>]filter<T>(array<T>: items, func: keep(T: x) -> i1)
|   array<T> out = []
|   for x in items
|   |   if keep(x)
|   |   |   push(out, x)
|   return out

[i1]isEven(i32: x)
|   return x % 2 == 0

// Ошибки как значения
[result<i32>]parseDigit(string: s)
|   if len(s) != 1
|   |   return err(1, "expected one digit")
|   char c = s[0]
|   if c < '0' or c > '9'
|   |   return err(2, "not a digit: " + s)
|   return ok(c->i32 - '0'->i32)

[i32]main()
|   Player p = Player()
|   p.name = "Max"
|   p.scores[0] = 10
|   push(p.scores, 25)
|
|   p.damage(50)
|   p.damage(100)
|   if !p.alive
|   |   echo(p.name + " is dead, score " + p.totalScore())
|
|   // while + break/continue
|   i32 i = 0
|   while i < 10
|   |   i = i + 1
|   |   if i % 2 == 0
|   |   |   continue
|   |   if i > 7
|   |   |   break
|   |   echo(cstr(clamp(i * 3, 0, 15)))
|
|   // map: порядок вставки сохраняется
|   map<string, i32> ports = {"ssh": 22}
|   ports["http"] = 80
|   if has(ports, "ssh")
|   |   del(ports, "ssh")
|   for name in ports
|   |   echo(name + " = " + ports[name])
|
|   array<i32> even = filter([1, 2, 3, 4, 5, 6], isEven)
|   echo("even: " + len(even))
|
|   result<i32> r = parseDigit("7")
|   if ?r
|   |   echo("digit " + r.value)
|   else
|   |   echo("error " + r.code + ": " + r.error)
|
|   f ^= 2.5                 // f64 по умолчанию
|   small ^= f->i8
|   final i32 limit
|   limit = 3
|   for k in range(1, limit)
|   |   echo(cstr(k))
|
|   echo(toString_long(factorial(10)) + " " + cstr(small))
|   return 0
