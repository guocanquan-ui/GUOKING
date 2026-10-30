/**
 * Client half of the Quick Notes bundle.
 *
 * Registers one `sidebar.panellist` entry (the icon in the left column) and the
 * `main` panel its id addresses. Notes are plugin-owned scratch data: they stay
 * in this browser's localStorage, so nothing here touches the Session log.
 */
window.__ModuleLoader__.load({
  id: '@local/quick-notes',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'quick-notes';
    const STORAGE_KEY = 'dsh.quick-notes.v1';
    const PANEL_ID = 'quick-notes';

    const CSS = `
.dsh-qn-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  border-top-left-radius: var(--dsh-windows-content-radius, 0);
}
.dsh-qn-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: var(--dsh-frame-top-clearance, 48px) 24px 16px
    calc(24px + var(--dsh-frame-leading-clearance, 0px));
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dsh-qn-heading { min-width: 0; }
.dsh-qn-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-qn-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-label-secondary);
}
.dsh-qn-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 32px;
}
.dsh-qn-inner {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}
.dsh-qn-composer {
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 12px;
  padding: 12px;
}
.dsh-qn-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 68px;
  max-height: 240px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
}
.dsh-qn-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dsh-qn-input:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.dsh-qn-composer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.dsh-qn-hint {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-qn-btn {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.dsh-qn-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-qn-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-qn-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-qn-btn-primary {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.dsh-qn-iconbtn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-qn-iconbtn:hover {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-state-error-primary);
}
.dsh-qn-iconbtn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-qn-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-qn-note {
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 10px;
  padding: 12px 14px;
}
.dsh-qn-note:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-qn-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
}
.dsh-qn-note-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}
.dsh-qn-time {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-qn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 16px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.dsh-qn-empty-title { font-size: 14px; color: var(--dsw-alias-label-primary); }
.dsh-qn-empty-hint { font-size: 12px; }
`;

    function isNote(value) {
      return (
        !!value &&
        typeof value === 'object' &&
        typeof value.id === 'string' &&
        typeof value.text === 'string' &&
        typeof value.createdAt === 'number'
      );
    }

    function readNotes() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isNote);
      } catch {
        return [];
      }
    }

    function writeNotes(notes) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      } catch {
        /* Storage unavailable or full: the in-memory list still works. */
      }
    }

    function makeId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function createIcon(size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', {
          x: 4,
          y: 3.5,
          width: 16,
          height: 17,
          rx: 3,
          stroke: 'currentColor',
          strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M8.5 8.75h7M8.5 12.25h7M8.5 15.75h4.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(
          () => ctx.locale.register(NS, 'en', {
            nav: 'Quick Notes',
            panelTitle: 'Quick Notes',
            savedLocally: 'Saved in this browser',
            unit: 'notes',
            placeholder: 'Write a note…',
            add: 'Add note',
            hint: 'Ctrl+Enter to add',
            emptyTitle: 'No notes yet',
            emptyHint: 'Write one above and add it.',
            delete: 'Delete note',
          }),
          'quick-notes: en dictionary',
        );

        ctx.effect(
          () => ctx.locale.register(NS, 'zh', {
            nav: '随手记',
            panelTitle: '随手记',
            savedLocally: '保存在此浏览器',
            unit: '条便签',
            placeholder: '写点什么…',
            add: '添加',
            hint: 'Ctrl+Enter 添加',
            emptyTitle: '还没有便签',
            emptyHint: '在上方写一条并添加。',
            delete: '删除便签',
          }),
          'quick-notes: zh dictionary',
        );

        function readActiveLocale() {
          try {
            const locale = ctx.get('locale');
            const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null;
            return snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en';
          } catch {
            return 'en';
          }
        }

        function formatTime(timestamp) {
          try {
            return new Intl.DateTimeFormat(readActiveLocale(), {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(timestamp));
          } catch {
            return new Date(timestamp).toLocaleString();
          }
        }

        function useLocaleRevision() {
          const [, bump] = React.useState(0);
          React.useEffect(() => {
            const locale = ctx.get('locale');
            if (!locale || typeof locale.subscribe !== 'function') return undefined;
            return locale.subscribe(() => bump((value) => value + 1));
          }, []);
        }

        function QuickNotesPanel() {
          useLocaleRevision();
          const [notes, setNotes] = React.useState(readNotes);
          const [draft, setDraft] = React.useState('');

          const commit = (next) => {
            setNotes(next);
            writeNotes(next);
          };

          const addNote = () => {
            const text = draft.trim();
            if (!text) return;
            commit([{ id: makeId(), text, createdAt: Date.now() }, ...notes]);
            setDraft('');
          };

          const removeNote = (id) => {
            commit(notes.filter((note) => note.id !== id));
          };

          const onKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              addNote();
            }
          };

          const subtitle = notes.length
            ? `${notes.length} ${t('unit')} · ${t('savedLocally')}`
            : t('savedLocally');

          return h(
            'div',
            { className: 'dsh-qn-root' },
            h('style', { key: 'quick-notes-style' }, CSS),
            h(
              'header',
              { className: 'dsh-qn-header' },
              h(
                'div',
                { className: 'dsh-qn-heading' },
                h('h1', { className: 'dsh-qn-title' }, t('panelTitle')),
                h('p', { className: 'dsh-qn-subtitle' }, subtitle),
              ),
            ),
            h(
              'div',
              { className: 'dsh-qn-body' },
              h(
                'div',
                { className: 'dsh-qn-inner' },
                h(
                  'div',
                  { className: 'dsh-qn-composer' },
                  h('textarea', {
                    className: 'dsh-qn-input',
                    value: draft,
                    placeholder: t('placeholder'),
                    'aria-label': t('placeholder'),
                    spellCheck: false,
                    onChange: (event) => setDraft(event.target.value),
                    onKeyDown,
                  }),
                  h(
                    'div',
                    { className: 'dsh-qn-composer-row' },
                    h('span', { className: 'dsh-qn-hint' }, t('hint')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-qn-btn dsh-qn-btn-primary',
                        onClick: addNote,
                        disabled: draft.trim().length === 0,
                      },
                      t('add'),
                    ),
                  ),
                ),
                notes.length === 0
                  ? h(
                      'div',
                      { className: 'dsh-qn-empty' },
                      createIcon(28),
                      h('div', { className: 'dsh-qn-empty-title' }, t('emptyTitle')),
                      h('div', { className: 'dsh-qn-empty-hint' }, t('emptyHint')),
                    )
                  : h(
                      'ul',
                      { className: 'dsh-qn-list' },
                      notes.map((note) =>
                        h(
                          'li',
                          { className: 'dsh-qn-note', key: note.id },
                          h('p', { className: 'dsh-qn-text' }, note.text),
                          h(
                            'div',
                            { className: 'dsh-qn-note-foot' },
                            h(
                              'span',
                              { className: 'dsh-qn-time' },
                              formatTime(note.createdAt),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsh-qn-iconbtn',
                                onClick: () => removeNote(note.id),
                                title: t('delete'),
                                'aria-label': t('delete'),
                              },
                              h(
                                'svg',
                                {
                                  width: 14,
                                  height: 14,
                                  viewBox: '0 0 24 24',
                                  fill: 'none',
                                  'aria-hidden': 'true',
                                  focusable: 'false',
                                },
                                h('path', {
                                  d: 'M6 6l12 12M18 6L6 18',
                                  stroke: 'currentColor',
                                  strokeWidth: 2,
                                  strokeLinecap: 'round',
                                }),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
              ),
            ),
          );
        }

        function QuickNotesIcon(props) {
          const size =
            typeof props.size === 'number' && props.size > 0 ? props.size : 18;
          return createIcon(size);
        }

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 20,
                  label: () => t('nav'),
                },
                QuickNotesIcon,
              ),
            ),
          'quick-notes: sidebar entry',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: PANEL_ID }, QuickNotesPanel),
            ),
          'quick-notes: main panel',
        );
      },
    };
  },
});
