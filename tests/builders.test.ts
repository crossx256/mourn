import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { builderCategories, buildersIntro, signalDocsUrl } from '../src/content/builders';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Builders page', () => {
  it('keeps editable contributor lists empty without inventing names', () => {
    expect(builderCategories.map((category) => category.id)).toEqual([
      'code', 'design', 'visual-identity', 'sound',
    ]);
    for (const category of builderCategories) {
      expect(category.contributors).toEqual([]);
      expect(category.title).toBeTruthy();
      expect(category.description).toBeTruthy();
    }
    expect(buildersIntro).toContain('Mourn Team');
    expect(buildersIntro).toContain('logos, notification sounds, and Mourn sounds');
  });

  it('compiles with populated and empty credit branches using escaped interpolation', () => {
    const page = source('src/pages/BuildersPage.vue');
    const { descriptor, errors } = parse(page);
    expect(errors).toEqual([]);
    expect(() => compileScript(descriptor, { id: 'builders-test', inlineTemplate: true })).not.toThrow();
    expect(page).toContain('v-for="category in builderCategories"');
    expect(page).toContain('v-if="category.contributors.length"');
    expect(page).toContain('{{ contributor.name }}');
    expect(page).toContain('{{ contributor.contribution }}');
    expect(page).toContain('Individual contributor credits will be added here.');
    expect(page).not.toContain('v-html');
  });

  it('separates third-party credits and qualifies Signal inspiration', () => {
    const page = source('src/pages/BuildersPage.vue');
    expect(signalDocsUrl).toBe('https://signal.org/docs/');
    expect(page).toContain(':href="signalDocsUrl"');
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain('THIRD_PARTY.md');
    expect(page).toContain('third-party fonts, libraries, and other dependencies');
    expect(page).toContain('not affiliated with or endorsed by Signal');
    expect(page).toContain('interoperability with Signal or a security audit by Signal');
  });

  it('registers a public static route before the profile catch-all', () => {
    const routes = source('src/router/routes.ts');
    expect(routes).toContain("{ path: '/builders', component: () => import('pages/BuildersPage.vue') }");
    expect(routes.indexOf("path: '/builders'")).toBeLessThan(routes.indexOf("path: '/:username'"));
  });

  it('links from both drawers and the web footer and labels the route', () => {
    const layout = source('src/layouts/MainLayout.vue');
    expect(layout).toContain('to="/builders" @click="closeMasterNavigator()"');
    expect(layout).toContain('to="/builders" @click="nav.closeDrawer()"');
    expect(layout).toContain('<router-link to="/builders">builders</router-link>');
    expect(layout).toContain("'/builders': 'builders'");
  });
});
