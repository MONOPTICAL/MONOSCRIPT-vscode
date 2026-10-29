# MONOSCRIPT VS Code Extension

Official VS Code extension for the [MONOSCRIPT](https://github.com/MONOPTICAL/MONOSCRIPT) programming language.

## Features

### Editing
* **Syntax highlighting** for `.ms` files: types (including generics like `array<i32>`, `map<string, i32>`), functions and `Struct::method` declarations, structs, lambdas, parameters, labels (`@entry`, `@strict`, `@pure`, …), `use` imports, casts (`x -> i64`), pipes (`|>`), the null check (`?x`), and `TODO`/`FIXME` in comments.
* **Block guides**: the `|` indentation is colored by nesting level (`monoscript.blockGuides`: `rainbow` / `dim` / `off`).
* **Smart `|` indentation**:
  * `Enter` keeps the current `|` prefix and opens a new level after `[T]func(...)`, `[struct]Name`, `if`, `else`, `for`, `while` and block lambdas (`... :`).
  * After `return` / `break` / `continue`, `Enter` goes back one level.
  * After `use`, `Enter` starts an `|> ` import chain. Pressing `Enter` on an empty `|> ` ends the chain.
  * `Backspace` in the indentation removes one whole `|   ` level.
  * `Ctrl+]` / `Ctrl+[` (and `Shift+Tab`) indent or outdent the selected lines by one `|` level.
* **Snippets** that keep the `|` prefix when you insert them inside nested blocks: `msfunc`, `main`, `sfunc`, `pfunc`, `efunc`, `psfunc`, `decl`, `struct`, `init`, `method`, `const`, `final`, `var`, `arr`, `mapv`, `if`, `ifelse`, `ifelseif`, `for`, `while`, `lambda`, `lambdab`, `use`, `usefn`, `pipe`, `return`, `echo`, `echoi`.
* **Formatting** (`Shift+Alt+F`): puts `|` indentation on a fixed step, trims trailing whitespace and collapses runs of blank lines.
* **Folding** by `|` blocks, comments and `// #region` / `// #endregion`.

### Navigation and IntelliSense
* **Outline / breadcrumbs / Go to Symbol**: structs with their fields and methods, functions, lambdas.
* **Completion**: local variables and parameters, functions, structs, built-ins from the std library (`echo`, `scat`, `toString_int`, …), keywords, types and labels.
  * Typing `obj.` shows the fields and methods of the struct. The type comes from `p ^= Player(...)` or `Player p = ...`.
* **Hover**: function signatures with the `//` comments written above them, plus descriptions of built-ins, keywords, types and labels.
* **Go to Definition**, **Find All References** and **Workspace Symbols** across all `.ms` files.
* **Signature help** for functions, methods, lambdas and struct constructors (`__init__`).

### Compiler integration
These features need the MONOSCRIPT compiler (`ms`) on your `PATH`, or its path in `monoscript.compilerPath`.

* **Diagnostics**: each file is checked by the compiler when you open or save it, and errors show up in the editor and in the Problems panel.
* **Run** (`Ctrl+F5` or the ▶ button in the editor title) and **Compile to executable**.
* Commands: `MONOSCRIPT: Check File`, `MONOSCRIPT: Show Tokens`, `MONOSCRIPT: Show AST`.
* A `monoscript` task type for `tasks.json`:

```json
{
    "type": "monoscript",
    "action": "compile",
    "file": "${workspaceFolder}/main.ms",
    "output": "${workspaceFolder}/main"
}
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `monoscript.compilerPath` | `ms` | Path to the compiler |
| `monoscript.diagnostics.enable` | `true` | Check files with the compiler on open and save |
| `monoscript.diagnostics.remapLines` | `true` | The compiler counts lines without empty and comment-only lines. When this is on, the extension converts those numbers back to real line numbers. |
| `monoscript.saveBeforeRun` | `true` | Save the file before run/compile |
| `monoscript.indentUnit` | `"\|   "` | One indentation level |
| `monoscript.smartIndent` | `true` | Smart `Enter` / `Backspace` |
| `monoscript.blockGuides` | `rainbow` | `rainbow`, `dim` or `off` |

## Development

```bash
npm install
npm run grammar   # regenerate syntaxes/ms.tmLanguage.json from syntaxes/build-grammar.js
npm run compile
npm run package   # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host. `example.ms` is a sample file that uses most of the language.

## MONOSCRIPT Compiler

The official MONOSCRIPT compiler and more information about the language:
[https://github.com/MONOPTICAL/MONOSCRIPT](https://github.com/MONOPTICAL/MONOSCRIPT)

## Feedback

Please report issues and ideas in the "Issues" section of the extension's repository.

---

**Thank you for using MONOSCRIPT!**
