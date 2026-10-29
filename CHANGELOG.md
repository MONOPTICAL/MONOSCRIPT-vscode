# Change Log

All notable changes to the "ms" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
- `'` is no longer auto-closed (MONOSCRIPT has no character literals).

## [0.0.2]

- Initial release
