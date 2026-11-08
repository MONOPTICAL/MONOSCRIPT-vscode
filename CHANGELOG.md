# Change Log

All notable changes to the "ms" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.5.0]

Support for the MONOSCRIPT compiler as of commit `8587cfa`: local error handling.

### Added
- `attempt` blocks with `else error` and `panic info` handlers: highlighting, smart `Enter` and indent checks, hovers, and completion of `error.` (`ok`, `code`, `error`) and `info.` (`message`, `line`) inside the handler. The handler names are visible only inside their block.
- `r? else value` and `r? else: statements`: `x ^= toInt(s)? else 0` gets the unwrapped type, and `error` is available in a one-line action.
- Fast checks: `attempt` without a handler or with a duplicate one, `panic info` without an `attempt`, text after `attempt`, `? else` with nothing after it, and a `? else:` action that does not end in `return`, `break` or `continue` or contains a block statement.
- `attempt` and `orelse` snippets.
- Reference: *Local handling: attempt and ? else*, panics that `panic info` catches, and `panic_context = true` for native functions.

### Changed
- Reading `.value` from an error, out-of-bounds access and other runtime errors are described as panics that `panic info` can catch (exit code `101` only when nothing catches them).

## [0.4.0]

Support for the MONOSCRIPT compiler as of commit `fb99678`.

### Added
- One-line branches `if x: stmt`, `else if x: stmt`, `else: stmt`: no false "empty block" or indent warnings, smart `Enter` does not add a `|` level after them, and the fast checks report `if x:` with nothing after the colon, nested control statements in a one-line branch, and `while x: ...`.
- Postfix `r?` / `r??`: highlighting, and `x ^= toInt(s)?` gets the unwrapped type in inlay hints and completion.
- `x ^= split(...)` and other built-in calls now get their return type.
- Reference: one-line branches, the `?` operator, NUL bytes in strings, the new `@pure` checks, and the native string ABI (`newString`, `stringFromBytes`, `stringFromCString`).

### Changed
- `toInt(s)` returns `result<i32>` with strict parsing (code `1` for syntax, `2` for range) in hovers, signatures and the reference.
- `\0` is listed only as a `char` escape: string literals cannot contain a NUL byte.

### Fixed
- The map example in the reference iterated over an array literal, which the compiler rejects.

## [0.3.1]

### Added
- `reverse(s)` built-in in completion, hovers, highlighting and the reference.
- `Ctrl+Shift+F1` opens the reference. The commands are now titled *Open/Search Documentation (Language Reference)*, so they are found by typing "doc" in the Command Palette.

### Changed
- The reference and hovers say that `err("message")` has code `0`.
- Reference panel redesign in black and white, after the MONOSCRIPT logo: a **MONO**SCRIPT wordmark, monospace headings, grayscale code highlighting (keywords bold, types italic, strings gray). The page is black in dark themes and white in light themes and no longer picks up theme colors such as harsh borders or black code blocks. High contrast themes get solid borders.
- In the reference search, `Enter` jumps to the first match and `Esc` clears the query.

### Fixed
- The contents list scrolled under the search box.
- Opening the reference at a section (for example from a hover link) could land far below that section.

## [0.3.0]

### Added
- Language server (`src/server`, Language Server Protocol). Completion, hover, go to definition, references, signature help, symbols, folding and formatting moved there from the extension process. Other editors can use the server through `node out/server/server.js --stdio`.
- Diagnostics while typing, without the compiler (`ms-lint`):
  - `|` indentation errors and empty blocks;
  - unknown labels;
  - unclosed strings and bad `char` literals;
  - removed or not yet implemented syntax;
  - calls to undeclared functions.
- Rename (`F2`) across files, highlight of the symbol under the cursor, inlay hints with inferred types.
- Return types of functions from other files are used for `x ^= f()`.
- `monoscript.diagnostics.lint` and `monoscript.trace.server` settings, `MONOSCRIPT: Restart Language Server` command.
- `npm test`: the language server is checked over the real protocol.
- `F5` builds the project first, and the *Client + Server* launch configuration attaches the debugger to the server.
- The language reference is built into the extension. It opens in its own panel:
  - contents sidebar and full-text search;
  - RU/EN switch and the `monoscript.guide.language` setting;
  - highlighted examples with **Open in editor** and **Copy** buttons.
- Hovers on keywords, types, labels and built-ins link to their section of the reference. `MONOSCRIPT: Search Language Reference` jumps to a section by title. The reference also has a button in the editor title bar and an entry in the context menu.

### Changed
- Compiler diagnostics run in the language server and are merged with its own checks.
- `MONOSCRIPT: Open Language Guide` is now `Open Language Reference` and opens the panel instead of the Markdown preview.

## [0.2.0]

Updated for the language on the MONOSCRIPT `dev` branch.

### Added
- Methods inside structs and `self`: completion and go to definition after `self.`, hover on `self`.
- Generic functions `[T]first<T>(array<T>: items)`: highlighting, outline, signatures, smart `Enter`.
- `func: keep(T: x) -> i1` parameters are shown in their source form.
- `result<T>`: type, `ok()` / `err()`, completion and hover for `r.ok`, `r.value`, `r.code`, `r.error`, the `?r` check, `_ ^= ...`.
- Types `f64` and `char`, character literals with escapes (`'\n'`, `'\''`), `'` is auto-closed again.
- `@overwrite` label, `final i32 x` with a later assignment.
- Built-ins from the new std library and the compiler: `cstr`, `len`, `push`, `pop`, `has`, `del`, `copy`, `range(a, b)`, `input`, `substr`, `strfind`, `startsWith`, `count`, `split`, `toInt`, `toArray`, `joinChars`, `toString_f64`, `toString_char`, `gc_collect`.
- Type inference for `x ^= f()`, `2.5` (`f64`), `'a'` (`char`) and loop variables of `for x in array`, `for k in map`, `for c in string`.
- `MONOSCRIPT: Show Semantic Analysis` command and `semantic` task action (`--semantic`).
- `monoscript.extraArgs` setting for flags like `--timings` and `--offOptimization`.
- Language reference in English and Russian (`docs/`), with examples from the compiler tests.
- Integer literals infer the narrowest type, as in the compiler: `x ^= 1` is `i1`, `x ^= 300` is `i16`.
- `\f` and `\b` escapes are highlighted.

### Changed
- Run uses `ms run FILE`.
- Snippets: `if` / `while` without parentheses, `main` without `@entry`, new `gfunc`, `funcp`, `rfunc`, `ifok`, `ignore`, `ofunc`, `finald`, `forr`, `forin`; `echoi` uses `cstr`.
- Struct fields are reached through `self.` inside methods, not by bare name.
- Struct constructors take no arguments: `Player()`.

### Removed
- `monoscript.diagnostics.remapLines`: the compiler now reports real line numbers.
- `[T]Struct::method` declarations, `__init__`, `@decl`, `not` and lambdas, which the compiler no longer accepts (lambdas and `|>` pipes are planned). Snippets `decl`, `init`, `lambda`, `lambdab`, `pipe` are gone.

## [0.1.0]

### Added
- Rewritten TextMate grammar (generated from `syntaxes/build-grammar.js`): generics, `Struct::method`, lambdas, parameters, `use` chains, casts, labels, built-ins, block comments, `TODO` tags.
- Outline / breadcrumbs, workspace symbols, folding by `|` blocks.
- Completion (including struct members after `.`), hover, go to definition, find references, signature help.
- Document formatting for `|` indentation.
- Compiler diagnostics on open/save, Run / Compile / Check / Show Tokens / Show AST commands, `monoscript` task type.
- Colored or dimmed `|` block guides.
- Indent/outdent lines by one `|` level (`Ctrl+]` / `Ctrl+[` / `Shift+Tab`).
- New snippets: `struct`, `init`, `method`, `decl`, `for`, `while`, `lambda`, `lambdab`, `use`, `usefn`, `pipe`, `var`, `final`, `arr`, `mapv`, `echoi`.
- Language icon for `.ms` files that works with any icon theme.

### Fixed
- `Enter` no longer overrides accepting a suggestion from the completion widget.
- `Enter` / `Backspace` work with multiple cursors, and with text after the cursor.
- Snippets keep the `|` prefix when inserted inside nested blocks.
- `'` was no longer auto-closed (MONOSCRIPT had no character literals then).

## [0.0.2]

- Initial release
