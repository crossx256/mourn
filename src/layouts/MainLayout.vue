<template>
  <q-layout view="hHh lpR fFf">
    <!-- ═══════════════════════════════════════════════════════════════════
         DESKTOP HEADER (viewport ≥ md)
         ═══════════════════════════════════════════════════════════════════ -->
    <q-header
      v-if="isDesktop"
      class="header bg-black text-white decoration-none px-[1rem] py-[0.6rem]"
      :class="{ 'header--tauri-safe': isTauri }"
    >
      <q-toolbar class="relative items-center min-h-0 py-0">
        <!-- Left: Logo -->
        <div class="logo flex-shrink-0">
          <router-link to="/" class="logo header-brand inline-flex items-baseline gap-1">
            <MournLogoInline class="header-logo-svg" />
            <span class="brand-word">mourn</span>
            <span
              v-if="isNativeShellBuild"
              class="text-[10px] font-mono lowercase text-primary tracking-[0.16em] leading-none"
            >
              {{ appVersion }}
            </span>
            <span
              v-if="isOffline"
              class="inline-flex items-center gap-1 text-[10px] font-mono lowercase tracking-[0.16em] leading-none text-[#ff0000] cursor-pointer animate-pulse ml-1"
              role="button"
              tabindex="0"
              @click="retryNow()"
              @keydown.enter="retryNow()"
            >
              ▶ retrying…
              <q-tooltip
                class="bg-[var(--card)] text-white text-xs font-mono border border-solid border-[var(--border)]"
                :offset="[0, 8]"
              >
                click to retry now
              </q-tooltip>
            </span>
          </router-link>
        </div>

        <!-- Desktop search: wide screens stay centered, narrower desktop screens move left beside the logo -->
        <q-no-ssr>
          <div
            v-if="authStore.isLoggedIn && isTauri"
            class="desktop-search-center desktop-search-mode--center"
          >
            <div class="desktop-search-wrapper">
              <q-input
                v-model="nav.searchQuery.value"
                ref="desktopSearchInputRef"
                dense
                borderless
                placeholder="search users..."
                class="desktop-search-input"
                @focus="nav.onSearchFocus()"
                @blur="nav.onSearchBlur()"
                @update:model-value="
                  (v: string | number | null) => nav.onSearchInput(String(v ?? ''))
                "
                @keydown.escape="nav.closeSearch()"
              >
                <template #prepend>
                  <q-icon name="sym_o_search" size="18px" class="text-[var(--dash-muted)]" />
                </template>
              </q-input>

              <!-- Search results dropdown -->
              <div
                v-if="nav.isSearchFocused && nav.searchResults.value.length > 0"
                class="search-results-dropdown"
              >
                <q-list class="bg-[var(--card)] text-white">
                  <q-item
                    v-for="user in nav.searchResults.value"
                    :key="user.id"
                    class="search-result-item"
                  >
                    <q-item-section avatar>
                      <q-avatar size="28px" class="bg-[var(--dash-border)]">
                        <img
                          v-if="user.profile?.profilePicture"
                          :src="user.profile.profilePicture"
                          :alt="user.username"
                        />
                        <q-icon v-else name="sym_o_account_circle" size="20px" />
                      </q-avatar>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-xs font-mono lowercase tracking-wide">
                        {{ user.username }}
                      </q-item-label>
                      <q-item-label
                        v-if="user.profile?.displayName"
                        caption
                        class="text-[var(--dash-muted)] text-[10px]"
                      >
                        {{ user.profile.displayName }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <div class="flex items-center gap-1">
                        <q-btn
                          flat
                          dense
                          round
                          icon="sym_o_open_in_new"
                          size="sm"
                          class="text-[var(--dash-muted)]"
                          @click.stop="nav.navigateToUser(user.username)"
                        >
                          <q-tooltip class="text-[10px] font-mono">View profile</q-tooltip>
                        </q-btn>
                        <q-btn
                          flat
                          round
                          icon="mdi-link-plus"
                          size="sm"
                          class="text-[var(--dash-muted)]"
                          :loading="nav.isLinkRequesting(user.id)"
                          :disable="nav.isLinkRequesting(user.id)"
                          @click.stop="nav.requestLink(user.id)"
                        >
                          <q-tooltip class="text-[10px] font-mono">Establish Link</q-tooltip>
                        </q-btn>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>
            </div>
          </div>

          <div class="desktop-search-center desktop-search-mode--left">
            <div class="desktop-search-wrapper desktop-search-wrapper--inline">
              <q-input
                v-model="nav.searchQuery.value"
                ref="desktopSearchInputRef"
                dense
                borderless
                placeholder="search users..."
                class="desktop-search-input desktop-search-input--inline"
                @focus="nav.onSearchFocus()"
                @blur="nav.onSearchBlur()"
                @update:model-value="
                  (v: string | number | null) => nav.onSearchInput(String(v ?? ''))
                "
                @keydown.escape="nav.closeSearch()"
              >
                <template #prepend>
                  <q-icon name="sym_o_search" size="18px" class="text-[var(--dash-muted)]" />
                </template>
              </q-input>

              <div
                v-if="nav.isSearchFocused && nav.searchResults.value.length > 0"
                class="search-results-dropdown"
              >
                <q-list class="bg-[var(--card)] text-white">
                  <q-item
                    v-for="user in nav.searchResults.value"
                    :key="user.id"
                    class="search-result-item"
                  >
                    <q-item-section avatar>
                      <q-avatar size="28px" class="bg-[var(--dash-border)]">
                        <img
                          v-if="user.profile?.profilePicture"
                          :src="user.profile.profilePicture"
                          :alt="user.username"
                        />
                        <q-icon v-else name="sym_o_account_circle" size="20px" />
                      </q-avatar>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-xs font-mono lowercase tracking-wide">
                        {{ user.username }}
                      </q-item-label>
                      <q-item-label
                        v-if="user.profile?.displayName"
                        caption
                        class="text-[var(--dash-muted)] text-[10px]"
                      >
                        {{ user.profile.displayName }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <div class="flex items-center gap-1">
                        <q-btn
                          flat
                          dense
                          round
                          icon="sym_o_open_in_new"
                          size="sm"
                          class="text-[var(--dash-muted)]"
                          @click.stop="nav.navigateToUser(user.username)"
                        >
                          <q-tooltip class="text-[10px] font-mono">View profile</q-tooltip>
                        </q-btn>
                        <q-btn
                          flat
                          dense
                          round
                          icon="mdi-link-plus"
                          size="sm"
                          class="text-[var(--dash-muted)]"
                          :loading="nav.isLinkRequesting(user.id)"
                          :disable="nav.isLinkRequesting(user.id)"
                          @click.stop="nav.requestLink(user.id)"
                        >
                          <q-tooltip class="text-[10px] font-mono">Establish Link</q-tooltip>
                        </q-btn>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>
            </div>
          </div>
        </q-no-ssr>

        <!-- Right: Icon Row (ml-auto pushes it to the right) -->
        <q-no-ssr>
          <div class="ml-auto flex shrink-0 items-center gap-4 relative z-20">
            <!-- Messages — STRICTLY DESKTOP/TAURI ONLY -->
            <q-btn
              v-if="isTauri && authStore.isLoggedIn"
              flat
              dense
              round
              icon="sym_o_mail"
              size="md"
              class="nav-icon-btn"
              to="/chains"
            >
              <q-badge
                v-if="vaultUnreadCount > 0"
                color="primary"
                floating
                rounded
                class="text-[10px] min-w-[16px] max-w-[24px] truncate"
              >
                {{ vaultUnreadCount > 99 ? '99+' : vaultUnreadCount }}
              </q-badge>
              <q-tooltip class="bg-[var(--card)] text-white text-xs">messages</q-tooltip>
            </q-btn>

            <!-- Notifications — STRICTLY DESKTOP/TAURI ONLY -->
            <q-btn
              v-if="isTauri && authStore.isLoggedIn"
              flat
              dense
              round
              icon="sym_o_notifications"
              size="md"
              class="nav-icon-btn"
            >
              <q-badge
                v-if="notificationsStore.unreadCount > 0"
                color="primary"
                floating
                rounded
                class="text-[10px] min-w-[16px]"
              >
                {{ notificationsStore.unreadCount }}
              </q-badge>
              <q-tooltip class="bg-[var(--card)] text-white text-xs">notifications</q-tooltip>
              <q-menu
                square
                :offset="[0, 12]"
                anchor="bottom right"
                self="top right"
                class="notif-menu bg-black border border-solid border-[var(--border)] shadow-none w-[min(360px,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden"
                transition-show="jump-down"
                transition-hide="jump-up"
                @before-show="handleNotificationMenuOpen()"
              >
                <div class="notif-menu-shell">
                  <div class="notif-scanlines" />
                  <div class="notif-chr notif-chr--red" />
                  <div class="notif-chr notif-chr--cyan" />
                  <div class="relative z-[4] flex flex-col min-h-0 notif-menu-body font-mono">
                    <div class="shrink-0 px-4 pt-4 pb-2">
                      <div
                        class="text-[11px] tracking-[0.4em] uppercase text-[var(--primary)] mb-1"
                      >
                        <span class="opacity-70">[</span>
                        <span class="mx-1 notif-header-pulse">NOTIFICATIONS</span>
                        <span class="opacity-70">]</span>
                        <span class="notif-cursor text-[10px] ml-1">&#x2588;</span>
                      </div>
                      <div class="notif-divider" />
                    </div>
                    <div class="notif-menu-scroll px-4 pb-4 min-h-0">
                      <template v-if="notificationsStore.notifications.length > 0">
                        <div
                          v-for="notification in notificationsStore.notifications"
                          :key="notification.id"
                        >
                          <div
                            class="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--dash-text)] mb-1"
                          >
                            <span class="text-[var(--primary)] font-bold mr-1">&gt;</span
                            >{{ notification.title }}
                          </div>
                          <div
                            class="text-[9px] uppercase tracking-[0.15em] mb-1.5"
                            style="color: #555"
                          >
                            {{
                              new Date(notification.createdAt)
                                .toISOString()
                                .replace('T', ' ')
                                .slice(0, 16)
                            }}
                          </div>
                          <div
                            class="text-[13px] leading-relaxed text-[var(--dash-text)] whitespace-pre-wrap break-words"
                          >
                            {{ notification.message }}
                          </div>
                          <div
                            v-if="notification.type === 'LINK_REQUEST' && getLinkId(notification)"
                            class="flex flex-wrap gap-2 mt-2"
                          >
                            <q-btn
                              v-close-popup
                              size="sm"
                              color="primary"
                              :disable="!getLinkId(notification)"
                              @click="nav.acceptLink(getLinkId(notification))"
                              >Accept</q-btn
                            >
                            <q-btn
                              v-close-popup
                              size="sm"
                              color="negative"
                              :disable="!getLinkId(notification)"
                              @click="nav.rejectLink(getLinkId(notification))"
                              >Reject</q-btn
                            >
                          </div>
                          <div class="h-px mt-4" style="background: rgba(255, 255, 255, 0.04)" />
                        </div>
                      </template>
                      <div
                        v-else
                        class="text-[11px] tracking-[0.1em] notif-empty"
                        style="color: #444"
                      >
                        <span class="text-[var(--primary)] font-bold mr-1">&gt;</span> no
                        notifications
                      </div>
                    </div>
                  </div>
                </div>
              </q-menu>
            </q-btn>

            <!-- ── Discord ── -->
            <q-separator
              v-if="isTauri && authStore.isLoggedIn"
              vertical
              inset
              class="bg-[var(--dash-border)] mx-1"
            />
            <q-btn
              v-if="authStore.isLoggedIn"
              flat
              dense
              round
              size="md"
              class="nav-icon-btn"
              href="https://discord.gg/sGp8A3nfKj"
              target="_blank"
              aria-label="join our discord"
            >
              <!-- FA6 free has NO fa-discord glyph (empty box) — official logo as inline SVG -->
              <svg
                class="discord-nav-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"
                />
              </svg>
              <q-tooltip class="bg-[var(--card)] text-white text-xs">discord</q-tooltip>
            </q-btn>
            <!-- ── Pages ── -->
            <q-separator
              v-if="authStore.isLoggedIn"
              vertical
              inset
              class="bg-[var(--dash-border)] mx-1"
            />
            <q-btn
              v-if="authStore.isLoggedIn"
              flat
              dense
              round
              icon="sym_o_curtains"
              size="md"
              class="nav-icon-btn"
              @click="nav.goGraveyard()"
            >
              <q-tooltip class="bg-[var(--card)] text-white text-xs">graveyard</q-tooltip>
            </q-btn>
            <q-btn
              v-if="authStore.isLoggedIn"
              flat
              dense
              round
              icon="sym_o_leaderboard"
              size="md"
              class="nav-icon-btn"
              to="/leaderboard"
            >
              <q-tooltip class="bg-[var(--card)] text-white text-xs">leaderboard</q-tooltip>
            </q-btn>
            <q-btn
              v-if="authStore.isLoggedIn"
              flat
              dense
              round
              icon="sym_o_inventory_2"
              size="md"
              class="nav-icon-btn"
              to="/archives"
            >
              <q-tooltip class="bg-[var(--card)] text-white text-xs">archives</q-tooltip>
            </q-btn>

            <!-- ── Profile / User Menu ── -->
            <q-separator
              v-if="authStore.isLoggedIn"
              vertical
              inset
              class="bg-[var(--dash-border)] mx-1"
            />
            <q-btn
              flat
              dense
              round
              icon="mdi-compass-outline"
              size="md"
              class="nav-icon-btn"
              @click.stop="toggleMasterNavigator()"
            />
            <template v-if="authStore.isLoggedIn">
              <q-btn flat dense round icon="sym_o_account_circle" size="md" class="nav-icon-btn">
                <q-menu
                  square
                  :offset="[0, 8]"
                  anchor="bottom right"
                  self="top right"
                  class="bg-[var(--card)] border border-solid border-[var(--border)] shadow-none"
                  transition-show="jump-down"
                  transition-hide="jump-up"
                >
                  <q-list class="desktop-user-menu text-white min-w-[220px] lowercase font-mono">
                    <!-- Account Info Header -->
                    <div v-if="authStore.user" class="px-4 pt-3 pb-2">
                      <div class="flex items-center gap-3">
                        <q-avatar size="38px">
                          <img
                            v-if="authStore.user.profile?.profilePicture"
                            :src="authStore.user.profile.profilePicture"
                          />
                          <q-icon v-else name="sym_o_account_circle" size="38px" />
                        </q-avatar>
                        <div class="font-mono">
                          <div class="text-sm font-bold leading-tight">
                            {{ authStore.user.profile?.displayName || authStore.user.username }}
                          </div>
                          <div class="text-xs text-[var(--dash-muted)] leading-tight">
                            @{{ authStore.user.username }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Switch Account -->
                    <q-item
                      v-if="isNativeShell"
                      clickable
                      v-close-popup
                      @click="showAccountSwitcher = true"
                      class="mb-1"
                    >
                      <q-item-section side
                        ><q-icon
                          name="sym_o_swap_horiz"
                          size="16px"
                          class="text-[var(--dash-muted)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide">switch account</q-item-section>
                    </q-item>

                    <q-separator class="bg-[var(--border)]" />

                    <q-item clickable v-close-popup to="/dashboard?tab=account">
                      <q-item-section side
                        ><q-icon name="sym_o_settings" size="16px" class="text-[var(--dash-muted)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide">settings</q-item-section>
                    </q-item>
                    <q-item
                      v-if="authStore.user"
                      clickable
                      v-close-popup
                      :to="`/${authStore.user.username}`"
                    >
                      <q-item-section side
                        ><q-icon name="sym_o_person" size="16px" class="text-[var(--dash-muted)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide">profile</q-item-section>
                    </q-item>
                    <q-item clickable v-close-popup to="/dashboard">
                      <q-item-section side
                        ><q-icon
                          name="sym_o_dashboard"
                          size="16px"
                          class="text-[var(--dash-muted)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide">dashboard</q-item-section>
                    </q-item>
                    <q-item
                      clickable
                      v-close-popup
                      :to="{ path: '/tickets', query: { type: 'report' } }"
                    >
                      <q-item-section side
                        ><q-icon name="sym_o_flag" size="16px" class="text-[var(--dash-muted)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide"
                        >report something</q-item-section
                      >
                    </q-item>
                    <q-separator class="mobile-menu-separator" />
                    <q-item clickable v-close-popup @click="nav.handleLogout()">
                      <q-item-section side
                        ><q-icon name="exit_to_app" size="16px" class="text-[var(--primary)]"
                      /></q-item-section>
                      <q-item-section class="text-xs tracking-wide text-[var(--primary)] font-bold"
                        >logout</q-item-section
                      >
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </template>

            <!-- Not logged in -->
            <template v-else>
              <router-link to="/login" class="nav-login nav-link-box ml-2">login</router-link>
              <router-link to="/register" class="nav-register ml-2">register</router-link>
            </template>
          </div>
        </q-no-ssr>
      </q-toolbar>
    </q-header>

    <!-- ═══════════════════════════════════════════════════════════════════
         MOBILE HEADER (viewport < md)
         ═══════════════════════════════════════════════════════════════════ -->
    <q-header v-else class="header bg-black text-white decoration-none px-[0.75rem] py-[0.6rem]">
      <q-toolbar
        class="items-center min-h-0 py-0"
        :class="authStore.isLoggedIn ? 'justify-between' : 'justify-center'"
      >
        <!-- Logo — always visible regardless of auth state -->
        <div class="logo flex-shrink-0">
          <router-link to="/" class="logo header-brand">
            <MournLogoInline class="header-logo-svg" />
            <span class="brand-word">mourn</span>
          </router-link>
        </div>

        <q-no-ssr>
          <div v-if="authStore.isLoggedIn" class="flex items-center">
            <!-- Expandable Search + Notifications row -->
            <div
              class="mobile-search-zone flex items-center"
              :class="{ 'mobile-search-expanded': nav.isSearchExpanded.value }"
            >
              <!-- Expanded: full-width input -->
              <div
                v-if="nav.isSearchExpanded.value"
                class="mobile-search-input-wrapper flex items-center flex-grow gap-2"
              >
                <q-input
                  v-model="nav.searchQuery.value"
                  dense
                  borderless
                  autofocus
                  placeholder="search users..."
                  class="mobile-search-input flex-grow"
                  @update:model-value="
                    (v: string | number | null) => nav.onSearchInput(String(v ?? ''))
                  "
                  @keydown.escape="nav.closeSearch()"
                >
                  <template #prepend>
                    <q-icon name="sym_o_search" size="16px" class="text-[var(--dash-muted)]" />
                  </template>
                  <!-- Close sits in the input's #append slot, the same pattern the
                       Discovery search uses. As a flex SIBLING of the field it had no
                       place to go on a narrow header and wrapped onto its own line
                       below the input, leaving a detached X floating in the header. -->
                  <template #append>
                    <q-btn
                      flat
                      dense
                      round
                      icon="close"
                      size="sm"
                      class="text-[var(--dash-muted)]"
                      @click="nav.closeSearch()"
                    />
                  </template>
                </q-input>
              </div>

              <!-- Mobile search results -->
              <div
                v-if="nav.isSearchExpanded.value && nav.searchResults.value.length > 0"
                class="search-results-dropdown mobile"
              >
                <q-list class="bg-[var(--card)] text-white">
                  <q-item
                    v-for="user in nav.searchResults.value"
                    :key="user.id"
                    class="search-result-item"
                  >
                    <q-item-section avatar>
                      <q-avatar size="28px" class="bg-[var(--dash-border)]">
                        <img
                          v-if="user.profile?.profilePicture"
                          :src="user.profile.profilePicture"
                          :alt="user.username"
                        />
                        <q-icon v-else name="sym_o_account_circle" size="20px" />
                      </q-avatar>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-xs font-mono lowercase tracking-wide">
                        {{ user.username }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <div class="flex items-center gap-1">
                        <q-btn
                          flat
                          dense
                          round
                          icon="sym_o_open_in_new"
                          size="xs"
                          class="text-[var(--dash-muted)]"
                          @click.stop="nav.navigateToUser(user.username)"
                        >
                          <q-tooltip class="text-[10px] font-mono">View profile</q-tooltip>
                        </q-btn>
                        <q-btn
                          flat
                          dense
                          round
                          icon="mdi-link-plus"
                          size="xs"
                          class="text-[var(--dash-muted)]"
                          :loading="nav.isLinkRequesting(user.id)"
                          :disable="nav.isLinkRequesting(user.id)"
                          @click.stop="nav.requestLink(user.id)"
                        >
                          <q-tooltip class="text-[10px] font-mono">Establish Link</q-tooltip>
                        </q-btn>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>
            </div>

            <!-- Right: Search + Notifications row (mobile) -->
            <div v-if="!nav.isSearchExpanded.value" class="flex items-center gap-3">
              <!-- Search icon (logged in only) -->
              <q-btn
                flat
                dense
                round
                icon="sym_o_search"
                size="14px"
                class="nav-icon-btn"
                @click="nav.toggleSearch()"
              />

              <!-- Notifications -->
              <q-btn flat dense round icon="sym_o_notifications" size="14px" class="nav-icon-btn">
                <q-badge
                  v-if="notificationsStore.unreadCount > 0"
                  color="primary"
                  floating
                  rounded
                  class="text-[10px] min-w-[16px]"
                >
                  {{ notificationsStore.unreadCount }}
                </q-badge>
                <q-menu
                  square
                  :offset="[0, 8]"
                  anchor="bottom right"
                  self="top right"
                  class="notif-menu bg-black border border-solid border-[var(--border)] shadow-none w-[min(360px,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden"
                  transition-show="jump-down"
                  transition-hide="jump-up"
                  @before-show="handleNotificationMenuOpen()"
                >
                  <div class="notif-menu-shell">
                    <div class="notif-scanlines" />
                    <div class="notif-chr notif-chr--red" />
                    <div class="notif-chr notif-chr--cyan" />
                    <div class="relative z-[4] flex flex-col min-h-0 notif-menu-body font-mono">
                      <div class="shrink-0 px-4 pt-4 pb-2">
                        <div
                          class="text-[11px] tracking-[0.4em] uppercase text-[var(--primary)] mb-1"
                        >
                          <span class="opacity-70">[</span>
                          <span class="mx-1 notif-header-pulse">NOTIFICATIONS</span>
                          <span class="opacity-70">]</span>
                          <span class="notif-cursor text-[10px] ml-1">&#x2588;</span>
                        </div>
                        <div class="notif-divider" />
                      </div>
                      <div class="notif-menu-scroll px-4 pb-4 min-h-0">
                        <template v-if="notificationsStore.notifications.length > 0">
                          <div
                            v-for="notification in notificationsStore.notifications"
                            :key="notification.id"
                          >
                            <div
                              class="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--dash-text)] mb-1"
                            >
                              <span class="text-[var(--primary)] font-bold mr-1">&gt;</span
                              >{{ notification.title }}
                            </div>
                            <div
                              class="text-[9px] uppercase tracking-[0.15em] mb-1.5"
                              style="color: #555"
                            >
                              {{
                                new Date(notification.createdAt)
                                  .toISOString()
                                  .replace('T', ' ')
                                  .slice(0, 16)
                              }}
                            </div>
                            <div
                              class="text-[13px] leading-relaxed text-[var(--dash-text)] whitespace-pre-wrap break-words"
                            >
                              {{ notification.message }}
                            </div>
                            <div
                              v-if="notification.type === 'LINK_REQUEST' && getLinkId(notification)"
                              class="flex flex-wrap gap-2 mt-2"
                            >
                              <q-btn
                                v-close-popup
                                size="sm"
                                color="primary"
                                :disable="!getLinkId(notification)"
                                @click="nav.acceptLink(getLinkId(notification))"
                                >Accept</q-btn
                              >
                              <q-btn
                                v-close-popup
                                size="sm"
                                color="negative"
                                :disable="!getLinkId(notification)"
                                @click="nav.rejectLink(getLinkId(notification))"
                                >Reject</q-btn
                              >
                            </div>
                            <div class="h-px mt-4" style="background: rgba(255, 255, 255, 0.04)" />
                          </div>
                        </template>
                        <div
                          v-else
                          class="text-[11px] tracking-[0.1em] notif-empty"
                          style="color: #444"
                        >
                          <span class="text-[var(--primary)] font-bold mr-1">&gt;</span> no
                          notifications
                        </div>
                      </div>
                    </div>
                  </div>
                </q-menu>
              </q-btn>
            </div>
          </div>
        </q-no-ssr>
      </q-toolbar>
    </q-header>

    <!-- Desktop web app promo: always visible on desktop browser, never in Tauri -->
    <div v-if="showDesktopDownloadPromo" class="desktop-download-promo desktop-download-promo--top">
      <q-btn
        flat
        no-caps
        icon="sym_o_desktop_windows"
        label="Get the Desktop App"
        to="/download"
        class="nav-register desktop-download-promo-btn"
      />
    </div>

    <div v-if="showContributionTrigger" class="desktop-contribution-trigger">
      <q-btn
        outline
        square
        padding="sm"
        no-caps
        color="primary"
        label="[ contribute ]"
        :to="{ path: '/payment', query: { plan: 'contribution' } }"
        class="desktop-contribution-btn font-mono tracking-wide"
      />
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════
         DESKTOP MASTER NAVIGATOR DRAWER (TAURI ONLY)
         ═══════════════════════════════════════════════════════════════════ -->
    <q-drawer
      v-model="masterNavigatorOpen"
      side="right"
      overlay
      :width="Math.min(viewportWidth * 0.85, 320)"
      class="global-drawer master-navigator-drawer"
      transition-show="slide-right"
      transition-hide="slide-right"
    >
      <q-no-ssr>
        <div class="global-drawer-inner flex flex-col h-full" data-master-navigator>
          <!-- Drawer Header -->
          <div
            class="global-drawer-head flex items-center justify-between px-4 py-3"
            style="border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
          >
            <div class="logo header-brand text-lg">
              <MournLogoInline class="header-logo-svg" />
              <span class="brand-word">mourn</span>
            </div>
            <q-btn
              flat
              dense
              round
              icon="mdi-close"
              size="sm"
              class="master-nav-close"
              @click="closeMasterNavigator()"
            />
          </div>

          <!-- Drawer Navigation -->
          <q-scroll-area class="flex-grow">
            <q-list class="global-drawer-list text-white font-mono lowercase pt-2">
              <!-- SYSTEM -->
              <q-item-label
                header
                class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase"
              >
                system
              </q-item-label>
              <q-item clickable v-close-popup to="/" exact @click="closeMasterNavigator()">
                <q-item-section side
                  ><q-icon name="sym_o_home" size="18px" class="text-[var(--dash-muted)]"
                /></q-item-section>
                <q-item-section class="text-xs tracking-wide">home</q-item-section>
              </q-item>
              <q-item clickable v-close-popup to="/about" @click="closeMasterNavigator()">
                <q-item-section side
                  ><q-icon name="sym_o_info" size="18px" class="text-[var(--dash-muted)]"
                /></q-item-section>
                <q-item-section class="text-xs tracking-wide">about</q-item-section>
              </q-item>
              <q-item clickable v-close-popup to="/builders" @click="closeMasterNavigator()">
                <q-item-section side
                  ><q-icon name="sym_o_groups" size="18px" class="text-[var(--dash-muted)]"
                /></q-item-section>
                <q-item-section class="text-xs tracking-wide">builders</q-item-section>
              </q-item>

              <template v-if="authStore.isLoggedIn">
                <!-- SOCIAL -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase mt-2"
                >
                  social
                </q-item-label>
                <q-item clickable v-close-popup to="/leaderboard" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_groups" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">leaderboard</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/archives" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_inventory_2" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">archives</q-item-section>
                </q-item>
                <q-item
                  v-if="isNativeShell"
                  clickable
                  v-close-popup
                  to="/chains"
                  @click="closeMasterNavigator()"
                >
                  <q-item-section side>
                    <q-icon name="sym_o_mail" size="18px" class="text-[var(--dash-muted)]" />
                  </q-item-section>
                  <q-item-section class="text-xs tracking-wide">messaging</q-item-section>
                </q-item>

                <div
                  v-else
                  class="flex items-center gap-3 px-4 py-2 text-xs tracking-wide select-none opacity-60 cursor-not-allowed"
                >
                  <div class="flex items-center justify-center shrink-0">
                    <q-icon name="sym_o_mail" size="18px" class="text-[var(--dash-muted)]" />
                  </div>

                  <div
                    class="flex flex-col items-start justify-center normal-case text-[var(--dash-muted)]"
                  >
                    <span class="font-medium leading-normal text-gray-400">messaging</span>

                    <div class="text-[10px] text-gray-500 leading-normal block mt-0.5">
                      <span
                        >(only available on the
                        <router-link
                          to="/download"
                          class="messaging-nav-link underline cursor-pointer hover:text-red-300 text-primary visited:text-primary"
                        >
                          desktop app</router-link
                        >)</span
                      >
                    </div>
                  </div>
                </div>

                <!-- UNIVERSE -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase mt-2"
                >
                  universe
                </q-item-label>
                <q-item clickable v-close-popup @click="goGraveyardFromMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_curtains" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">the graveyard</q-item-section>
                </q-item>
              </template>

              <!-- ACCOUNT -->
              <q-item-label
                header
                class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase mt-2"
              >
                account
              </q-item-label>
              <template v-if="authStore.isLoggedIn">
                <q-item
                  clickable
                  v-close-popup
                  to="/dashboard?tab=account"
                  @click="closeMasterNavigator()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_settings" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">settings</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/dashboard" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_dashboard" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">dashboard</q-item-section>
                </q-item>
                <q-item
                  v-if="authStore.user"
                  clickable
                  v-close-popup
                  :to="`/${authStore.user.username}`"
                  @click="closeMasterNavigator()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_person" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">profile</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="handleMasterNavigatorLogout()">
                  <q-item-section side
                    ><q-icon name="exit_to_app" size="18px" class="text-[var(--primary)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide text-[var(--primary)] font-bold"
                    >logout</q-item-section
                  >
                </q-item>
              </template>
              <template v-else>
                <q-item clickable v-close-popup to="/login" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="login" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">login</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/register" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="person_add" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">register</q-item-section>
                </q-item>
              </template>

              <template v-if="isNativeShell">
                <!-- UTILS -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase mt-2"
                >
                  utils
                </q-item-label>
                <q-item clickable v-close-popup to="/help" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_help" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">help</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/patch-notes" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_article" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">patch notes</q-item-section>
                </q-item>
                <!-- <q-item clickable v-close-popup to="/pricing" @click="closeMasterNavigator()">
                <q-item-section side
                  ><q-icon name="sym_o_sell" size="18px" class="text-[var(--dash-muted)]"
                /></q-item-section>
                <q-item-section class="text-xs tracking-wide">pricing</q-item-section>
              </q-item> -->
                <q-item clickable v-close-popup to="/terms" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon name="sym_o_gavel" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">terms</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/contact" @click="closeMasterNavigator()">
                  <q-item-section side
                    ><q-icon
                      name="sym_o_alternate_email"
                      size="18px"
                      class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">contact</q-item-section>
                </q-item>
              </template>
            </q-list>
          </q-scroll-area>

          <!-- Drawer Footer -->
          <div class="global-drawer-footer p-4">
            <q-btn
              outline
              square
              no-caps
              color="primary"
              label="[ contribute ]"
              :to="{ path: '/payment', query: { plan: 'contribution' } }"
              class="master-nav-contribute full-width font-mono lowercase tracking-widest text-xs"
              @click="closeMasterNavigator()"
            />
          </div>
        </div>
      </q-no-ssr>
    </q-drawer>

    <!-- ═══════════════════════════════════════════════════════════════════
         GLOBAL MOBILE DRAWER
         ═══════════════════════════════════════════════════════════════════ -->
    <q-drawer
      v-model="nav.isDrawerOpen.value"
      side="left"
      :behavior="isMobile ? 'mobile' : 'desktop'"
      overlay
      :width="Math.min(viewportWidth * 0.85, 320)"
      class="global-drawer"
      :no-swipe-open="isDesktop || !isHomeRoute"
      :no-swipe-close="isDesktop"
    >
      <q-no-ssr>
        <div class="global-drawer-inner flex flex-col h-full">
          <!-- Drawer Header -->
          <div
            class="global-drawer-head flex items-center justify-between px-4 py-3"
            style="border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
          >
            <router-link to="/" class="logo header-brand text-lg" @click="nav.closeDrawer()">
              <MournLogoInline class="header-logo-svg" />
              <span class="brand-word">mourn</span>
              <span
                class="text-[10px] font-mono lowercase text-[var(--dash-muted)] tracking-[0.16em] leading-none opacity-70 whitespace-nowrap shrink-0 select-none"
              >
                {{ appVersion }}
              </span>
            </router-link>
          </div>

          <!-- Drawer Navigation -->
          <q-scroll-area class="flex-grow">
            <q-list class="global-drawer-list text-white font-mono lowercase pt-2">
              <template v-if="authStore.isLoggedIn">
                <!-- Category: Pages -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase"
                >
                  pages
                </q-item-label>

                <q-item
                  clickable
                  v-close-popup
                  @click="
                    nav.goGraveyard();
                    nav.closeDrawer();
                  "
                >
                  <q-item-section side
                    ><q-icon name="sym_o_curtains" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">graveyard</q-item-section>
                </q-item>

                <q-item clickable v-close-popup to="/archives" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_inventory_2" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">archives</q-item-section>
                </q-item>

                <q-item clickable v-close-popup to="/leaderboard" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_leaderboard" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">leaderboard</q-item-section>
                </q-item>

                <q-item
                  v-if="!isNativeShell"
                  clickable
                  v-close-popup
                  to="/download"
                  @click="nav.closeDrawer()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_download" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">download</q-item-section>
                </q-item>

                <!-- Category: User -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase mt-2"
                >
                  user
                </q-item-label>

                <q-item
                  clickable
                  v-close-popup
                  to="/dashboard?tab=account"
                  @click="nav.closeDrawer()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_settings" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">settings</q-item-section>
                </q-item>

                <q-item clickable v-close-popup to="/dashboard" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_dashboard" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">dashboard</q-item-section>
                </q-item>

                <q-item
                  v-if="authStore.user"
                  clickable
                  v-close-popup
                  :to="`/${authStore.user.username}`"
                  @click="nav.closeDrawer()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_person" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">profile</q-item-section>
                </q-item>
              </template>

              <template v-else>
                <!-- Logged-out: same styling as logged-in -->
                <q-item-label
                  header
                  class="text-[var(--dash-muted)] text-[10px] tracking-widest uppercase"
                >
                  pages
                </q-item-label>

                <q-item clickable v-close-popup to="/login" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_login" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide text-[var(--primary)] font-bold"
                    >login</q-item-section
                  >
                </q-item>
                <q-item clickable v-close-popup to="/register" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_person_add" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">register</q-item-section>
                </q-item>
                <q-item
                  clickable
                  v-close-popup
                  @click="
                    nav.goGraveyard();
                    nav.closeDrawer();
                  "
                >
                  <q-item-section side
                    ><q-icon name="sym_o_curtains" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">graveyard</q-item-section>
                </q-item>
                <q-item clickable v-close-popup to="/leaderboard" @click="nav.closeDrawer()">
                  <q-item-section side
                    ><q-icon name="sym_o_leaderboard" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">leaderboard</q-item-section>
                </q-item>
                <q-item
                  v-if="!isNativeShell"
                  clickable
                  v-close-popup
                  to="/download"
                  @click="nav.closeDrawer()"
                >
                  <q-item-section side
                    ><q-icon name="sym_o_download" size="18px" class="text-[var(--dash-muted)]"
                  /></q-item-section>
                  <q-item-section class="text-xs tracking-wide">download</q-item-section>
                </q-item>
              </template>

              <!-- Footer links -->
              <q-separator class="mobile-menu-separator my-2" />
              <q-item clickable v-close-popup to="/about" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >about</q-item-section
                >
              </q-item>
              <q-item clickable v-close-popup to="/help" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >help</q-item-section
                >
              </q-item>
              <q-item clickable v-close-popup to="/builders" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >builders</q-item-section
                >
              </q-item>
              <q-item clickable v-close-popup to="/patch-notes" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >patch notes</q-item-section
                >
              </q-item>
              <!-- <q-item clickable v-close-popup to="/pricing" @click="nav.closeDrawer()">
              <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                >pricing</q-item-section
              >
            </q-item> -->
              <q-item clickable v-close-popup to="/terms" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >terms</q-item-section
                >
              </q-item>
              <q-item clickable v-close-popup to="/contact" @click="nav.closeDrawer()">
                <q-item-section class="text-xs tracking-wide text-[var(--dash-muted)]"
                  >contact</q-item-section
                >
              </q-item>
            </q-list>
          </q-scroll-area>

          <div v-if="showMobileDrawerContribution" class="global-drawer-footer p-4">
            <q-btn
              outline
              square
              padding="sm"
              no-caps
              color="primary"
              label="[ contribute ]"
              :to="{ path: '/payment', query: { plan: 'contribution' } }"
              class="full-width font-mono lowercase tracking-widest text-xs"
              @click="nav.closeDrawer()"
            />
          </div>

          <!-- Drawer Footer: Logout -->
          <div v-if="authStore.isLoggedIn" class="global-drawer-footer p-4">
            <q-btn
              unelevated
              no-caps
              color="primary"
              label="logout"
              icon="exit_to_app"
              class="full-width font-mono lowercase tracking-widest text-xs"
              @click="nav.handleLogout()"
            />
          </div>
        </div>
      </q-no-ssr>
    </q-drawer>

    <!-- ═══════════════════════════════════════════════════════════════════
         DASHBOARD MOBILE DRAWER (preserved for dashboard sidebar)
         ═══════════════════════════════════════════════════════════════════ -->
    <q-drawer
      v-model="dashDrawerOpen"
      side="left"
      behavior="mobile"
      overlay
      :width="Math.min(viewportWidth * 0.9, 360)"
      class="dash-mobile-drawer"
      :no-swipe-open="!nav.isDashboardRoute.value"
    >
      <q-no-ssr>
        <div class="dash-drawer-inner">
          <!-- Drawer header -->
          <div class="dash-drawer-header">
            <span class="text-white text-sm font-bold font-mono lowercase tracking-wide"
              >dashboard</span
            >
            <q-btn
              round
              flat
              dense
              icon="mdi-close"
              color="primary"
              size="sm"
              @click="dashDrawerOpen = false"
            />
          </div>

          <!-- Sidebar content -->
          <div class="flex-grow overflow-y-auto" style="padding: 20px 12px">
            <DashboardSidebarContent
              v-if="dashboardSidebarProps"
              :dashboard-store="dashboardSidebarProps.dashboardStore as any"
              :search-query="String(dashboardSidebarProps.searchQuery ?? '')"
              :search-results="(dashboardSidebarProps.searchResults as any) ?? []"
              :active-tab="String(dashboardSidebarProps.activeTab ?? 'profile')"
              :profile-tabs="(dashboardSidebarProps.profileTabs as any) ?? []"
              :customization-tabs="(dashboardSidebarProps.customizationTabs as any) ?? []"
              :settings-tabs="(dashboardSidebarProps.settingsTabs as any) ?? []"
              :on-save-changes="(dashboardSidebarProps?.['onSaveChanges'] as any) ?? (() => {})"
              @update:search-query="
                (val: any) => (dashboardSidebarProps?.['onUpdate:searchQuery'] as any)?.(val)
              "
              @update:active-tab="handleMobileSidebarTabChange"
              @navigate-result="
                (result: any) => (dashboardSidebarProps?.['onNavigateResult'] as any)?.(result)
              "
              @search-focus="(ref: any) => (dashboardSidebarProps?.['onSearchFocus'] as any)?.(ref)"
            />
          </div>
        </div>
      </q-no-ssr>
    </q-drawer>

    <!-- Dashboard drawer toggle button (mobile only, dashboard route only) -->
    <q-btn
      v-if="nav.isDashboardRoute.value && isMobile"
      round
      color="primary"
      icon="mdi-chevron-right"
      size="md"
      class="fixed left-0 top-1/2 -translate-y-1/2 z-[2000] rounded-l-none shadow-lg"
      style="padding: 12px 10px 12px 6px"
      @click="dashDrawerOpen = !dashDrawerOpen"
      aria-label="Toggle dashboard menu"
    />

    <!-- ═══════════════════════════════════════════════════════════════════
         PAGE CONTAINER
         ═══════════════════════════════════════════════════════════════════ -->
    <q-page-container
      :class="[
        'page-cont',
        { 'page-cont--tauri': isTauri, 'page-cont--chains': route.path === '/chains' },
      ]"
      @touchstart.passive="drawerSwipeHandlers.onTouchstart"
      @touchmove.passive="drawerSwipeHandlers.onTouchmove"
      @touchend="drawerSwipeHandlers.onTouchend"
      @touchcancel="drawerSwipeHandlers.onTouchcancel"
    >
      <!-- Dashboard Layout (Desktop) -->
      <div v-if="nav.isDashboardRoute.value && isDesktop" class="dashboard-layout">
        <div class="dashboard-sidebar">
          <DashboardSidebarContent
            v-if="dashboardSidebarProps"
            :dashboard-store="dashboardSidebarProps.dashboardStore as any"
            :search-query="String(dashboardSidebarProps.searchQuery ?? '')"
            :search-results="(dashboardSidebarProps.searchResults as any) ?? []"
            :active-tab="String(dashboardSidebarProps.activeTab ?? 'profile')"
            :profile-tabs="(dashboardSidebarProps.profileTabs as any) ?? []"
            :customization-tabs="(dashboardSidebarProps.customizationTabs as any) ?? []"
            :settings-tabs="(dashboardSidebarProps.settingsTabs as any) ?? []"
            :on-save-changes="(dashboardSidebarProps?.['onSaveChanges'] as any) ?? (() => {})"
            @update:search-query="
              (val: any) => (dashboardSidebarProps?.['onUpdate:searchQuery'] as any)?.(val)
            "
            @update:active-tab="
              (val: any) => (dashboardSidebarProps?.['onUpdate:activeTab'] as any)?.(val)
            "
            @navigate-result="
              (result: any) => (dashboardSidebarProps?.['onNavigateResult'] as any)?.(result)
            "
            @search-focus="(ref: any) => (dashboardSidebarProps?.['onSearchFocus'] as any)?.(ref)"
          />
        </div>
        <div class="dashboard-content dashboard-route-content">
          <q-no-ssr>
            <router-view v-slot="{ Component }">
              <transition name="page-fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>
          </q-no-ssr>
        </div>
      </div>

      <!-- Standard Layout (Non-Dashboard or Mobile) -->
      <q-no-ssr v-else>
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </q-no-ssr>
    </q-page-container>

    <!-- ═══════════════════════════════════════════════════════════════════
         DESKTOP FOOTER (viewport ≥ md) — hidden in Tauri desktop app
         ═══════════════════════════════════════════════════════════════════ -->
    <q-footer v-if="isDesktop && !isTauri" class="footer">
      <p class="footer-copyright">© 2025 mourn — all rights reserved</p>
      <div class="footer-links">
        <router-link to="/about">about</router-link>
        <router-link to="/builders">builders</router-link>
        <router-link to="/help">help</router-link>
        <!-- <router-link to="/pricing">pricing</router-link> -->
        <router-link to="/patch-notes">patch notes</router-link>
        <router-link to="/terms">terms</router-link>
        <router-link to="/contact">contact</router-link>
      </div>
    </q-footer>

    <!-- ═══════════════════════════════════════════════════════════════════
         MOBILE FOOTER (viewport < md) — sticky bottom nav; hidden in Tauri
         ═══════════════════════════════════════════════════════════════════ -->
    <q-footer v-else-if="!isTauri" class="mobile-bottom-nav bg-black">
      <div class="flex items-center justify-around py-1.5">
        <!-- Messages -->
        <q-btn
          flat
          dense
          round
          :icon="authStore.isLoggedIn ? 'sym_o_mail' : 'sym_o_login'"
          size="md"
          class="nav-icon-btn"
          :to="authStore.isLoggedIn ? (isNativeShellBuild ? '/chains' : '/desktop-only') : '/login'"
          @click="hapticTap()"
        >
          <q-badge
            v-if="mobileMessageUnread > 0"
            color="primary"
            floating
            rounded
            class="text-[10px] min-w-[16px] max-w-[24px] truncate"
          >
            {{ mobileMessageUnread > 99 ? '99+' : mobileMessageUnread }}
          </q-badge>
        </q-btn>

        <!-- Home -->
        <q-btn
          flat
          round
          icon="sym_o_home"
          size="md"
          :class="['nav-icon-btn', route.path === '/' ? 'home-btn-active' : '']"
          to="/"
          exact
          @click="hapticTap()"
        />

        <!-- Burger Menu -->
        <q-btn
          flat
          dense
          round
          icon="sym_o_menu"
          size="md"
          class="nav-icon-btn"
          @click="
            hapticTap();
            nav.toggleDrawer();
          "
        />
      </div>
    </q-footer>
  </q-layout>

  <q-no-ssr>
    <RiteofPassage v-if="showRiteOfPassage" />
  </q-no-ssr>

  <!-- Account Switcher Dialog -->
  <q-dialog v-model="showAccountSwitcher" transition-show="fade" transition-hide="fade">
    <q-card class="acct-dialog-card">
      <q-card-section class="acct-dialog-header">
        <span class="acct-dialog-title">Switch Account</span>
        <q-btn flat dense round icon="mdi-close" size="sm" @click="showAccountSwitcher = false" />
      </q-card-section>
      <q-card-section class="acct-dialog-body">
        <AccountSwitcher @close="showAccountSwitcher = false" />
      </q-card-section>
    </q-card>
  </q-dialog>
  <!-- In-app arrival banner (Discord-style). Mounted once, above every page, so a
       message that lands while the app is in front of the user is announced here
       instead of as a tray notification. -->
  <ArrivalBanner />
</template>

<script setup lang="ts">
import { useAuthStore } from 'src/stores/auth';
import ArrivalBanner from 'src/components/notifications/ArrivalBanner.vue';
import { useNotificationsStore } from 'src/stores/notifications';
import { useLinksStore } from 'src/stores/links';
import { useGroupStore } from 'src/stores/groupStore';
import type { Notification } from 'src/stores/notifications';
import { ref, computed, provide, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useVaultEnrollment } from 'src/composables/useVaultEnrollment';
import { useQuasar } from 'quasar';
import { useRoute } from 'vue-router';
import { usePlatform } from 'src/composables/usePlatform';
import { registerMobileBackHandler } from 'src/composables/useAndroidBack';
import { hapticTap } from 'src/composables/useHaptics';
import { createSwipeHandlers } from 'src/composables/useSwipeGesture';
import BatteryOptimization from 'src/services/batteryOptimization';
import { useHealthMonitor } from 'src/composables/useHealthMonitor';
import { useNavigation } from 'src/composables/useNavigation';
import DashboardSidebarContent from 'src/components/dashboard/DashboardSidebarContent.vue';
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';
import RiteofPassage from 'src/components/RiteofPassage.vue';
import AccountSwitcher from 'src/components/AccountSwitcher.vue';
import appPackage from '../../package.json';
import { unlockAudio } from 'src/utils/notificationSound';
import { isNativeBuild } from 'src/utils/platform';
import { updateUnreadBadge } from 'src/services/desktopNotifications';

const $q = useQuasar();
const route = useRoute();
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const linksStore = useLinksStore();
const groupStore = useGroupStore();
const { isTauri, isNativeShell, isDesktop, isMobile, viewportWidth } = usePlatform();
const vaultEnroll = useVaultEnrollment();
const masterNavigatorOpen = ref(false);
const vaultUnreadCount = ref(0);
// Native shells (desktop + mobile) share the header version label, the /chains
// messaging link and the account switcher; Tauri-only layout bits stay on
// isTauri / __MOURN_DESKTOP_BUILD__.
const isNativeShellBuild = isNativeBuild;
const appVersion = `v${appPackage.version}`;
const { isOffline, retryNow } = useHealthMonitor();
let stopVaultUnreadSync: (() => void) | null = null;
const TITLEBAR_EVENT = 'mourn:titlebar-label';

function publishTitleBarLabel(label: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TITLEBAR_EVENT, { detail: { label } }));
}

function getMainLayoutLabel(path: string) {
  const routeLabels: Record<string, string> = {
    '/': 'main',
    '/dashboard': 'main',
    '/graveyard': 'graveyard',
    '/help': 'help',
    // '/pricing': 'pricing',
    '/terms': 'terms',
    '/contact': 'contact',
    '/about': 'about',
    '/builders': 'builders',
    '/payment': 'payment',
    '/leaderboard': 'leaderboard',
    '/download': 'download',
    '/desktop-only': 'desktop-only',
    '/archives': 'archives',
    '/login': 'login',
    '/forgot-password': 'forgot password',
    '/reset-password': 'reset password',
    '/verify-email': 'verify email',
    '/register': 'register',
    '/chains': 'chains',
  };

  return routeLabels[path] || path.replace(/^\//, '') || 'main';
}

/** Positions the Tauri master drawer flush under the visible app header (viewport coords). */
function updateMasterNavigatorTop() {
  if (typeof window === 'undefined') return;
  const headerEl = document.querySelector('header.q-header.header') as HTMLElement | null;
  const rect = headerEl?.getBoundingClientRect();
  const titlebarPx = isTauri.value ? 32 : 0;
  let topPx: number;
  if (rect && rect.height > 0) {
    topPx = Math.max(0, Math.round(rect.bottom));
  } else {
    topPx = titlebarPx + 56;
  }
  document.documentElement.style.setProperty('--master-nav-drawer-top', `${topPx}px`);
  if (rect && rect.height > 0) {
    document.documentElement.style.setProperty('--header-height', `${Math.round(rect.height)}px`);
  }
  document.documentElement.style.setProperty('--titlebar-height', `${titlebarPx}px`);
}

function closeMasterNavigator() {
  masterNavigatorOpen.value = false;
}

function openMasterNavigator() {
  updateMasterNavigatorTop();
  masterNavigatorOpen.value = true;
  void nextTick(() => {
    updateMasterNavigatorTop();
    requestAnimationFrame(() => updateMasterNavigatorTop());
  });
}

function toggleMasterNavigator() {
  if (masterNavigatorOpen.value) {
    closeMasterNavigator();
    return;
  }
  openMasterNavigator();
}

function goGraveyardFromMasterNavigator() {
  closeMasterNavigator();
  nav.goGraveyard();
}

async function handleMasterNavigatorLogout() {
  closeMasterNavigator();
  await nav.handleLogout();
}

// Show the desktop download promo button only on desktop web, not in Tauri
const showDesktopDownloadPromo = computed(() => {
  return (
    $q.platform.is.desktop &&
    !$q.platform.is.mobile &&
    !isTauri.value &&
    isDesktop.value &&
    route.path === '/'
  );
});
const showContributionTrigger = computed(() => {
  // Desktop only. On a phone this floats over the home content and competes with
  // the bottom nav; the contribution entry point stays available in the nav
  // drawer (showMobileDrawerContribution) instead.
  return !isTauri.value && isDesktop.value && route.path === '/';
});
const showMobileDrawerContribution = computed(() => {
  return !isTauri.value && isMobile.value;
});
const nav = useNavigation();

/**
 * True only on the HOME page (`/`, IndexPage). krul's rule (2026-10-04): the
 * swipe-right-to-open-navigation gesture must apply on the home page and
 * NOWHERE else — swiping right on messaging, dashboard, profile, etc. must not
 * pull the navigation menu over the content.
 */
const isHomeRoute = computed(() => route.path === '/');

/**
 * Swipe right on the HOME page to open the navigation drawer.
 *
 * Quasar's own swipe-open only arms from the screen edge, which is a tiny target on
 * a phone — this makes the whole page openable. Scoped to the home page only: on
 * every other route the gesture is inert (see `isHomeRoute`).
 */
const drawerSwipeHandlers = createSwipeHandlers({
  axis: 'x',
  threshold: 72,
  shouldStart: (event) => {
    if (isDesktop.value) return false;
    // Home page ONLY. Everywhere else a right-swipe is left to the page's own
    // gestures (tab pager, row reveal, back-from-chat trap) and opens nothing.
    if (!isHomeRoute.value) return false;
    if (nav.isDrawerOpen.value || dashDrawerOpen.value) return false;
    const target = event.target as HTMLElement | null;
    return !target?.closest?.(
      '.vault-input-area, .vault-emoji-picker, .vault-chat-filters, .q-scroll-area--horizontal',
    );
  },
  onPositive: () => {
    void hapticTap();
    // Reached only on the home page now, so this is always the navigation drawer.
    nav.toggleDrawer();
  },
});

/** One-time flag so the battery prompt never nags. */
const BATTERY_PROMPT_KEY = 'mourn.batteryOptimizationPrompted';

/**
 * Android puts an app it has not seen used for a while into a RARE/RESTRICTED
 * standby bucket, and a restricted app is delivered NO FCM messages until it is
 * opened again — which is why notifications stopped arriving entirely once the app
 * had been closed for a long time. Exempting the app from battery optimisation keeps
 * it in a normal bucket. Asked once, and only when it is not already set.
 */
async function ensureBackgroundNotifications(): Promise<void> {
  try {
    const { exempt } = await BatteryOptimization.isExempt();
    if (exempt) return;
    if (localStorage.getItem(BATTERY_PROMPT_KEY) === 'done') return;
    localStorage.setItem(BATTERY_PROMPT_KEY, 'done');
    $q.notify({
      type: 'warning',
      timeout: 0,
      position: 'top',
      message:
        'Keep notifications arriving while Mourn is closed. Android blocks them for apps it considers idle.',
      actions: [
        {
          label: 'ALLOW',
          color: 'white',
          handler: () => {
            void BatteryOptimization.requestExemption();
          },
        },
        { label: 'LATER', color: 'grey', handler: () => undefined },
      ],
    });
  } catch {
    // Not Android, or the plugin is missing — nothing to prompt about.
  }
}

onMounted(() => {
  if (!isDesktop.value) void ensureBackgroundNotifications();
  // If this device lost its Vault keys (Keystore reset, fresh install), messaging is
  // dead until it is re-enrolled. Ask once per session instead of leaving the user
  // with an empty conversation and a send button that does nothing.
  if (isNativeShell.value && authStore.isLoggedIn) vaultEnroll.checkVaultEnrollmentOnBoot();
});
// Account switcher dialog
const showAccountSwitcher = ref(false);

// Desktop search input ref — used to focus the always-visible search bar
const desktopSearchInputRef = ref<{ focus: () => void } | null>(null);

let notificationRefreshTimer: ReturnType<typeof setInterval> | null = null;
let lastNotificationRefreshAt = 0;

/**
 * Refresh the notification list when the app returns to the foreground.
 *
 * The list used to refresh only on mount, on an explicit navigation to the
 * notifications surface, on a push, and on a 5-minute fallback poll — which is
 * why a link request / Suite invitation could sit invisible for minutes ("the
 * notifications are delayed / only show when I open the app"). Coming back to the
 * app is exactly the moment the user notices, so re-fetch then. Throttled so a
 * flurry of focus/visibility events collapses into one request.
 */
function refreshNotificationsIfStale() {
  if (!authStore.isLoggedIn) return;
  const now = Date.now();
  if (now - lastNotificationRefreshAt < 10_000) return;
  lastNotificationRefreshAt = now;
  void notificationsStore.fetchNotifications();
}

function onAppBecameVisible() {
  if (document.visibilityState === 'visible') refreshNotificationsIfStale();
}

// App-icon badge: update whenever total unread count changes. Routed through the
// shared native notification service so it works on desktop (Rust taskbar badge)
// AND mobile (launcher badge).
const totalBadgeCount = computed(() => vaultUnreadCount.value + notificationsStore.unreadCount);

// Mobile footer "Messages" badge: unread 1:1 vault messages (per-link unread
// counters, populated on load even before a chat is opened) plus unread suite
// messages. Purely local state — no polling, so it costs nothing to keep live.
const mobileMessageUnread = computed(() => {
  const oneToOne = linksStore.links.reduce((total, link) => total + (link.unreadCount || 0), 0);
  return oneToOne + groupStore.unreadCount;
});

watch(
  totalBadgeCount,
  async (count) => {
    if (!isNativeShell.value) return;
    await updateUnreadBadge(count);
  },
  { immediate: true },
);

onMounted(() => {
  updateMasterNavigatorTop();
  window.addEventListener('resize', updateMasterNavigatorTop);

  if (isNativeShell.value) {
    import('src/stores/vault')
      .then(({ useVaultStore }) => {
        const vaultStore = useVaultStore();
        vaultUnreadCount.value = vaultStore.unreadCount;
        stopVaultUnreadSync = vaultStore.$subscribe(() => {
          vaultUnreadCount.value = vaultStore.unreadCount;
        });
      })
      .catch(() => {
        vaultUnreadCount.value = 0;
      });
  }

  // Unlock notification audio on first user interaction. unlockAudio() MUST
  // run synchronously inside the gesture handler — calling it from an
  // import(...).then() microtask loses the webview's transient activation and
  // the autoplay unlock silently never takes effect.
  const unlockOnce = () => {
    unlockAudio();
    document.removeEventListener('click', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
    document.removeEventListener('pointerdown', unlockOnce);
  };
  document.addEventListener('click', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });
  document.addEventListener('pointerdown', unlockOnce, { once: true });

  nav.registerDesktopSearchFocus(() => {
    // q-input exposes focus() as a method
    desktopSearchInputRef.value?.focus();
  });

  publishTitleBarLabel(getMainLayoutLabel(route.path));

  // Fetch notifications immediately on mount if logged in
  if (authStore.isLoggedIn) {
    notificationsStore.fetchNotifications();
    lastNotificationRefreshAt = Date.now();
    // Clean up stale/orphaned notifications on startup
    notificationsStore.cleanupStale();

    // Foreground refresh — see refreshNotificationsIfStale. Registered alongside
    // the poll so a notification that arrived while the app was backgrounded (or
    // while the socket was down) appears the moment the user comes back.
    document.addEventListener('visibilitychange', onAppBecameVisible);
    window.addEventListener('focus', refreshNotificationsIfStale);

    // SECURITY: Reduced polling frequency to 5 minutes
    // Polling every 60s creates observability patterns
    // Use SSE for real-time instead, this is fallback only
    notificationRefreshTimer = setInterval(
      () => {
        if (authStore.isLoggedIn) {
          notificationsStore.fetchNotifications();
        }
      },
      5 * 60 * 1000,
    ); // 5 minutes instead of 60 seconds
  }
});

watch(
  () => route.path,
  (path) => {
    publishTitleBarLabel(getMainLayoutLabel(path));
  },
  { immediate: true },
);

/**
 * Mobile: a vertical drag over a list dismisses the keyboard, the way every
 * native chat app behaves. Bound to TOUCH rather than the `scroll` event so the
 * app's own auto-scroll (a new frame arriving) can never close the keyboard
 * mid-typing.
 */
onMounted(() => {
  if (isDesktop.value) return;

  let touchStartY: number | null = null;

  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchStartY === null) return;
    const delta = Math.abs((event.touches[0]?.clientY ?? touchStartY) - touchStartY);
    if (delta < 12) return;
    touchStartY = null;
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
    ) {
      active.blur();
    }
  };

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });

  onUnmounted(() => {
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', updateMasterNavigatorTop);
  document.removeEventListener('visibilitychange', onAppBecameVisible);
  window.removeEventListener('focus', refreshNotificationsIfStale);
  stopVaultUnreadSync?.();
  stopVaultUnreadSync = null;

  disposeDashDrawerBack();

  if (notificationRefreshTimer) {
    clearInterval(notificationRefreshTimer);
  }
});

const showRiteOfPassage = computed(() => {
  const needsToAccept =
    authStore.isLoggedIn && authStore.user && authStore.user.hasAcceptedTerms === false;
  const isOnTermsPage = route.path === '/terms';
  return needsToAccept && !isOnTermsPage;
});

function getLinkId(notification: Notification): string {
  if (notification.type !== 'LINK_REQUEST') return '';
  const data = notification.data as Record<string, unknown> | undefined;
  if (!data) return '';
  const raw = data.linkId ?? data.link_id;
  return typeof raw === 'string' ? raw : '';
}

async function handleNotificationMenuOpen() {
  await notificationsStore.fetchNotifications();
  // Mark all read immediately — setting isRead=true doesn't remove notifications
  // from the list, so LINK_REQUEST accept/reject buttons remain visible.
  void notificationsStore.markAllAsRead();
}

// ───── Dashboard drawer (preserved) ─────
const dashDrawerOpen = ref(false);
const dashboardSidebarProps = ref<Record<string, unknown> | null>(null);

provide('dashDrawerOpen', dashDrawerOpen);

/**
 * Android back closes the mobile nav drawer when it is open, before anything
 * else consumes the press (see boot/androidBack.ts for the full order).
 */
const disposeDashDrawerBack = registerMobileBackHandler(() => {
  if (!dashDrawerOpen.value) return false;
  dashDrawerOpen.value = false;
  return true;
});
provide('setDashboardSidebarProps', (props: Record<string, unknown>) => {
  dashboardSidebarProps.value = props;
});

function handleMobileSidebarTabChange(tabId: string) {
  if (dashboardSidebarProps.value?.['onUpdate:activeTab']) {
    (dashboardSidebarProps.value['onUpdate:activeTab'] as (tabId: string) => void)(tabId);
  }
  dashDrawerOpen.value = false;
}
</script>

<style scoped lang="scss">
@import 'src/css/mainlayout.scss';

/* Account Switcher Dialog */
.acct-dialog-card {
  background: #0a0a0a !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  font-family: monospace;
  min-width: 320px;
}

.acct-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 0 16px;
}

.acct-dialog-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: lowercase;
  letter-spacing: 1px;
}

.acct-dialog-body {
  padding: 8px 16px 16px 16px;
}

/* Page fade transition — defined globally at the bottom of this file; scoped rules
   never matched the route component's root element. */

/* Fade-slide for logo hide/show */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.desktop-contribution-trigger {
  position: fixed;
  right: 1.2rem;
  top: 110px;
  bottom: auto;
  z-index: 1200;
}

.desktop-contribution-btn {
  background: color-mix(in srgb, var(--q-primary) 10%, transparent);
}

@media (max-width: 1023px) {
  .desktop-contribution-trigger {
    right: 50%;
    transform: translateX(50%);
    top: auto;
    bottom: 112px;
  }

  .desktop-contribution-btn {
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    padding: 4px 8px;
    min-height: 28px;
  }
}
</style>

<!-- Unscoped styles for Quasar internal overrides (drawer, etc.) -->
<style lang="scss">
/* Page transitions.
 *
 * These lived in the scoped block above, which compiles to
 * `.page-fade-enter-active[data-v-…]` — the route component's root does not carry
 * that attribute, so Vue measured a 0s transition and swapped pages with no motion
 * at all. Global scope so the classes actually match.
 *
 * Mobile: a short crossfade, not the desktop's 300ms out-in fade. `mode="out-in"`
 * serialises leave→enter, so on a phone the same rules cost 600ms of visible delay
 * on every tab tap; the template now drops out-in on mobile and the leaving page is
 * taken out of flow so the two overlap instead of stacking. */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.3s ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* Phones: instant swap, short fade-in on the incoming page.
 *
 * A true crossfade needs the leaving page taken out of flow (position: absolute),
 * which forces a full relayout of both page trees — measured as a 166ms frame on
 * this device, i.e. worse than no animation at all. With `mode="out-in"` and a 0s
 * leave, Vue drops the old page in the same frame and the new one fades in, so the
 * user sees motion without ever seeing a blank or a stalled frame. */
@media (max-width: 1023px) {
  .page-fade-leave-active {
    transition: none;
  }
  .page-fade-enter-active {
    transition: opacity 0.12s ease-out;
  }
  .page-fade-enter-from {
    opacity: 0;
  }
}

.dash-mobile-drawer .q-drawer__content {
  background: #000 !important;
  overflow: hidden;
}

.dash-mobile-drawer.hidden {
  display: none !important;
}

.global-drawer .q-drawer__content {
  background: #000 !important;
  overflow: visible;
}

/*
 * Master navigator: Quasar merges <q-drawer class="..."> onto div.q-drawer__content, NOT aside.q-drawer,
 * so a selector like .master-navigator-drawer.q-drawer never matched. Target the aside via :has().
 */
aside.q-drawer.q-drawer--right:has([data-master-navigator]) {
  top: var(
    --master-nav-drawer-top,
    calc(var(--titlebar-height, 0px) + var(--header-height, 56px))
  ) !important;
}

aside.q-drawer.q-drawer--right:has([data-master-navigator]) .q-drawer__content {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  height: auto !important;
}

/*
 * Slide in/out: QDrawer ignores transition-show props. Respect Quasar's .no-transition while panning.
 */
aside.q-drawer.q-drawer--right:has([data-master-navigator]):not(.no-transition) {
  transition:
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    top 0.3s ease !important;
}

.q-drawer__backdrop {
  transition: background-color 0.3s ease !important;
  /* The mobile drawer leaves a strip of the page visible beside it; undimmed that
     reads as rendering bleed-through rather than an overlay. */
  background: rgba(0, 0, 0, 0.72) !important;
}

.master-navigator-menu {
  background: var(--black) !important;
  box-shadow: none !important;
  padding: 0 !important;
}

.master-navigator-panel {
  background: var(--black);
  color: var(--dash-text);
}

.master-nav-head {
  background: var(--black);
}

.master-nav-close {
  color: var(--dash-muted) !important;
}

.master-nav-close:hover {
  color: var(--primary) !important;
}

.master-nav-heading {
  color: var(--dash-muted);
  font-size: 10px;
  letter-spacing: 0.35em;
  text-transform: lowercase;
}

.master-nav-link {
  min-height: 36px;
  padding: 0 8px;
  color: var(--dash-text) !important;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.master-nav-link:hover,
.master-nav-link.q-router-link--active {
  background-color: color-mix(in srgb, var(--primary) 15%, transparent) !important;
  color: white !important;
}

.master-nav-link-text {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 12px;
  letter-spacing: 0.14em;
}

.master-nav-contribute {
  border-color: var(--dash-border) !important;
  color: var(--dash-text) !important;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.master-nav-contribute:hover {
  background: rgba(255, 255, 255, 0.03) !important;
  border-color: var(--primary) !important;
  color: var(--primary) !important;
}

.messaging-nav-item {
  position: relative;
}

.messaging-nav-label {
  position: relative;
  min-width: 0;
}

.messaging-nav-note {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  pointer-events: auto;
  color: var(--dash-muted);
  opacity: 0.9;
  transform: translateX(0.9em) translateY(0.05em);
}

.messaging-nav-link {
  cursor: pointer;
}
</style>
