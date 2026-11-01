import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';
import { compileString } from 'sass';
import postcss from 'postcss';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const styles = (path: string) =>
  path.endsWith('.vue')
    ? parse(read(path))
        .descriptor.styles.map((style) => style.content)
        .join('\n')
    : read(path);
const css = (path: string) =>
  postcss.parse(compileString(styles(path), { silenceDeprecations: ['legacy-js-api'] }).css);
const declaration = (path: string, selector: string, property: string) => {
  let value: string | undefined;
  css(path).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls(property, (decl) => {
        value = decl.value;
      });
    }
  });
  return value?.replace(/\s*\/\s*/g, ' / ');
};
const page = 'pages/MessagingPage.vue';
const group = 'components/suites/GroupChatWindow.vue';
const broadcast = 'components/suites/BroadcastChatWindow.vue';
const list = 'components/messaging/ChatListItem.vue';
const shared = 'css/messaging-shared.scss';
const accent = 'var(--m-accent-rgb, 255 0 0)';

describe('messaging decorative accent', () => {
  it.each([
    [page, '.vault-filter-chip.is-active', 'border-color'],
    [page, '.vault-offline-badge', 'color'],
    [page, '.vault-reply-bar-name', 'color'],
    [page, '.vault-reaction-chip--mine', 'border-color'],
    [page, '.vault-audio-fill', 'background'],
    [page, '.vault-drop-icon', 'color'],
    [group, '.vault-reply-bar-icon', 'color'],
    [group, '.vault-blob-download-btn', 'color'],
    [group, '.vault-audio-fill', 'background'],
    [group, '.group-drop-icon', 'color'],
    [broadcast, '.mourn-broadcast-avatar', 'color'],
    [list, '.vault-chat-item--active', 'border-left-color'],
    [list, '.vault-chat-item--anchored', 'border-left-color'],
    [list, '.vault-chat-item--unread', 'border-left-color'],
    [shared, '.vault-msg-bubble--sent', 'background'],
    [shared, '.vault-reply-ref-name', 'color'],
    [shared, '.vault-reaction-chip--mine', 'background'],
    ['components/suites/GroupSettingsModal.vue', '.suite-role-badge--owner', 'border-color'],
  ])('%s %s %s follows the accent', (path, selector, property) => {
    expect(declaration(path, selector, property)).toContain(accent);
  });

  it('preserves the exact dark-red search and own-message variants, including alpha', () => {
    expect(
      declaration(shared, '.vault-msg--search-highlight .vault-msg-bubble', 'background'),
    ).toBe(`color-mix(in srgb, rgb(${accent}) 40%, black)`);
    for (const [path, selector] of [
      [group, '.group-message--own .group-message-bubble'],
      [broadcast, '.vault-msg--sent .vault-msg-bubble'],
    ] as const) {
      expect(declaration(path, selector, 'background')).toBe(
        `color-mix(in srgb, rgb(${accent} / 0.55) 66.6666666667%, color-mix(in srgb, black 55%, transparent))`,
      );
    }
    expect(styles(shared)).toContain(
      `color-mix(in srgb, rgb(${accent} / 0.3) 40%, color-mix(in srgb, black 30%, transparent))`,
    );
    expect(styles(shared)).not.toMatch(/#660000|rgba\(102, 0, 0/);
    for (const path of [group, broadcast, shared]) {
      expect(styles(path)).not.toMatch(/rgb\(0 0 0 \/ 0\.(?:55|3)\)/);
    }
  });

  it('preserves tinted mentions and hover reds instead of flattening them to pure red', () => {
    expect(declaration(group, '.group-message-mention', 'color')).toBe(
      `color-mix(in srgb, rgb(${accent}) 76.862745098%, white)`,
    );
    expect(declaration(page, '.vault-relink-btn:hover', 'color')).toBe(
      `color-mix(in srgb, rgb(${accent}) 73.3333333333%, white)`,
    );
  });

  it('keeps legacy crimson picker and muted pull colors until a custom theme/accent is active', () => {
    const source = styles(page);
    expect(source).toContain('var(--vault-picker-accent-rgb, 220 20 60)');
    // A fallback that is itself a var() makes the whole declaration invalid
    // when that var is missing (CSS re-parses the substituted value), so the
    // hover border silently kept its non-hover colour. Keep a literal.
    expect(source).toContain('var(--vault-picker-border, rgb(255 0 0))');
    expect(source).not.toContain('var(--crimson)');
    expect(source).toContain('var(--vault-pull-muted, #7a3b36)');
    expect(source).toContain(":is(:not([data-theme='crimson']), [data-theme-accent])");
    expect(source).toContain('--vault-picker-accent-rgb: var(--m-accent-rgb, 255 0 0)');
    expect(source).toContain('--vault-picker-border: rgb(var(--m-accent-rgb, 255 0 0))');
  });

  it('does not recolor semantic errors, security warnings, expiry urgency or destructive actions', () => {
    for (const selector of [
      '.vault-signal-reject',
      '.vault-banner--danger',
      '.vault-banner-action--reject',
      '.vault-panel-action--danger',
      '.vault-modal-btn--danger',
      '.vault-ctx-item--danger',
      '.vault-transfer-err',
      '.vault-expired-title',
      '.suite-ctx-item.suite-ctx-danger span',
    ]) {
      expect(declaration(page, selector, 'color')).toBe('#ff0000');
    }
    expect(declaration(page, '.vault-msg--failed', 'background')).toBe('rgba(220, 20, 60, 0.1)');
    expect(declaration(page, '.vault-msg-bubble--unsafe', 'border-color')).toBe(
      'rgba(255, 0, 0, 0.5)',
    );
    expect(declaration(list, '.vault-chat-timer--urgent', 'color')).toBe('#ff0000');
    expect(declaration(group, '.group-context-menu > .group-context-danger', 'color')).toBe('#f44');
    expect(
      declaration(
        'components/messaging/MessageContextMenu.vue',
        '.vault-ctx-item--danger',
        'color',
      ),
    ).toBe('#f00');
  });

  it('compiles the scoped SFCs and keeps the legacy-color gate on the actual page root', () => {
    for (const path of [page, group, broadcast, list, 'components/suites/GroupSettingsModal.vue']) {
      const { descriptor, errors } = parse(read(path));
      expect(errors).toEqual([]);
      const template = compileTemplate({
        source: descriptor.template?.content ?? '',
        filename: path,
        id: 'data-v-messaging',
      });
      expect(template.errors).toEqual([]);
      const compiled = compileStyle({
        source: styles(path),
        filename: path,
        id: 'data-v-messaging',
        scoped: true,
        preprocessLang: 'scss',
      });
      expect(compiled.errors).toEqual([]);
      if (path === page) {
        expect(compiled.code).toContain(
          "html[data-client-theme='on']:is(:not([data-theme='crimson']), [data-theme-accent]) .messaging-page-root",
        );
        expect(compiled.code).not.toContain(':global(');
      }
    }
  });

  it('retains Quasar red for default loading indicators but themes them when opted in', () => {
    const template = parse(read(page)).descriptor.template?.content ?? '';
    expect(template.match(/color="red"/g)).toHaveLength(3);
    const selector =
      ":global(html[data-client-theme='on']:is(:not([data-theme='crimson']), [data-theme-accent]) .messaging-page-root :is(.vault-accent-spinner, .vault-accent-progress))";
    expect(declaration(page, selector, 'color')).toBe(`rgb(${accent})`);
    expect(styles(page)).toContain('color: rgb(var(--m-accent-rgb, 255 0 0)) !important;');
    expect(styles(page)).not.toContain('#f44336');
    expect(styles(page)).toContain('$vault-danger-lo: rgba(255, 0, 0, 0.12)');
    expect(styles(page)).toContain('$vault-danger-faint: rgba(255, 0, 0, 0.08)');
  });

  it('has no unclassified decorative red literals left in the audited styles', () => {
    const red =
      /#(?:ff0000|f00|ff4444|ff3b3b|660000|7a3b36|f44336|f44|ff5252|cc3333)\b|rgba?\((?:255|220|170|102),\s*(?:0|20),\s*(?:0|60),/i;
    for (const path of [
      page,
      group,
      broadcast,
      list,
      shared,
      'components/suites/GroupSettingsModal.vue',
      'components/messaging/MessageContextMenu.vue',
      'components/messaging/MessageQuickActions.vue',
    ]) {
      css(path).walkRules((rule) => {
        rule.walkDecls((decl) => {
          if (!red.test(decl.value)) return;
          const semantic =
            /danger|unsafe|failed|reject|expired|urgent|severed|vault-banner-action|vault-health-bar-fill|vault-transfer-err|group-leave-title/.test(
              rule.selector,
            );
          // var(--vault-picker-border, rgb(255 0 0)): the picker border token with
      // a literal legacy-crimson fallback (previously a nested var() that made
      // the whole declaration invalid whenever the token was missing).
      const legacyFallback = /var\(--vault-(?:pull-muted|loading-accent|picker-border),/.test(
        decl.value,
      );
          expect(
            semantic || legacyFallback,
            `${path}: ${rule.selector} { ${decl.prop}: ${decl.value} }`,
          ).toBe(true);
        });
      });
    }
  });

  it('uses the active children, not the removed ChatMessage renderer', () => {
    const source = read(page);
    for (const name of [
      'ChatListItem',
      'MessageReplyReference',
      'MessageReactions',
      'MessageQuickActions',
      'MessageContextMenu',
      'GroupChatWindow',
      'BroadcastChatWindow',
      'GroupSettingsModal',
    ]) {
      expect(source).toContain(`import ${name} from`);
    }
    expect(source).not.toContain('import ChatMessage from');
    expect(read('components/messaging/MessageReactions.vue')).toContain(
      'vault-reaction-chip--mine',
    );
    expect(read('components/messaging/MessageReplyReference.vue')).toContain(
      'vault-reply-ref-name',
    );
  });

  it('leaves custom-theme bubble/send overrides authoritative and excludes unsafe/failed bubbles', () => {
    const overrides = read('css/theme-surfaces.scss');
    expect(overrides).toContain(
      '.vault-msg-bubble--sent:not(.vault-msg-bubble--unsafe):not(.vault-msg-bubble--failed)',
    );
    expect(overrides).toContain('background: rgb(var(--m-sendBg-rgb)) !important');
    for (const path of [page, shared]) {
      expect(declaration(path, '.vault-msg-bubble--sent', 'background')).toBe(
        `rgb(${accent} / 0.06)`,
      );
    }
  });
});
