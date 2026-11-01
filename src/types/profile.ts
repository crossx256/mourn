// Profile Model - Complete interface matching Prisma schema

export interface ProfileLinkIcon {
  /** platform = SOCIAL_DOMAINS key · icon = "fa-brands fa-x" | "mdi-*" · emoji · image URL */
  kind: 'platform' | 'icon' | 'emoji' | 'image';
  value: string;
}

export interface ProfileLink {
  /** Stable per-row id (`l_` + 8 hex), generated once and reused so reordering is safe. */
  id: string;
  /** 'header' is a section divider: no url, renders as a labelled rule. */
  kind: 'link' | 'header';
  title: string;
  subtitle: string | null;
  url: string | null;
  icon: ProfileLinkIcon;
  thumb: string | null;
  style: LinksStyle;
  accent: string | null;
  featured: boolean;
  visible: boolean;
  /**
   * Public-payload only: the server marks each row as recognised (platform table +
   * admin-approved domains). Never stored — it exists so the renderer's visitor warning
   * cannot disagree with what the server accepts.
   */
  recognized?: boolean;
}

export type LinksDisplayMode = 'classic' | 'linktree';
export type LinksLayout = 'stack' | 'cards' | 'list' | 'grid';
export type LinksStyle = 'inherit' | 'button' | 'icon' | 'text' | 'card';
export type LinksHoverEffect = 'inherit' | 'static' | 'bounce' | 'glow' | 'scale';

/** The fields the Linktree-mode renderer needs; a subset of Profile. */
export interface LinkStyleConfig {
  layout: LinksLayout;
  align: 'center' | 'left';
  width: 'narrow' | 'default' | 'wide';
  radius: string | null;
  color: string | null;
  backgroundColor: string | null;
  hoverEffect: LinksHoverEffect;
  showTitles: boolean;
  showThumbs: boolean;
  openNewTab: boolean;
  position: 'below-bio' | 'below-stats' | 'bottom';
  showClassicIcons: boolean;
  iconPosition: 'left' | 'top' | 'right';
  gap: number;
}

export const DEFAULT_LINK_STYLE: LinkStyleConfig = {
  layout: 'stack',
  align: 'center',
  width: 'default',
  radius: null,
  color: null,
  backgroundColor: null,
  hoverEffect: 'inherit',
  showTitles: true,
  showThumbs: true,
  openNewTab: true,
  position: 'below-bio',
  showClassicIcons: false,
  iconPosition: 'left',
  gap: 10,
};

export interface Profile {
  id: string;
  userId: string;

  // Basic Info
  displayName: string | null;
  bio: string | null;
  profilePicture: string | null;
  profilePictureShape: string;
  profilePictureRadius: string;
  profilePictureBorder: boolean;

  // Visibility Controls
  showHandle: boolean;
  showProfilePicture: boolean;

  // Stats
  views: number;
  reputation: number;
  contribution: number;
  viewHistory: unknown[] | null;
  showViews: boolean;
  showReputation: boolean;
  showMemberSince: boolean;
  showReferrals: boolean;

  // Entrance Overlay
  showEntranceOverlay: boolean;
  entranceText: string;
  entranceTextFont: string;
  entranceTextColor: string;
  entranceOverlayColor: string;
  entranceOverlayOpacity: number;
  entranceOverlayEnabled?: boolean;
  entranceOverlayImage?: string | null;
  entranceOverlayText?: string | null;
  entranceOverlayTextColor?: string;
  entranceOverlayTextSize?: number;
  entranceOverlayTextShadowEnabled?: boolean;
  entranceOverlayTextShadowColor?: string;
  entranceOverlayTextShadowBlur?: number;

  // Backgrounds
  backgroundColor: string;
  backgroundGradient: string | null;
  backgroundImage: string | null;
  backgroundGif: string | null;
  backgroundVideo: string | null;
  backgroundOpacity: number;
  backgroundBlur: number;

  // Borders & Cards
  borderColor: string;
  borderRadius: string;
  borderStyle: string;
  borderGradient: string | null;
  borderTarget: string;
  showBorders: boolean;
  showCardBorders: boolean | null;
  cardBorderColor: string | null;
  cardBorderRadius: string | null;
  cardBorderStyle: string | null;
  cardBorderWidth: number;
  cardBorderGradient: string | null;
  cardGlowColor?: string | null;
  cardGlowEnabled?: boolean;
  cardGlowIntensity?: number;
  cardBackgroundColor: string;
  cardOpacity: number;
  cardBlur: number;
  enableTiltEffect: boolean;

  // Card Shadow
  cardShadowEnabled?: boolean;
  cardShadowColor?: string;
  cardShadowX?: number;
  cardShadowY?: number;
  cardShadowBlur?: number;
  cardShadowSpread?: number;

  // Card Size & Position
  cardWidth?: string | null;
  cardMaxWidth?: string | null;
  cardPadding?: string | null;
  cardMargin?: string | null;

  // Socials & Customization
  socialLinks: Record<string, string> | null;
  /**
   * Per-platform custom icon for the classic row, keyed by platform (same keys as
   * socialLinks). An absent key renders the platform glyph, so this is purely additive.
   */
  socialIcons?: Record<string, ProfileLinkIcon> | null;
  socialIconColor: string | null;
  socialIconHoverEffect: string;
  socialIconSize: number;

  // v2 profile links ("Linktree-class"). profileLinks is an ORDERED array — the index
  // is the display order. linksDisplay picks which surface the profile shows:
  // 'classic' = the socialLinks icon row above (default), 'linktree' = this list.
  profileLinks: ProfileLink[] | null;
  linksDisplay: LinksDisplayMode;
  linksLayout: LinksLayout;
  linksAlign: 'center' | 'left';
  linksWidth: 'narrow' | 'default' | 'wide';
  linksRadius: string | null;
  linksColor: string | null;
  linksBgColor: string | null;
  linksHoverEffect: LinksHoverEffect;
  linksShowTitles: boolean;
  linksShowThumbs: boolean;
  linksOpenNewTab: boolean;
  linksPosition: 'below-bio' | 'below-stats' | 'bottom';
  linksShowClassicIcons: boolean;
  linksIconPosition: 'left' | 'top' | 'right';
  linksGap: number;
  statsPosition: string;
  statsSize: string;
  customCursor: string | null;
  cursorEffect: string | null;
  cursorCSS: string | null;
  cursorSize?: number | null;
  customFontUrl?: string | null;

  // Badges
  badges: string[] | null;
  showBadges: boolean;
  badgeColor: string | null;
  badgeSize: number;

  // Typography & Effects
  customFont: string | null;
  musicUrl: string | null;
  musicVolume?: number;
  musicAutoplay?: boolean;
  musicLoop?: boolean;
  usernameTextColor: string | null;
  usernameFontSize: number | null;
  usernameFontWeight: number | null;
  usernameLetterSpacing: string | null;
  usernameGlowColor: string | null;
  usernameEffects: string | null;
  usernameTextShadow: string | null;
  usernameTextStroke: string | null;
  usernameEnableShadow: boolean | null;
  usernameTextShadowColor: string | null;
  usernameTextShadowX: number | null;
  usernameTextShadowY: number | null;
  usernameTextShadowBlur: number | null;

  bioTextColor: string | null;
  bioFontSize: number | null;
  bioFontWeight: number | null;
  bioLetterSpacing: string | null;
  bioLineHeight: number | null;
  bioTextShadow: string | null;
  bioTextStroke: string | null;
  bioEnableShadow: boolean | null;
  bioTextShadowColor: string | null;
  bioTextShadowX: number | null;
  bioTextShadowY: number | null;
  bioTextShadowBlur: number | null;

  descriptionAnimation: string | null;
  profileAnimation: string | null;
  profileLayout: string;
  titleGlitch: boolean;
  titleGlitchSpeed?: number;
  showProfilePromo: boolean;

  // SEO & Value
  seoTitle: string | null;
  seoDescription: string | null;
  showUsernameValue: boolean;
  usernameValue: string | null;
  showProfileCard: boolean;

  // Extra Community
  lftSection: unknown;
  interlinkProfiles: unknown[] | null;
  favoriteServer: unknown;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
