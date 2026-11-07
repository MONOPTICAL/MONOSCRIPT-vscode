import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildPage, guideTitle } from './guide/page';
import { RenderedGuide, renderGuide, sectionId } from './guide/render';
import { GUIDE_SECTIONS, GuideLanguage } from './guide/sections';

// Панель справочника по языку. Сама страница собирается в guide/page.ts.

type Message =
    | { type: 'openCode'; code: string }
    | { type: 'copy'; code: string }
    | { type: 'language'; lang: GuideLanguage }
    | { type: 'external'; href: string }
    | { type: 'section'; id: string };

export class GuidePanel {
    private static current: GuidePanel | undefined;
    private readonly cache = new Map<GuideLanguage, RenderedGuide>();
    private lang: GuideLanguage;

    /** Открыть справочник; `section` — ключ из GUIDE_SECTIONS или якорь заголовка. */
    static show(context: vscode.ExtensionContext, section?: string): void {
        if (GuidePanel.current) {
            GuidePanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
            if (section) { GuidePanel.current.scrollTo(section); }
            return;
        }
        const panel = vscode.window.createWebviewPanel('monoscriptGuide', 'MONOSCRIPT', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            enableFindWidget: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
        });
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'logo.svg');
        GuidePanel.current = new GuidePanel(context, panel, section);
    }

    /** Заголовки обоих языков для быстрого поиска раздела (команда «Search Language Guide»). */
    static headings(context: vscode.ExtensionContext): { lang: GuideLanguage; level: number; text: string; id: string }[] {
        const lang = preferredLanguage();
        return load(context, lang).headings.filter(h => h.level >= 2).map(h => ({ ...h, lang }));
    }

    private constructor(private readonly context: vscode.ExtensionContext, private readonly panel: vscode.WebviewPanel, section?: string) {
        this.lang = preferredLanguage();
        panel.onDidDispose(() => { GuidePanel.current = undefined; });
        panel.webview.onDidReceiveMessage((m: Message) => this.onMessage(m));
        this.render(section);
    }

    private guide(): RenderedGuide {
        let g = this.cache.get(this.lang);
        if (!g) { g = load(this.context, this.lang); this.cache.set(this.lang, g); }
        return g;
    }

    private resolve(section: string | undefined): string | undefined {
        if (!section) { return undefined; }
        if (GUIDE_SECTIONS[section]) { return sectionId(this.guide(), section, this.lang); }
        return section;
    }

    private render(section?: string): void {
        this.panel.title = guideTitle(this.lang);
        this.panel.webview.html = buildPage(this.guide(), this.lang, this.resolve(section));
    }

    private scrollTo(section: string): void {
        const id = this.resolve(section);
        if (id) { this.panel.webview.postMessage({ type: 'scroll', id }); }
    }

    private async onMessage(m: Message): Promise<void> {
        switch (m.type) {
            case 'openCode': {
                const doc = await vscode.workspace.openTextDocument({ language: 'ms', content: m.code + '\n' });
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                break;
            }
            case 'copy':
                await vscode.env.clipboard.writeText(m.code);
                break;
            case 'language':
                this.lang = m.lang;
                this.render();
                break;
            case 'external':
                if (/^https?:\/\//.test(m.href)) { vscode.env.openExternal(vscode.Uri.parse(m.href)); }
                break;
        }
    }
}

function load(context: vscode.ExtensionContext, lang: GuideLanguage): RenderedGuide {
    const file = vscode.Uri.joinPath(context.extensionUri, 'docs', `language.${lang}.md`).fsPath;
    return renderGuide(fs.readFileSync(file, 'utf8'));
}

export function preferredLanguage(): GuideLanguage {
    const setting = vscode.workspace.getConfiguration('monoscript').get<string>('guide.language', 'auto');
    if (setting === 'ru' || setting === 'en') { return setting; }
    return vscode.env.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
