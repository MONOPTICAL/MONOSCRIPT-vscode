import * as vscode from 'vscode';
import { PREFIX_RE, stripLineComment } from './analyzer';

// Отступы в MONOSCRIPT — это `|` + пробелы. Стандартный автоотступ VS Code
// копирует только пробельные символы, поэтому Enter/Backspace/сдвиг блока
// реализованы вручную.

export function indentUnit(): string {
    const unit = vscode.workspace.getConfiguration('monoscript').get<string>('indentUnit', '|   ');
    return unit.startsWith('|') ? unit : '|   ';
}

const BLOCK_OPENERS: RegExp[] = [
    /^\[.+?\]\s*(?:\w+\s*::\s*)?\w+\s*\(.*\)\s*(?:@\w+\s*)*$/,  // функция / метод
    /^\[\s*struct\s*\]\s*\w+\s*(?:@\w+\s*)*$/,                   // структура
    /^(?:if|while)\b.*$/,
    /^for\s+\w+\s+in\b.*$/,
    /^else(?:\s+if\b.*)?$/,
    /\[.+?\]\s*\(.*\)\s*:$/                                       // блочная лямбда
];

const IMPORT_ENTRY = /^\|>\s*\w+(?:\s*->\s*\w+(?:\s*:\s*\w+)?)?$/;

function opensBlock(code: string): boolean {
    if (/@decl\b/.test(code)) { return false; }
    return BLOCK_OPENERS.some(re => re.test(code));
}

function dropLastLevel(prefix: string): string {
    const idx = prefix.lastIndexOf('|');
    return idx < 0 ? prefix : prefix.slice(0, idx);
}

function normalizePrefixEnd(prefix: string, unit: string): string {
    // `|` без пробелов (пустая строка внутри блока) — дополняем до полного шага
    return prefix.endsWith('|') ? prefix + unit.slice(1) : prefix;
}

export function onEnter(editor: vscode.TextEditor): void {
    const doc = editor.document;
    const unit = indentUnit();
    const selections = [...editor.selections].sort((a, b) => a.start.compareTo(b.start));

    // Несколько курсоров на одной строке — отдаём штатному обработчику
    const lines = new Set(selections.map(s => s.start.line));
    if (lines.size !== selections.length) {
        vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
        return;
    }

    interface Plan { range: vscode.Range; text: string; cursorCol: number }
    const plans: Plan[] = [];

    for (const sel of selections) {
        const line = doc.lineAt(sel.start.line);
        const before = line.text.slice(0, sel.start.character);
        const endLine = doc.lineAt(sel.end.line);
        const after = endLine.text.slice(sel.end.character);
        const leadingWs = after.length - after.trimStart().length;
        const range = new vscode.Range(sel.start, sel.end.translate(0, leadingWs));
        const prefix = (line.text.match(PREFIX_RE) ?? [''])[0];

        if (before.length < prefix.length) {
            // Курсор внутри отступа — просто перенос строки
            plans.push({ range: new vscode.Range(sel.start, sel.end), text: '\n', cursorCol: 0 });
            continue;
        }

        const code = stripLineComment(before.slice(prefix.length)).trim();
        let next = normalizePrefixEnd(prefix, unit);

        if (code === '|>' && after.trim() === '') {
            // Пустой пункт `use`-цепочки — завершаем цепочку
            plans.push({ range: new vscode.Range(line.range.start.translate(0, prefix.length), sel.end), text: '\n' + prefix, cursorCol: prefix.length });
            continue;
        }

        if (code === 'use' || (IMPORT_ENTRY.test(code) && prefix === '' && after.trim() === '')) {
            next = prefix + '|> ';
        } else if (opensBlock(code)) {
            next = next + unit;
        } else if (/^(?:return|break|continue)\b/.test(code) && after.trim() === '' && prefix.includes('|')) {
            next = dropLastLevel(prefix);
        }

        plans.push({ range, text: '\n' + next, cursorCol: next.length });
    }

    editor.edit(builder => {
        for (const p of plans) { builder.replace(p.range, p.text); }
    }).then(ok => {
        if (!ok) { return; }
        let shift = 0;
        const newSelections = plans.map(p => {
            const line = p.range.start.line + 1 + shift;
            shift += 1 - (p.range.end.line - p.range.start.line);
            const pos = new vscode.Position(line, p.cursorCol);
            return new vscode.Selection(pos, pos);
        });
        editor.selections = newSelections;
        editor.revealRange(newSelections[0]);
    });
}

export function onBackspace(editor: vscode.TextEditor): void {
    const doc = editor.document;
    const ranges: vscode.Range[] = [];

    for (const sel of editor.selections) {
        if (!sel.isEmpty) { return fallback(); }
        const text = doc.lineAt(sel.active.line).text;
        const before = text.slice(0, sel.active.character);
        if (before.length === 0) { return fallback(); }

        if (/^[ \t]*(?:\|(?!>)[ \t]*)+$/.test(before)) {
            // Только отступ перед курсором — удаляем один уровень `|   `
            const idx = before.lastIndexOf('|');
            ranges.push(new vscode.Range(sel.active.line, idx, sel.active.line, before.length));
        } else if (/^[ \t]*(?:\|(?!>)[ \t]*)*\|> $/.test(before) && text.length === before.length) {
            // Пустой `|> ` в цепочке импорта
            ranges.push(new vscode.Range(sel.active.line, before.length - 3, sel.active.line, before.length));
        } else {
            return fallback();
        }
    }

    editor.edit(builder => ranges.forEach(r => builder.delete(r)));

    function fallback() {
        vscode.commands.executeCommand('deleteLeft');
    }
}

function selectedLines(editor: vscode.TextEditor): number[] {
    const set = new Set<number>();
    for (const sel of editor.selections) {
        let end = sel.end.line;
        if (end > sel.start.line && sel.end.character === 0) { end--; }
        for (let l = sel.start.line; l <= end; l++) { set.add(l); }
    }
    return [...set].sort((a, b) => a - b);
}

export function indentLines(editor: vscode.TextEditor): void {
    const unit = indentUnit();
    const doc = editor.document;
    editor.edit(builder => {
        for (const l of selectedLines(editor)) {
            const text = doc.lineAt(l).text;
            if (text.trim() === '') { continue; }
            builder.insert(new vscode.Position(l, 0), unit);
        }
    });
}

export function outdentLines(editor: vscode.TextEditor): void {
    const doc = editor.document;
    editor.edit(builder => {
        for (const l of selectedLines(editor)) {
            const text = doc.lineAt(l).text;
            const prefix = (text.match(PREFIX_RE) ?? [''])[0];
            const idx = prefix.lastIndexOf('|');
            if (idx < 0) { continue; }
            builder.delete(new vscode.Range(l, idx, l, prefix.length));
        }
    });
}
