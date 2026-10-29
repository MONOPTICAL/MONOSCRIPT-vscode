// Примерный псевдо-код на MONOSCRIPT — набросок, доделать по ходу

[struct]Player
|   string name = "unknown"
|   i32 hp = 100
|   i1 alive = 1
|   scores ^= [0, 0, 0, 0, 0]
|
|   [void]__init__(string: n, i32: startHp)
|   |   name = n
|   |   hp = startHp
|
|   [void]damage(i32: amount)
|   |   hp = hp - amount
|   |   if (hp < 0)
|   |   |   hp = 0
|   |   |   alive = 0
|
|   [i32]totalScore()
|   |   i32 sum = 0
|   |   for i in range(scores)
|   |   |   sum = sum + scores[i]
|   |   return sum

[i32]clamp(i32: x, i32: lo, i32: hi) @pure
|   if (x < lo)
|   |   return lo
|   else if (x > hi)
|   |   return hi
|   return x

[i64]factorial(i64: n) @strict @pure
|   if (n <= 1)
|   |   return 1
|   return n * factorial(n - 1)

[i32]main() @entry
|   p ^= Player("Max", 120)
|
|   // массивы внутри структуры
|   p.scores[0] = 10
|   p.scores[1] = 25
|   p.scores = [5, 5, 5, 5, 5]
|
|   // проверка типов: i1 <- i1 ок, i1 <- i32 должно ругаться
|   p.alive = 1
|   // p.alive = "yes"   // ожидается: Type mismatch: expected i1, got string
|
|   p.damage(50)
|   p.damage(100)
|
|   if (!p.alive)
|   |   echo(scat(p.name, " is dead"))
|   else
|   |   echo(scat("hp: ", toString_int(p.hp)))
|
|   // while + break/continue
|   i32 i = 0
|   while (i < 10)
|   |   i = i + 1
|   |   if (i % 2 == 0)
|   |   |   continue
|   |   if (i > 7)
|   |   |   break
|   |   echo(toString_int(clamp(i * 3, 0, 15)))
|
|   // лямбды
|   square ^= [i32](i32: x) -> x * x
|   echo(toString_int(square(7)))
|
|   doubleAll ^= [array<i32>](array<i32>: a) :
|   |   for j in range(a)
|   |   |   a[j] = a[j] * 2
|   |   return a
|
|   array<i32> nums = [1, 2, 3, 4, 5]
|   nums = doubleAll(nums)
|
|   // TODO: пайпы, когда будут map/filter в std
|   // res ^= nums
|   //     |> map(res, [i32](i32: a) -> a + 1)
|   //     |> filter(res, [i32](i32: a) -> a > 4)
|
|   echo(toString_long(factorial(10)))
|   echo(toString_int(p.totalScore()))
|   return 0
