/**
 * Preloaded playground examples. Single source of truth: the interpreter
 * test-suite executes every example, so anything listed here is guaranteed
 * to run in the browser playground.
 */
export interface ZZExample {
  id: string;
  label: string;
  code: string;
}

export const ZZ_EXAMPLES: ZZExample[] = [
  {
    id: 'hello',
    label: 'Hello World',
    code: `name := input("What is your name? ")
println("Hello, {name}!")

func factorial(n: int) -> int {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

println("5! = {factorial(5)}")`,
  },
  {
    id: 'structs',
    label: 'Struct Mapping',
    code: `struct User {id: int, name: str, email: str}

users: [User] = []
users.append(User{id: 1, name: "Ada", email: "ada@example.com"})
users.append(User{id: 2, name: "Grace", email: "grace@example.com"})

for user in users {
    println("{user.id}. {user.name} <{user.email}>")
}`,
  },
  {
    id: 'iterators',
    label: 'Iterators & Closures',
    code: `// range() with one, two and three arguments
for i in range(5) {
    print("{i} ")
}
println("")

// map + filter with inline closures
squares := map(range(1, 6), |x: int| x * x)
println("squares: {squares}")

evens := filter(range(1, 11), |x: int| x % 2 == 0)
println("evens: {evens}")

// enumerate + zip
fruits := ["apple", "banana", "cherry"]
println(enumerate(fruits))
println(zip(["alice", "bob"], [95, 87]))

// dicts
ages := {"alice": 25, "bob": 30}
println("people: {len(ages)}")`,
  },
  {
    id: 'pipeline',
    label: 'Pipeline Operator',
    code: `func double(x: int) -> int {
    x * 2
}

func triple(x: int) -> int {
    x * 3
}

func add_one(x: int) -> int {
    x + 1
}

func add(a: int, b: int) -> int {
    a + b
}

// a |> f(b) desugars to f(a, b)
result := 5 |> add_one |> double |> triple
println("5 |> add_one |> double |> triple = {result}")

final := 10 |> triple |> add_one |> double
println("10 |> triple |> add_one |> double = {final}")

println("10 |> add(5) = {10 |> add(5)}")`,
  },
  {
    id: 'match',
    label: 'Match & Options',
    code: `func describe(x: int) -> str {
    match x {
        0 => "zero",
        1 => "one",
        _ => "many"
    }
}

for i in range(4) {
    println("{i} -> {describe(i)}")
}

// Elvis operator unwraps Options
name := .some("Ada")
println(name ?? "stranger")
println(.none ?? "fallback")

// Format specs
pi := 3.14159
println("{pi:.2f}")

n := 255
println("hex={n:x} oct={n:o} bin={n:b}")

// Result handling
match int("42") {
    .some(v) => println("parsed: {v}"),
    .none => println("not a number"),
}`,
  },
];
