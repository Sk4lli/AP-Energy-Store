// In-page text console: command input plus the log (info, warn, error, chat).

import { LANGUAGES, t } from './i18n.js';
import { clamp, escapeHtml } from './util.js';

const MAX_LINES = 500;

export class Console {
    /**
     * handlers: { connect, disconnect, status, balance, page, pages, buy, locations, lang, refresh }
     * Every handler gets (args, console) and may return a string (printed) or a promise of it.
     */
    constructor(root, handlers) {
        this.root = root;
        this.handlers = handlers;
        this.output = root.querySelector('[data-console-output]');
        this.input = root.querySelector('[data-console-input]');
        this.form = root.querySelector('[data-console-form]');
        this.clearButton = root.querySelector('[data-console-clear]');
        this.history = [];
        this.historyIndex = -1;
        this.filter = 'all';
        this.lines = 0;
        this._bind();
    }

    _bind() {
        this.form?.addEventListener('submit', (event) => {
            event.preventDefault();
            this.submit();
        });
        this.input?.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                this._navigateHistory(-1);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                this._navigateHistory(1);
            }
        });
        this.clearButton?.addEventListener('click', () => this.clear());
        for (const button of this.root.querySelectorAll('[data-console-level]')) {
            button.addEventListener('click', () => {
                this.filter = button.dataset.consoleLevel;
                for (const other of this.root.querySelectorAll('[data-console-level]')) {
                    other.classList.toggle('is-active', other === button);
                }
                this.output?.classList.toggle('hide-chat', this.filter === 'log');
                this.output?.classList.toggle('hide-log', this.filter === 'chat');
            });
        }
    }

    _navigateHistory(delta) {
        if (this.history.length === 0) {
            return;
        }
        if (this.historyIndex === -1) {
            this.historyIndex = this.history.length;
        }
        this.historyIndex = clamp(this.historyIndex + delta, 0, this.history.length);
        this.input.value = this.history[this.historyIndex] ?? '';
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }

    /** Adds a line. level: info | warn | error | chat | debug | cmd */
    write(text, level = 'info') {
        if (!this.output) {
            return;
        }
        const atBottom = this.output.scrollTop + this.output.clientHeight >= this.output.scrollHeight - 24;
        const time = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = `console-line console-line--${level}`;
        const label = level === 'cmd' ? '>' : level.toUpperCase().slice(0, 4);
        line.innerHTML = `<span class="console-line__time">${escapeHtml(time)}</span>`
            + `<span class="console-line__level">${escapeHtml(label)}</span>`
            + `<span class="console-line__text">${escapeHtml(text)}</span>`;
        this.output.append(line);
        this.lines += 1;
        while (this.lines > MAX_LINES && this.output.firstElementChild) {
            this.output.firstElementChild.remove();
            this.lines -= 1;
        }
        if (atBottom) {
            this.output.scrollTop = this.output.scrollHeight;
        }
    }

    clear() {
        if (this.output) {
            this.output.replaceChildren();
        }
        this.lines = 0;
    }

    focus() {
        this.input?.focus();
    }

    async submit() {
        const raw = this.input?.value ?? '';
        const command = raw.trim();
        this.input.value = '';
        if (!command) {
            return;
        }
        this.history.push(command);
        if (this.history.length > 100) {
            this.history.shift();
        }
        this.historyIndex = -1;
        this.write(command, 'cmd');
        try {
            await this.run(command);
        } catch (error) {
            this.write(String(error?.message ?? error), 'error');
        }
    }

    /** Runs a command string, e.g. from the console input or a test. */
    async run(rawCommand) {
        const parts = rawCommand.match(/"[^"]*"|\S+/g) ?? [];
        const name = (parts.shift() ?? '').toLowerCase();
        const args = parts.map((part) => part.replace(/^"|"$/g, ''));
        if (!name) {
            return;
        }
        const handler = this.handlers[name];
        if (typeof handler !== 'function') {
            this.write(t('console.unknown', { cmd: name }), 'warn');
            return;
        }
        const result = await handler(args, this);
        if (typeof result === 'string' && result.length > 0) {
            this.write(result, 'info');
        }
    }

    printHelp() {
        for (const line of t('console.help').split('\n')) {
            this.write(line, 'info');
        }
    }

    languageList() {
        return LANGUAGES.map((lang) => lang.code).join(', ');
    }
}
