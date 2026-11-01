/**
 * Platform recognition for profile links.
 *
 * ONE table, three consumers: the editor's URL box, the classic icon row (one link per
 * recognised platform plus exactly one unrecognised `custom` URL), and the v2 link list
 * (the same "one unrecognised link" rule). The rule is enforced here AND again on the
 * server, which is authoritative — see mourn.bio/utils/sanitize.js.
 *
 * The same keys/domains live in mourn.bio/utils/sanitize.js as SOCIAL_PLATFORM_DOMAINS.
 * There is no shared module between the ESM client and the CommonJS server, so
 * mourn.bio/test/socialPlatforms.test.js asserts the two never drift.
 */

import { shallowRef } from 'vue';
import type { ProfileLinkIcon } from 'src/types/profile';

export const SOCIAL_DOMAINS: Record<string, readonly string[]> = {
  twitter: ['twitter.com', 'x.com'],
  discord: ['discord.com', 'discord.gg'],
  telegram: ['t.me', 'telegram.me'],
  instagram: ['instagram.com'],
  github: ['github.com'],
  youtube: ['youtube.com', 'youtu.be'],
  twitch: ['twitch.tv'],
  tiktok: ['tiktok.com'],
  spotify: ['open.spotify.com'],
  roblox: ['roblox.com'],
  steam: ['steamcommunity.com', 's.team', 'steampowered.com'],
  pinterest: ['pinterest.com', 'pinterest.ca', 'pinterest.co.uk', 'pinterest.de', 'pinterest.fr'],
  vsco: ['vsco.co'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  linkedin: ['linkedin.com', 'lnkd.in'],
  reddit: ['reddit.com', 'redd.it'],
  snapchat: ['snapchat.com'],
  whatsapp: ['wa.me', 'whatsapp.com', 'chat.whatsapp.com'],
  signal: ['signal.me', 'signal.org'],
  bluesky: ['bsky.app'],
  threads: ['threads.net', 'threads.com'],
  mastodon: ['mastodon.social', 'mastodon.online', 'masto.ai', 'fosstodon.org'],
  nostr: ['njump.me', 'primal.net', 'snort.social'],
  matrix: ['matrix.to'],
  guilded: ['guilded.gg'],
  line: ['line.me'],
  weibo: ['weibo.com'],
  bilibili: ['bilibili.com', 'space.bilibili.com'],
  vk: ['vk.com'],
  kick: ['kick.com'],
  rumble: ['rumble.com'],
  odysee: ['odysee.com'],
  patreon: ['patreon.com'],
  kofi: ['ko-fi.com'],
  buymeacoffee: ['buymeacoffee.com'],
  gofundme: ['gofundme.com'],
  paypal: ['paypal.me', 'paypal.com'],
  cashapp: ['cash.app'],
  venmo: ['venmo.com'],
  revolut: ['revolut.me', 'revolut.com'],
  bandcamp: ['bandcamp.com'],
  soundcloud: ['soundcloud.com'],
  applemusic: ['music.apple.com'],
  deezer: ['deezer.com'],
  lastfm: ['last.fm'],
  medium: ['medium.com'],
  substack: ['substack.com'],
  deviantart: ['deviantart.com'],
  behance: ['behance.net'],
  dribbble: ['dribbble.com'],
  artstation: ['artstation.com'],
  gitlab: ['gitlab.com'],
  bitbucket: ['bitbucket.org'],
  codeberg: ['codeberg.org'],
  itchio: ['itch.io'],
  epicgames: ['epicgames.com', 'store.epicgames.com'],
  playstation: ['playstation.com'],
  xbox: ['xbox.com'],
  nintendo: ['nintendo.com'],
  letterboxd: ['letterboxd.com'],
  trakt: ['trakt.tv'],
  myanimelist: ['myanimelist.net'],
  anilist: ['anilist.co'],
  goodreads: ['goodreads.com'],
  notion: ['notion.so', 'notion.site'],
  figma: ['figma.com'],
  shopify: ['myshopify.com', 'shopify.com'],
  etsy: ['etsy.com'],
  ebay: ['ebay.com'],
  discogs: ['discogs.com'],
  strava: ['strava.com'],
  tumblr: ['tumblr.com'],
  flickr: ['flickr.com'],
  opensea: ['opensea.io'],
  etherscan: ['etherscan.io'],
  mempool: ['mempool.space'],
  proton: ['proton.me', 'protonmail.com'],
  session: ['getsession.org'],
  simplex: ['simplex.chat'],
  messenger: ['messenger.com', 'm.me'],
  viber: ['viber.com', 'vb.me'],
  wechat: ['wechat.com'],
  qq: ['qq.com', 'im.qq.com'],
  kakao: ['kakao.com', 'open.kakao.com'],
  skype: ['skype.com', 'join.skype.com'],
  zoom: ['zoom.us'],
  threema: ['threema.ch'],
  wire: ['wire.com'],
  xing: ['xing.com'],
  quora: ['quora.com'],
  okru: ['ok.ru'],
  douyin: ['douyin.com'],
  gab: ['gab.com'],
  truthsocial: ['truthsocial.com'],
  bereal: ['bere.al'],
  vero: ['vero.co'],
  carrd: ['carrd.co'],
  beacons: ['beacons.ai'],
  linktree: ['linktr.ee'],
  wordpress: ['wordpress.com', 'wordpress.org'],
  blogger: ['blogspot.com'],
  wix: ['wix.com', 'wixsite.com'],
  squarespace: ['squarespace.com'],
  webflow: ['webflow.com', 'webflow.io'],
  ghost: ['ghost.io'],
  hashnode: ['hashnode.dev'],
  devto: ['dev.to'],
  stackoverflow: ['stackoverflow.com', 'stackexchange.com'],
  gumroad: ['gumroad.com'],
  opencollective: ['opencollective.com'],
  liberapay: ['liberapay.com'],
  codepen: ['codepen.io'],
  codesandbox: ['codesandbox.io'],
  replit: ['replit.com'],
  npm: ['npmjs.com'],
  docker: ['hub.docker.com'],
  huggingface: ['huggingface.co'],
  kaggle: ['kaggle.com'],
  leetcode: ['leetcode.com'],
  hackernews: ['news.ycombinator.com'],
  producthunt: ['producthunt.com'],
  vimeo: ['vimeo.com'],
  dailymotion: ['dailymotion.com'],
  crunchyroll: ['crunchyroll.com'],
  tvtime: ['tvtime.com'],
  nebula: ['nebula.tv'],
  tidal: ['tidal.com'],
  audiomack: ['audiomack.com'],
  mixcloud: ['mixcloud.com'],
  beatport: ['beatport.com'],
  genius: ['genius.com'],
  reverbnation: ['reverbnation.com'],
  bandlab: ['bandlab.com'],
  unsplash: ['unsplash.com'],
  '500px': ['500px.com'],
  pixiv: ['pixiv.net'],
  webtoons: ['webtoons.com'],
  redbubble: ['redbubble.com'],
  society6: ['society6.com'],
  inprnt: ['inprnt.com'],
  teepublic: ['teepublic.com'],
  amazon: ['amazon.com', 'amzn.to'],
  aliexpress: ['aliexpress.com'],
  bigcartel: ['bigcartel.com'],
  depop: ['depop.com'],
  vinted: ['vinted.com'],
  grailed: ['grailed.com'],
  poshmark: ['poshmark.com'],
  mercari: ['mercari.com'],
  stripe: ['stripe.com', 'buy.stripe.com'],
  squareup: ['squareup.com'],
  lemonsqueezy: ['lemonsqueezy.com'],
  wise: ['wise.com'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  kraken: ['kraken.com'],
  kucoin: ['kucoin.com'],
  bscscan: ['bscscan.com'],
  solscan: ['solscan.io'],
  rarible: ['rarible.com'],
  zora: ['zora.co'],
  mirror: ['mirror.xyz'],
  riotgames: ['riotgames.com'],
  leagueoflegends: ['leagueoflegends.com'],
  battlenet: ['blizzard.com', 'battle.net'],
  ea: ['ea.com'],
  ubisoft: ['ubisoft.com'],
  rockstargames: ['rockstargames.com'],
  minecraft: ['minecraft.net'],
  faceit: ['faceit.com'],
  speedrun: ['speedrun.com'],
  nexusmods: ['nexusmods.com'],
  moddb: ['moddb.com'],
  gamejolt: ['gamejolt.com'],
  boardgamegeek: ['boardgamegeek.com'],
  osu: ['osu.ppy.sh'],
  chesscom: ['chess.com'],
  lichess: ['lichess.org'],
  wattpad: ['wattpad.com'],
  ao3: ['archiveofourown.org'],
  royalroad: ['royalroad.com'],
  fanfiction: ['fanfiction.net'],
  storygraph: ['thestorygraph.com'],
  garmin: ['connect.garmin.com'],
  fitbit: ['fitbit.com'],
  myfitnesspal: ['myfitnesspal.com'],
  alltrails: ['alltrails.com'],
  komoot: ['komoot.com'],
  peloton: ['onepeloton.com'],
  untappd: ['untappd.com'],
  vivino: ['vivino.com'],
  yelp: ['yelp.com'],
  tripadvisor: ['tripadvisor.com'],
  airbnb: ['airbnb.com'],
  couchsurfing: ['couchsurfing.com'],
  upwork: ['upwork.com'],
  fiverr: ['fiverr.com'],
  calendly: ['calendly.com'],
  calcom: ['cal.com'],
  wellfound: ['wellfound.com'],
  crunchbase: ['crunchbase.com'],
  playstore: ['play.google.com'],
};

export const PLATFORM_ICONS: Record<string, string> = {
  twitter: 'fa-brands fa-x-twitter',
  discord: 'fa-brands fa-discord',
  telegram: 'fa-brands fa-telegram',
  instagram: 'fa-brands fa-instagram',
  github: 'fa-brands fa-github',
  youtube: 'fa-brands fa-youtube',
  twitch: 'fa-brands fa-twitch',
  tiktok: 'fa-brands fa-tiktok',
  spotify: 'fa-brands fa-spotify',
  roblox: 'mdi-gamepad-variant',
  steam: 'fa-brands fa-steam',
  pinterest: 'fa-brands fa-pinterest',
  vsco: 'mdi-camera',
  facebook: 'fa-brands fa-facebook',
  linkedin: 'fa-brands fa-linkedin',
  reddit: 'fa-brands fa-reddit-alien',
  snapchat: 'fa-brands fa-snapchat',
  whatsapp: 'fa-brands fa-whatsapp',
  signal: 'fa-brands fa-signal-messenger',
  bluesky: 'fa-brands fa-bluesky',
  threads: 'fa-brands fa-threads',
  mastodon: 'fa-brands fa-mastodon',
  nostr: 'mdi-incognito',
  matrix: 'mdi-chat',
  guilded: 'mdi-shield-lock',
  line: 'fa-brands fa-line',
  weibo: 'fa-brands fa-weibo',
  bilibili: 'mdi-video-vintage',
  vk: 'fa-brands fa-vk',
  kick: 'mdi-video',
  rumble: 'mdi-video',
  odysee: 'mdi-play-circle',
  patreon: 'fa-brands fa-patreon',
  kofi: 'mdi-coffee',
  buymeacoffee: 'mdi-coffee',
  gofundme: 'mdi-hand-coin',
  paypal: 'fa-brands fa-paypal',
  cashapp: 'mdi-cash-multiple',
  venmo: 'mdi-cash-multiple',
  revolut: 'mdi-bank',
  bandcamp: 'fa-brands fa-bandcamp',
  soundcloud: 'fa-brands fa-soundcloud',
  applemusic: 'fa-brands fa-apple',
  deezer: 'fa-brands fa-deezer',
  lastfm: 'fa-brands fa-lastfm',
  medium: 'fa-brands fa-medium',
  substack: 'fa-brands fa-substack',
  deviantart: 'fa-brands fa-deviantart',
  behance: 'fa-brands fa-behance',
  dribbble: 'fa-brands fa-dribbble',
  artstation: 'fa-brands fa-artstation',
  gitlab: 'fa-brands fa-gitlab',
  bitbucket: 'fa-brands fa-bitbucket',
  codeberg: 'mdi-code-tags',
  itchio: 'fa-brands fa-itch-io',
  epicgames: 'mdi-gamepad-variant',
  playstation: 'fa-brands fa-playstation',
  xbox: 'fa-brands fa-xbox',
  nintendo: 'mdi-gamepad-variant',
  letterboxd: 'mdi-movie-open',
  trakt: 'mdi-movie-open',
  myanimelist: 'mdi-book-open-page-variant',
  anilist: 'mdi-book-open-page-variant',
  goodreads: 'fa-brands fa-goodreads',
  notion: 'fa-brands fa-notion',
  figma: 'fa-brands fa-figma',
  shopify: 'fa-brands fa-shopify',
  etsy: 'fa-brands fa-etsy',
  ebay: 'fa-brands fa-ebay',
  discogs: 'mdi-music-circle',
  strava: 'fa-brands fa-strava',
  tumblr: 'fa-brands fa-tumblr',
  flickr: 'fa-brands fa-flickr',
  opensea: 'mdi-ethereum',
  etherscan: 'mdi-ethereum',
  mempool: 'mdi-currency-btc',
  proton: 'mdi-email',
  session: 'mdi-lock',
  simplex: 'mdi-lock',
  messenger: 'fa-brands fa-facebook-messenger',
  viber: 'fa-brands fa-viber',
  wechat: 'fa-brands fa-weixin',
  qq: 'mdi-qqchat',
  kakao: 'mdi-message-text',
  skype: 'fa-brands fa-skype',
  zoom: 'mdi-video',
  threema: 'mdi-shield-lock',
  wire: 'mdi-shield-lock',
  xing: 'fa-brands fa-xing',
  quora: 'fa-brands fa-quora',
  okru: 'fa-brands fa-odnoklassniki',
  douyin: 'mdi-music-note',
  gab: 'mdi-account-group',
  truthsocial: 'mdi-account-group',
  bereal: 'mdi-camera',
  vero: 'mdi-account-group',
  carrd: 'mdi-web',
  beacons: 'mdi-web',
  linktree: 'mdi-link-variant',
  wordpress: 'fa-brands fa-wordpress',
  blogger: 'fa-brands fa-blogger',
  wix: 'fa-brands fa-wix',
  squarespace: 'fa-brands fa-squarespace',
  webflow: 'mdi-web',
  ghost: 'mdi-web',
  hashnode: 'mdi-code-tags',
  devto: 'fa-brands fa-dev',
  stackoverflow: 'fa-brands fa-stack-overflow',
  gumroad: 'mdi-store',
  opencollective: 'mdi-hand-coin',
  liberapay: 'mdi-hand-coin',
  codepen: 'fa-brands fa-codepen',
  codesandbox: 'mdi-code-tags',
  replit: 'mdi-code-tags',
  npm: 'fa-brands fa-npm',
  docker: 'fa-brands fa-docker',
  huggingface: 'mdi-robot',
  kaggle: 'fa-brands fa-kaggle',
  leetcode: 'mdi-code-tags',
  hackernews: 'fa-brands fa-hacker-news',
  producthunt: 'fa-brands fa-product-hunt',
  vimeo: 'fa-brands fa-vimeo-v',
  dailymotion: 'fa-brands fa-dailymotion',
  crunchyroll: 'mdi-video',
  tvtime: 'mdi-movie-open',
  nebula: 'mdi-video',
  tidal: 'mdi-music',
  audiomack: 'mdi-music',
  mixcloud: 'fa-brands fa-mixcloud',
  beatport: 'mdi-music',
  genius: 'mdi-music-note',
  reverbnation: 'mdi-music',
  bandlab: 'mdi-music',
  unsplash: 'fa-brands fa-unsplash',
  '500px': 'fa-brands fa-500px',
  pixiv: 'mdi-palette',
  webtoons: 'mdi-book-open-page-variant',
  redbubble: 'mdi-store',
  society6: 'mdi-store',
  inprnt: 'mdi-store',
  teepublic: 'mdi-store',
  amazon: 'fa-brands fa-amazon',
  aliexpress: 'mdi-cart',
  bigcartel: 'mdi-cart',
  depop: 'mdi-cart',
  vinted: 'mdi-cart',
  grailed: 'mdi-cart',
  poshmark: 'mdi-cart',
  mercari: 'mdi-cart',
  stripe: 'fa-brands fa-stripe',
  squareup: 'mdi-cash-multiple',
  lemonsqueezy: 'mdi-cart',
  wise: 'mdi-bank',
  coinbase: 'mdi-currency-usd',
  binance: 'mdi-currency-btc',
  kraken: 'mdi-currency-btc',
  kucoin: 'mdi-currency-btc',
  bscscan: 'mdi-ethereum',
  solscan: 'mdi-ethereum',
  rarible: 'mdi-ethereum',
  zora: 'mdi-ethereum',
  mirror: 'mdi-ethereum',
  riotgames: 'mdi-gamepad-variant',
  leagueoflegends: 'mdi-gamepad-variant',
  battlenet: 'mdi-gamepad-variant',
  ea: 'mdi-gamepad-variant',
  ubisoft: 'mdi-gamepad-variant',
  rockstargames: 'mdi-gamepad-variant',
  minecraft: 'mdi-gamepad-variant',
  faceit: 'mdi-gamepad-variant',
  speedrun: 'mdi-timer-outline',
  nexusmods: 'mdi-puzzle',
  moddb: 'mdi-puzzle',
  gamejolt: 'mdi-gamepad-variant',
  boardgamegeek: 'mdi-dice-multiple',
  osu: 'mdi-gamepad-variant',
  chesscom: 'mdi-chess-knight',
  lichess: 'mdi-chess-knight',
  wattpad: 'mdi-book-open-page-variant',
  ao3: 'mdi-book-open-page-variant',
  royalroad: 'mdi-book-open-page-variant',
  fanfiction: 'mdi-book-open-page-variant',
  storygraph: 'mdi-book-open-page-variant',
  garmin: 'mdi-run-fast',
  fitbit: 'mdi-run',
  myfitnesspal: 'mdi-run',
  alltrails: 'mdi-map-marker',
  komoot: 'mdi-bike',
  peloton: 'mdi-bike',
  untappd: 'fa-brands fa-untappd',
  vivino: 'mdi-glass-wine',
  yelp: 'fa-brands fa-yelp',
  tripadvisor: 'mdi-map-marker',
  airbnb: 'fa-brands fa-airbnb',
  couchsurfing: 'mdi-sofa',
  upwork: 'fa-brands fa-upwork',
  fiverr: 'mdi-briefcase',
  calendly: 'mdi-calendar',
  calcom: 'mdi-calendar',
  wellfound: 'mdi-briefcase',
  crunchbase: 'mdi-briefcase',
  playstore: 'mdi-google-play',
};

export function parseSocialUrl(value: string): URL | null {
  const input = value.trim();
  // Reject ambiguous browser normalization, credentials, and non-web schemes.
  if (
    input.length > 500 ||
    !/^https?:\/\//i.test(input) ||
    /[\s\\<>"]/u.test(input) ||
    Array.from(input).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return null;
  try {
    const url = new URL(input);
    return url.hostname && !url.username && !url.password && url.href.length <= 500 ? url : null;
  } catch {
    return null;
  }
}

export function recognizeSocialDomain(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  return (
    Object.entries(SOCIAL_DOMAINS).find(([, domains]) =>
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    )?.[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Admin-approved domains (user requests, verified in the admin panel).
//
// Recognition = built-in platform hosts + this overlay. The server owns the truth and
// pushes the list (stores/approvedDomains.ts) so the editor agrees with what the server
// will accept, and the visitor warning agrees with what the server marks as recognised.
//
// It is a shallowRef, not a plain array, so a component's computed re-evaluates when the
// approved set arrives (otherwise a freshly approved domain would keep its warning until a
// full reload).
// ---------------------------------------------------------------------------
const APPROVED_DOMAINS = shallowRef<string[]>([]);

/** Replace the approved-domain overlay. Keys are bare hosts (no www, lower-case). */
export function registerApprovedDomains(domains: string[]): void {
  APPROVED_DOMAINS.value = (Array.isArray(domains) ? domains : [])
    .map((domain) =>
      String(domain || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

export function approvedDomainList(): string[] {
  return [...APPROVED_DOMAINS.value];
}

/** True when the URL's host is (a subdomain of) an admin-approved domain. */
export function isApprovedHost(value: string): boolean {
  const parsed = parseSocialUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return APPROVED_DOMAINS.value.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Is this URL safe/known — a recognised platform OR an admin-approved domain? The editor,
 * the renderer's visitor warning and the "one unrecognised link" rule all ask this one
 * function instead of re-deriving recognition.
 */
export function isRecognizedHost(value: string): boolean {
  const parsed = parseSocialUrl(value);
  if (!parsed) return false;
  return recognizeSocialDomain(parsed) !== null || isApprovedHost(value);
}

export function normalizeSocialUrl(key: string, value: string): URL | null {
  const parsed = parseSocialUrl(value);
  if (parsed) return parsed;
  const input = value.trim();
  // Preserve existing handle-only profiles without interpreting malformed URLs as handles.
  if (!/^[a-zA-Z0-9_#@.-]{1,100}$/.test(input)) return null;
  const handle = encodeURIComponent(input.replace(/^@/, ''));
  const bases: Record<string, string> = {
    twitter: 'https://twitter.com/',
    instagram: 'https://instagram.com/',
    github: 'https://github.com/',
    youtube: 'https://youtube.com/@',
    twitch: 'https://twitch.tv/',
    tiktok: 'https://tiktok.com/@',
    telegram: 'https://t.me/',
    spotify: 'https://open.spotify.com/user/',
    steam: 'https://steamcommunity.com/id/',
    pinterest: 'https://pinterest.com/',
    vsco: 'https://vsco.co/',
    facebook: 'https://facebook.com/',
    linkedin: 'https://linkedin.com/in/',
    reddit: 'https://reddit.com/user/',
    snapchat: 'https://snapchat.com/add/',
    threads: 'https://threads.net/@',
    bluesky: 'https://bsky.app/profile/',
    medium: 'https://medium.com/@',
    substack: 'https://substack.com/@',
    deviantart: 'https://deviantart.com/',
    behance: 'https://behance.net/',
    dribbble: 'https://dribbble.com/',
    artstation: 'https://artstation.com/',
    gitlab: 'https://gitlab.com/',
    bitbucket: 'https://bitbucket.org/',
    codeberg: 'https://codeberg.org/',
    playstation: 'https://playstation.com/',
    xbox: 'https://xbox.com/',
    letterboxd: 'https://letterboxd.com/',
    trakt: 'https://trakt.tv/users/',
    myanimelist: 'https://myanimelist.net/profile/',
    anilist: 'https://anilist.co/user/',
    goodreads: 'https://goodreads.com/',
    figma: 'https://figma.com/@',
    etsy: 'https://etsy.com/shop/',
    ebay: 'https://ebay.com/usr/',
    discogs: 'https://discogs.com/user/',
    kick: 'https://kick.com/',
    rumble: 'https://rumble.com/user/',
    odysee: 'https://odysee.com/@',
    patreon: 'https://patreon.com/',
    kofi: 'https://ko-fi.com/',
    buymeacoffee: 'https://buymeacoffee.com/',
    paypal: 'https://paypal.me/',
    cashapp: 'https://cash.app/$',
    venmo: 'https://venmo.com/u/',
    revolut: 'https://revolut.me/',
    bandcamp: 'https://bandcamp.com/',
    soundcloud: 'https://soundcloud.com/',
    deezer: 'https://deezer.com/',
    lastfm: 'https://last.fm/user/',
    weibo: 'https://weibo.com/',
    bilibili: 'https://space.bilibili.com/',
    vk: 'https://vk.com/',
    flickr: 'https://flickr.com/people/',
  };
  if (key === 'roblox' && /^\d+$/.test(input))
    return new URL(`https://www.roblox.com/users/${input}/profile`);
  if (key === 'discord' && /^\d+$/.test(input))
    return new URL(`https://discord.com/users/${input}`);
  return Object.hasOwn(bases, key) ? parseSocialUrl(`${bases[key]}${handle}`) : null;
}

/** How to draw one classic-row icon: a glyph, an emoji, or an uploaded image. */
export interface SocialIconDisplay {
  kind: 'icon' | 'emoji' | 'image';
  icon?: string;
  text?: string;
  src?: string;
}

/**
 * Resolve a classic-row custom icon, falling back to the platform glyph. Same shapes the
 * link list accepts (platform key, catalogue glyph, emoji, uploaded image), so a user can
 * put their own uploaded icon on any platform in either view.
 */
export function socialIconDisplay(
  icon: ProfileLinkIcon | null | undefined,
  fallbackGlyph = 'mdi-link',
): SocialIconDisplay {
  if (!icon || !icon.value) return { kind: 'icon', icon: fallbackGlyph };
  if (icon.kind === 'emoji') return { kind: 'emoji', text: icon.value };
  if (icon.kind === 'image') return { kind: 'image', src: icon.value };
  if (icon.kind === 'platform')
    return { kind: 'icon', icon: PLATFORM_ICONS[icon.value] ?? fallbackGlyph };
  return { kind: 'icon', icon: icon.value };
}

export function socialLinkEntries(
  links: Record<string, string>,
  icons?: Record<string, ProfileLinkIcon> | null,
) {
  return Object.entries(links).flatMap(([key, value]) => {
    if (typeof value !== 'string' || !value.trim()) return [];
    const parsed = normalizeSocialUrl(key, value);
    const platform = parsed ? recognizeSocialDomain(parsed) : null;
    // An admin-approved domain has no platform key (it stays in the `custom` slot) but it
    // is recognised, so the classic row must stop warning about it.
    const recognized = platform !== null || isApprovedHost(parsed?.href ?? value);
    // A per-platform custom icon (uploaded image / catalogue glyph / emoji) wins over the
    // platform glyph; the row keeps `icon` so callers that only want a glyph still work.
    const iconOverride = icons?.[key] ?? null;
    return [
      {
        key,
        raw: value,
        url: parsed?.href ?? null,
        platform,
        recognized,
        icon: platform ? PLATFORM_ICONS[platform] || 'mdi-link' : 'mdi-link',
        iconOverride,
      },
    ];
  });
}

export function addSocialLink(
  links: Record<string, string>,
  input: string,
): Record<string, string> {
  const url = parseSocialUrl(input);
  if (!url)
    throw new Error(
      'enter a valid http:// or https:// URL (maximum 500 characters), without credentials',
    );
  const key = recognizeSocialDomain(url) ?? 'custom';
  if (socialLinkEntries(links).some((link) => link.url === url.href))
    throw new Error('this link is already added');
  if (links[key]?.trim())
    throw new Error(
      `only one ${key === 'custom' ? 'unrecognized' : key} link is supported; remove the existing link first`,
    );
  return { ...links, [key]: url.href };
}
