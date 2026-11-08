# MONOSCRIPT VS Code Extension

Official VS Code extension for the [MONOSCRIPT](https://github.com/MONOPTICAL/MONOSCRIPT) programming language. It includes a language server and follows the language on the `dev` branch: methods with `self`, generic functions, functions as parameters, `result<T>`, `char` and `f64`.

**Language reference:** [English](docs/language.en.md) · [Русский](docs/language.ru.md). The same reference is built into the extension, see [Language reference inside VS Code](#language-reference-inside-vs-code).

## Features

### Language reference inside VS Code
The reference opens in a panel next to the editor. Open it with the 📖 button in the editor title bar, from the editor context menu, with `Ctrl+Shift+F1`, or with `MONOSCRIPT: Open Documentation (Language Reference)`.

* **Contents** sit in a sidebar that highlights the section you are reading. The search box keeps only the sections whose text contains the query.
* **Examples** are highlighted like MONOSCRIPT code. Hover over one to get two buttons: **Open in editor** creates a new `.ms` file with the example, and **Copy** puts it on the clipboard.
* **RU / EN** switches the language. The default follows the VS Code interface, and the `monoscript.guide.language` setting overrides it.
* **📖 Справочник** links at the end of hovers on keywords, types, labels and built-ins open the matching section.
* **`MONOSCRIPT: Search Documentation (Language Reference)`** jumps to any section by its title.

### Editing
* **Syntax highlighting** for `.ms` files: types (`f64`, `char`, `array<i32>`, `map<string, i32>`, `result<T>`), functions and methods, generic functions (`[T]first<T>(...)`), `func:` parameters, structs, `self`, labels (`@entry`, `@strict`, `@pure`, `@private`, `@overwrite`), `use` imports, casts (`x->i64`), character literals (`'a'`, `'\n'`), the result check (`?r`), error handling (`attempt`, `else error`, `panic info`, `r? else`), and `TODO`/`FIXME` in comments.
* **Block guides**: the `|` indentation is colored by nesting level (`monoscript.blockGuides`: `rainbow` / `dim` / `off`).
* **Smart `|` indentation**:
  * `Enter` keeps the current `|` prefix and opens a new level after `[T]func(...)`, `[T]func<T>(...)`, `[struct]Name`, `if`, `else`, `for` and `while`.
  * After `return` / `break` / `continue`, `Enter` goes back one level.
  * After `use`, `Enter` starts an `|> ` import chain. Pressing `Enter` on an empty `|> ` ends the chain.
  * `Backspace` in the indentation removes one whole `|   ` level.
  * `Ctrl+]` / `Ctrl+[` (and `Shift+Tab`) indent or outdent the selected lines by one `|` level.
* **Snippets** that keep the `|` prefix when you insert them inside nested blocks: `msfunc`, `main`, `sfunc`, `pfunc`, `psfunc`, `efunc`, `ofunc`, `gfunc`, `funcp`, `rfunc`, `ifok`, `ignore`, `struct`, `method`, `const`, `final`, `finald`, `var`, `arr`, `mapv`, `if`, `ifelse`, `ifelseif`, `for`, `forr`, `forin`, `while`, `use`, `usefn`, `return`, `echo`, `echoi`.
* **Formatting** (`Shift+Alt+F`): puts `|` indentation on a fixed step, trims trailing whitespace and collapses runs of blank lines.
* **Folding** by `|` blocks, comments and `// #region` / `// #endregion`.

### Navigation and IntelliSense
* **Outline / breadcrumbs / Go to Symbol**: structs with their fields and methods, functions and generic functions.
* **Completion**: local variables and parameters, functions, structs, built-ins (`echo`, `cstr`, `len`, `push`, `pop`, `has`, `del`, `copy`, `ok`, `err`, `split`, `substr`, …), keywords, types and labels.
  * Typing `obj.` shows the fields and methods of the struct, `self.` does the same inside a method, and `r.` on a `result<T>` shows `ok`, `value`, `code` and `error`.
  * Types are inferred from `Player p = ...`, `p ^= Player()`, `x ^= f()` (the return type of `f`), `2.5` (`f64`), `'a'` (`char`) and the loop variable of `for x in items`.
* **Hover**: function signatures with the `//` comments written above them, plus descriptions of built-ins, keywords, types and labels.
* **Go to Definition**, **Find All References** and **Workspace Symbols** across all `.ms` files.
* **Signature help** for functions, methods, generic functions and built-ins.

### Language server
IntelliSense, diagnostics while typing, rename and formatting come from a language server (`out/server/server.js`) that ships with the extension. It works without the compiler. The server speaks the standard Language Server Protocol, so other editors can use it too: run `node out/server/server.js --stdio` and attach it to `.ms` files.

* **Diagnostics while typing** (source `ms-lint`), shown without saving and without the compiler:
  * `|` indentation that jumps more than one level, or a deeper level after a line that does not open a block;
  * empty blocks;
  * unknown labels (`@decl` and typos);
  * unclosed strings and bad `char` literals (`'ab'`, `'я'`, unknown escapes);
  * syntax the compiler no longer accepts or does not have yet (`[T]Struct::method`, lambdas, `**`);
  * calls to functions that are not declared anywhere in the workspace. This check is skipped in files with `use`.
* **Rename** (`F2`) for variables, parameters, functions, structs, fields and methods. Locals change only in their scope, fields and methods only after `.`, functions and structs across all `.ms` files.
* **Highlight** of every use of the symbol under the cursor.
* **Inlay hints** with inferred types: `n ^= helper(2)` shows `n: i32`, and `for c in name` shows `c: char`. The return types of functions from other files are used too.
* `MONOSCRIPT: Restart Language Server` restarts the server. Its log is in Output → *MONOSCRIPT Language Server*.

### Compiler integration
These features need the MONOSCRIPT compiler (`ms`) on your `PATH`, or its path in `monoscript.compilerPath`.

* **Compiler diagnostics** (source `ms`): the language server checks each file with the compiler when you open or save it, and the errors show up in the editor and in the Problems panel.
* **Run** (`Ctrl+F5` or the ▶ button in the editor title, runs `ms run FILE`) and **Compile to executable** (`ms --compile OUT FILE`).
* Commands: `MONOSCRIPT: Check File`, `MONOSCRIPT: Show Tokens`, `MONOSCRIPT: Show AST`, `MONOSCRIPT: Show Semantic Analysis`.
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
| `monoscript.diagnostics.lint` | `true` | Language server checks while typing |
| `monoscript.trace.server` | `off` | Log of messages with the language server: `off`, `messages`, `verbose` |
| `monoscript.saveBeforeRun` | `true` | Save the file before run/compile |
| `monoscript.extraArgs` | `[]` | Extra compiler flags for run/compile, for example `["--timings"]` or `["--offOptimization"]` |
| `monoscript.indentUnit` | `"\|   "` | One indentation level |
| `monoscript.smartIndent` | `true` | Smart `Enter` / `Backspace` |
| `monoscript.blockGuides` | `rainbow` | `rainbow`, `dim` or `off` |

## Development

```bash
npm install
npm run grammar   # regenerate syntaxes/ms.tmLanguage.json from syntaxes/build-grammar.js
npm run compile
npm test          # starts the language server and checks it over LSP
npm run package   # build a .vsix
code --install-extension monoscript-language-support-0.3.0.vsix --force
```

Press `F5` in VS Code to build the project and launch an Extension Development Host. The **Client + Server** configuration also attaches the debugger to the language server, which runs in a separate Node process on port 6009.

To run the tests against another copy of the server, for example the installed one, set `MS_SERVER` to the path of its `server.js`.

Code layout:

* `src/analyzer.ts` and `src/builtins.ts`: the parser shared by the client and the server, with no VS Code dependencies.
* `src/server/`: the language server.
* `src/extension.ts`, `src/indent.ts`, `src/blockGuides.ts`, `src/compiler.ts`: the client side, which handles smart `Enter`/`Backspace`, block guides, run/compile tasks and starting the server.

 `example.ms` is a sample file that uses most of the language.

## MONOSCRIPT Compiler

The official MONOSCRIPT compiler and more information about the language:
[https://github.com/MONOPTICAL/MONOSCRIPT](https://github.com/MONOPTICAL/MONOSCRIPT)

## Feedback

Please report issues and ideas in the "Issues" section of the extension's repository.

---

**Thank you for using MONOSCRIPT!**
