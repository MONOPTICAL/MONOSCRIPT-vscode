import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('MONOSCRIPT extension is active!');

    const provideCustomEnter = vscode.commands.registerTextEditorCommand('ms.customEnter', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) => {
        const document = textEditor.document;
        const position = textEditor.selection.active;
        const currentLine = document.lineAt(position.line);
        const lineText = currentLine.text;

        /*
        console.log(`--- Custom Enter Triggered ---`);
        console.log(`Current Line Text: "${lineText}"`);
        console.log(`Cursor Position: Line ${position.line}, Char ${position.character}`);
        */

        let currentIndentPrefix = "";
        const indentMatchResult = lineText.match(/^((?:\|\s\s\s)*)/);
        if (indentMatchResult && indentMatchResult[1]) {
            currentIndentPrefix = indentMatchResult[1];
        }

        //console.log(`Determined currentIndentPrefix: "${currentIndentPrefix}"`);

        let addNewIndentLevel = false;
        
        let lineContentAfterPrefix = lineText;
        if (currentIndentPrefix.length > 0 && lineText.startsWith(currentIndentPrefix)) {
            lineContentAfterPrefix = lineText.substring(currentIndentPrefix.length);
        }
        
        const trimmedLineText = lineContentAfterPrefix.trim(); 

        //console.log(`Trimmed Line Text (for regex): "${trimmedLineText}"`);

        const functionDeclarationRegex = /^\s*\[.+?\]\s*\w+\s*\(.*?\)\s*(@\w+\s*)*$/;
        const controlFlowRegex = /^\s*(if|for|while)(\s+\(.*\)|.*)?\s*(@\w+\s*)*$/;
        const elseOnlyRegex = /^\s*else\s*(@\w+\s*)*$/;
        const lambdaDeclarationRegex = /^\s*\[.+?\]\s*\(.*?\)\s*:\s*(@\w+\s*)*$/;
        const structDeclarationRegex = /^\s*\[struct\]\s*\w+\s*(@\w+\s*)*$/;

        const isFunction = functionDeclarationRegex.test(trimmedLineText);
        const isControlFlow = controlFlowRegex.test(trimmedLineText);
        const isElseOnly = elseOnlyRegex.test(trimmedLineText);
        const isLambda = lambdaDeclarationRegex.test(trimmedLineText);
        const isStruct = structDeclarationRegex.test(trimmedLineText);

        /*
        console.log(`Regex Test Results:`);
        console.log(`  isFunction: ${isFunction}`);
        console.log(`  isControlFlow: ${isControlFlow}`);
        console.log(`  isElseOnly: ${isElseOnly}`);
        console.log(`  isLambda: ${isLambda}`);
        console.log(`  isStruct: ${isStruct}`);
        */

        if (isFunction || isControlFlow || isElseOnly || isLambda || isStruct) {
            addNewIndentLevel = true;
        }
        
        //console.log(`addNewIndentLevel: ${addNewIndentLevel}`);

        let newIndentStringOnNextLine = currentIndentPrefix;
        if (addNewIndentLevel) {
            newIndentStringOnNextLine += '|   ';
        }
        //console.log(`newIndentStringOnNextLine: "${newIndentStringOnNextLine}"`);
        
        const textToInsert = '\n' + newIndentStringOnNextLine;
        
        //console.log(`textToInsert: "${textToInsert.replace('\n', '\\n')}"`); 

        edit.insert(position, textToInsert);

        const newPositionLine = position.line + 1;
        const newPositionCharacter = newIndentStringOnNextLine.length; 
        const newPos = new vscode.Position(newPositionLine, newPositionCharacter);

        //console.log(`New Cursor Position: Line ${newPos.line}, Char ${newPos.character}`);

        textEditor.selection = new vscode.Selection(newPos, newPos);
        
        //console.log(`--- Custom Enter End ---`);
    });

    const provideCustomBackspace = vscode.commands.registerTextEditorCommand('ms.customBackspace', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) => {
        const document = textEditor.document;
        const selection = textEditor.selection;

        if (!selection.isEmpty) {
            vscode.commands.executeCommand('deleteLeft');
            return;
        }

        const position = selection.active;
        const currentLine = document.lineAt(position.line);
        const lineText = currentLine.text;

        const pipeIndentRegex = /^((\s*\|\s*)+)$/;
        const match = lineText.match(pipeIndentRegex);

        if (match && position.character === lineText.length) {
            let textToRemove = "";
            if (lineText.endsWith("|   ")) {
                textToRemove = "|   ";
            } else if (lineText.endsWith("| ")) { 
                textToRemove = "| ";
            } else if (lineText.endsWith("|")) {
                textToRemove = "|";
            }


            if (textToRemove) {
                const startDeletePos = new vscode.Position(position.line, lineText.length - textToRemove.length);
                const endDeletePos = new vscode.Position(position.line, lineText.length);
                const rangeToRemove = new vscode.Range(startDeletePos, endDeletePos);
                edit.delete(rangeToRemove);
            } else {
                vscode.commands.executeCommand('deleteLeft');
            }
        } else {
            vscode.commands.executeCommand('deleteLeft');
        }
    });

    context.subscriptions.push(provideCustomEnter, provideCustomBackspace);
}

export function deactivate() {}