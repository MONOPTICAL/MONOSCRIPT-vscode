// Разбор вывода компилятора `ms`. Без зависимостей от vscode и LSP.

const ANSI_RE = /\x1b\[[0-9;]*m/g;
// `Type mismatch [line 12, column 3]: ...`, `Parser Error [line 4]: ...`, `Warn [line 1, column 1]: ...`
const BRACKET_RE = /^(.*?)\s*\[line (\d+)(?:, column (\d+))?\]:\s*(.*)$/;
// `Parser Error: Unknown primary expression at line 5, column 2: x`, `Runtime Error: ... at line 3`
const AT_LINE_RE = /^(.*?(?:Error|error))\s*:\s*(.*?)\s+at line (\d+)(?:,\s*column (\d+))?(?::\s*(.*))?$/;

export interface ParsedError {
    /** Строка с 0 */
    line: number;
    message: string;
    severity: 'error' | 'warning';
    hint?: string;
}

export function stripAnsi(text: string): string {
    return text.replace(ANSI_RE, '');
}

/**
 * Номера строк в сообщениях — настоящие строки файла (с 1). Колонку не используем:
 * для узлов AST компилятор пишет туда номер токена, а не символа.
 */
export function parseCompilerOutput(output: string, totalLines: number): ParsedError[] {
    const lines = stripAnsi(output).split(/\r?\n/);
    const clamp = (n: number) => Math.max(0, Math.min(n, totalLines - 1));
    const result: ParsedError[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let m = line.match(BRACKET_RE);
        if (m) {
            const kind = m[1].trim();
            const err: ParsedError = {
                line: clamp(parseInt(m[2], 10) - 1),
                message: kind ? `${kind}: ${m[4]}` : m[4],
                severity: /^warn/i.test(kind) ? 'warning' : 'error'
            };
            const hint = lines.slice(i + 1, i + 5).find(l => /^\s*Hint:/.test(l));
            if (hint) { err.hint = hint.replace(/^\s*Hint:\s*/, ''); }
            result.push(err);
            continue;
        }
        m = line.match(AT_LINE_RE);
        if (m) {
            result.push({
                line: clamp(parseInt(m[3], 10) - 1),
                message: `${m[1]}: ${m[2]}${m[5] ? ` (${m[5]})` : ''}`,
                severity: 'error'
            });
        }
    }
    return result;
}
