/**
 * Link icon catalogue for the v2 profile links ("Linktree-class") feature.
 *
 * Every glyph here is verified to exist in the bundles the app already ships:
 * Font Awesome Free 7 (`@fortawesome/fontawesome-free`, `fa-brands fa-*`) and
 * Material Design Icons v7 (`@quasar/extras/mdi-v7`, `mdi-*`). The server's
 * sanitizer accepts exactly those two shapes — see `sanitizeLinkIcon` in
 * mourn.bio/utils/sanitize.js (guarded by mourn.bio/test/socialPlatforms.test.js).
 */
import { PLATFORM_ICONS } from 'src/utils/socialLinks';

export interface IconOption {
  /** Stored icon value: "fa-brands fa-github" | "mdi-link" */
  value: string;
  /** Human label shown in the picker */
  label: string;
}

export interface IconGroup {
  id: 'social' | 'media' | 'money' | 'contact' | 'misc';
  label: string;
  options: IconOption[];
}

const FA = (name: string): string => `fa-brands fa-${name}`;
const MDI = (name: string): string => `mdi-${name}`;

/** Friendly names for the platforms users actually look for by name. */
const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'x / twitter',
  discord: 'discord',
  telegram: 'telegram',
  instagram: 'instagram',
  github: 'github',
  youtube: 'youtube',
  twitch: 'twitch',
  tiktok: 'tiktok',
  spotify: 'spotify',
  roblox: 'roblox',
  steam: 'steam',
  pinterest: 'pinterest',
  vsco: 'vsco',
  facebook: 'facebook',
  linkedin: 'linkedin',
  reddit: 'reddit',
  snapchat: 'snapchat',
  whatsapp: 'whatsapp',
  signal: 'signal',
  bluesky: 'bluesky',
  threads: 'threads',
  mastodon: 'mastodon',
  nostr: 'nostr',
  matrix: 'matrix',
  guilded: 'guilded',
  line: 'line',
  weibo: 'weibo',
  bilibili: 'bilibili',
  vk: 'vk',
  kick: 'kick',
  rumble: 'rumble',
  odysee: 'odysee',
  patreon: 'patreon',
  kofi: 'ko-fi',
  buymeacoffee: 'buy me a coffee',
  gofundme: 'gofundme',
  paypal: 'paypal',
  cashapp: 'cash app',
  venmo: 'venmo',
  revolut: 'revolut',
  bandcamp: 'bandcamp',
  soundcloud: 'soundcloud',
  applemusic: 'apple music',
  deezer: 'deezer',
  lastfm: 'last.fm',
  medium: 'medium',
  substack: 'substack',
  deviantart: 'deviantart',
  behance: 'behance',
  dribbble: 'dribbble',
  artstation: 'artstation',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  codeberg: 'codeberg',
  itchio: 'itch.io',
  epicgames: 'epic games',
  playstation: 'playstation',
  xbox: 'xbox',
  nintendo: 'nintendo',
  letterboxd: 'letterboxd',
  trakt: 'trakt',
  myanimelist: 'myanimelist',
  anilist: 'anilist',
  goodreads: 'goodreads',
  notion: 'notion',
  figma: 'figma',
  shopify: 'shopify',
  etsy: 'etsy',
  ebay: 'ebay',
  discogs: 'discogs',
  strava: 'strava',
  tumblr: 'tumblr',
  flickr: 'flickr',
  opensea: 'opensea',
  etherscan: 'etherscan',
  mempool: 'bitcoin explorer',
  proton: 'proton',
  session: 'session',
  simplex: 'simplex',
  custom: 'other',
};

export function platformLabel(key: string): string {
  return PLATFORM_LABELS[key] ?? key;
}

/** Social platforms, in the same order as the recognition table. */
const SOCIAL_OPTIONS: IconOption[] = Object.entries(PLATFORM_ICONS).map(([key, icon]) => ({
  value: icon,
  label: platformLabel(key),
}));

/**
 * Generic glyphs for anything unrecognised and for manual overrides. Deliberately
 * small: a long list is worse than a searchable short one, and the domain
 * auto-detect covers the common cases.
 */
export const ICON_LIBRARY: IconGroup[] = [
  { id: 'social', label: 'social', options: SOCIAL_OPTIONS },
  {
    id: 'media',
    label: 'media & files',
    options: [
      { value: MDI('movie-open'), label: 'film' },
      { value: MDI('music'), label: 'music' },
      { value: MDI('music-circle'), label: 'record' },
      { value: MDI('video'), label: 'video' },
      { value: MDI('camera'), label: 'camera' },
      { value: MDI('book-open-page-variant'), label: 'reading' },
      { value: MDI('palette'), label: 'art' },
      { value: MDI('play-circle'), label: 'play' },
      { value: MDI('rss'), label: 'feed' },
      { value: FA('bandcamp'), label: 'bandcamp' },
    ],
  },
  {
    id: 'money',
    label: 'money',
    options: [
      { value: MDI('hand-coin'), label: 'donate' },
      { value: MDI('cash-multiple'), label: 'cash' },
      { value: MDI('bank'), label: 'bank' },
      { value: MDI('wallet'), label: 'wallet' },
      { value: MDI('currency-btc'), label: 'bitcoin' },
      { value: MDI('ethereum'), label: 'ethereum' },
      { value: MDI('store'), label: 'store' },
      { value: MDI('shopping'), label: 'shop' },
      { value: MDI('gift'), label: 'gift' },
      { value: FA('patreon'), label: 'patreon' },
    ],
  },
  {
    id: 'contact',
    label: 'contact & accounts',
    options: [
      { value: MDI('email'), label: 'email' },
      { value: MDI('phone'), label: 'phone' },
      { value: MDI('chat'), label: 'chat' },
      { value: MDI('account-group'), label: 'community' },
      { value: MDI('lock'), label: 'private' },
      { value: MDI('shield-lock'), label: 'secure' },
      { value: MDI('incognito'), label: 'anonymous' },
    ],
  },
  {
    id: 'misc',
    label: 'everything else',
    options: [
      { value: 'mdi-link', label: 'link' },
      { value: MDI('web'), label: 'website' },
      { value: MDI('earth'), label: 'globe' },
      { value: MDI('code-tags'), label: 'code' },
      { value: MDI('server'), label: 'server' },
      { value: MDI('rocket-launch'), label: 'launch' },
      { value: MDI('gamepad-variant'), label: 'gaming' },
      { value: MDI('sword'), label: 'weapon' },
      { value: MDI('gavel'), label: 'legal' },
      { value: MDI('book-education'), label: 'research' },
      { value: MDI('map-marker'), label: 'place' },
      { value: MDI('video-vintage'), label: 'archive' },
    ],
  },
];

/** One-tap emoji, for people who want zero icon fuss. */
export const EMOJI_PRESETS: string[] = [
  '🔗',
  '🎧',
  '🎵',
  '🎬',
  '📚',
  '🎨',
  '🕹️',
  '📷',
  '✍️',
  '🧠',
  '⚙️',
  '🛠️',
  '🧪',
  '💰',
  '🪙',
  '🎁',
  '🛒',
  '📦',
  '📡',
  '🗺️',
  '🌍',
  '🔥',
  '⚡',
  '🌙',
  '☠️',
  '👁️',
  '🧿',
  '⚔️',
  '🕊️',
  '🖤',
];

/** Icon values that are valid per the server's `sanitizeLinkIcon` pattern. */
export const LINK_ICON_PATTERN =
  /^(?:fa-brands|fa-solid|fa-regular|fas|far)\s+[a-z0-9-]{2,40}$|^mdi-[a-z0-9-]{2,40}$/;

/** True when the icon renders as an emoji/text glyph rather than a font class. */
export function isEmojiIcon(value: string): boolean {
  return !LINK_ICON_PATTERN.test(value) && Array.from(value).length <= 2;
}
