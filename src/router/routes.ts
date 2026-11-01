import type { RouteRecordRaw } from 'vue-router';
import { isNativeBuild } from 'src/utils/platform';

// The Vault/messaging surface (`/chains`) is compiled into every NATIVE build
// (desktop + mobile) and deliberately absent from the public website.
const isNativeShellBuild = isNativeBuild;

const mainChildren: RouteRecordRaw[] = [
  { path: '', component: () => import('pages/IndexPage.vue') },
  { path: '/login', component: () => import('pages/LoginPage.vue') },
  { path: '/forgot-password', component: () => import('pages/ForgotPasswordPage.vue') },
  { path: '/reset-password', component: () => import('pages/ResetPasswordPage.vue') },
  { path: '/verify-email', component: () => import('pages/VerifyEmailPage.vue') },
  { path: '/register/invite', component: () => import('pages/RegisterPage.vue') },
  { path: '/register', component: () => import('pages/RegistrationEntryPage.vue') },
  {
    path: '/dashboard',
    component: () => import('pages/DashboardPage.vue'),
    meta: { requiresAuth: true, ssr: false },
  },
  {
    path: '/graveyard',
    name: 'graveyard',
    component: () => import('pages/GraveyardPage.vue'),
    meta: { ssr: false },
  },
  { path: '/help', component: () => import('pages/HelpPage.vue') },
  {
    // Support + report tickets. Reachable from the help page and from every
    // report entry point in the app (`?target=…&ref=…` pre-fills the composer).
    path: '/tickets',
    name: 'tickets',
    component: () => import('pages/SupportReportsPage.vue'),
    meta: { requiresAuth: true, ssr: false },
  },
  // { path: '/pricing', component: () => import('pages/PricingPage.vue') }, // removed with the premium feature
  { path: '/terms', component: () => import('pages/TermsPage.vue') },
  { path: '/contact', component: () => import('pages/ContactPage.vue') },
  { path: '/patch-notes', component: () => import('pages/PatchNotesPage.vue') },
  { path: '/about', component: () => import('pages/AboutPage.vue') },
  { path: '/builders', component: () => import('pages/BuildersPage.vue') },
  { path: '/payment', component: () => import('pages/PaymentPage.vue') },
  { path: '/leaderboard', component: () => import('pages/LeaderboardPage.vue') },
  {
    path: '/download',
    component: () => import('pages/DownloadPage.vue'),
    meta: { ssr: false },
  },
  {
    path: '/desktop-only',
    name: 'desktop-only',
    component: () => import('pages/DesktopOnlyPage.vue'),
    meta: { ssr: false },
  },
  {
    path: '/archives',
    name: 'archives',
    component: () => import('pages/ArchivesPage.vue'),
    meta: { ssr: false },
  },
  {
    path: '/archives/:slug',
    name: 'archive-show',
    component: () => import('pages/ArchiveShowPage.vue'),
    meta: { ssr: false },
  },
];

if (isNativeShellBuild) {
  mainChildren.push({
    path: '/chains',
    name: 'chains',
    component: () => import('pages/MessagingPage.vue'),
    meta: { requiresAuth: true, ssr: false },
  });
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: mainChildren,
  },
  {
    path: '/:username',
    component: () => import('layouts/ProfileLayout.vue'),
    children: [{ path: '', name: 'profile', component: () => import('pages/ProfilePage.vue') }],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
