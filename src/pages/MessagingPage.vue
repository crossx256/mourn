<template>
  <div class="messaging-page-root">
    <q-page class="vault-page">
      <!-- No page-level sync gate. Vault establishment runs in the background
           (boot, post-login and app-resume) and only gates what genuinely needs
           keys: a conversation shows its own loader until that conversation's
           messages can be read, and the send button waits for readiness. The old
           full-pane establishing blocker made reopening the page a wait for work
           the user did not ask for. -->

      <div
        class="vault-shell"
        :class="{
          'is-mobile-chat-open': mobileChatOpen,
          'is-chat-dragging': chatDragging,
          'is-chat-revealing': chatRevealing,
        }"
        :style="chatDragVars"
        @touchstart.passive="chatSwipeHandlers.onTouchstart"
        @touchmove.passive="chatSwipeHandlers.onTouchmove"
        @touchend="chatSwipeHandlers.onTouchend"
        @touchcancel="chatSwipeHandlers.onTouchcancel"
      >
        <!-- Offline conversation-list badge (desktop only + authorized) — served from the encrypted vault -->
        <div
          v-if="linksStore.offline && offlineSurfaceVisible"
          class="absolute top-3 right-3 z-50 pointer-events-none"
        >
          <span class="vault-offline-badge">[ offline messages ]</span>
        </div>

        <!-- Offline mode alert (do not show again supported) -->
        <OfflineAlert
          surface="offline_messaging"
          :active="messagingOfflineAlert"
          title="messaging is in offline mode"
          message="You can read your cached chats, but messaging is disabled and nothing new will be sent until you reconnect. Changes saved locally will not reach the server while offline."
        />

        <!-- -------------------------------------------------------------------
          LEFT PANEL � Channels / DM Selector
          ------------------------------------------------------------------- -->
        <aside
          class="vault-left"
          :style="isMobile ? null : { width: sidebarWidth + 'px' }"
          @touchstart.passive="tabSwipeHandlers.onTouchstart"
          @touchmove.passive="tabSwipeHandlers.onTouchmove"
          @touchend="tabSwipeHandlers.onTouchend"
          @touchcancel="tabSwipeHandlers.onTouchcancel"
        >
          <!-- Navigation Tabs.
               The old brand row (// VAULT + Discover + Com settings) is gone: it
               spent a whole row on chrome above the tabs, pushing the list down.
               Discover and Com settings now live behind the (⋮) at the right end of
               this row, which also leaves room for more entries later. -->
          <nav class="vault-nav">
            <button
              v-for="tab in [
                {
                  key: 'chats',
                  label: 'CHATS',
                  icon: 'mdi-message-text-outline',
                  badge: unreadChatCount,
                },
                {
                  key: 'suites',
                  label: 'SUITES',
                  icon: 'mdi-office-building-outline',
                  badge: unreadSuiteCount,
                },
                {
                  key: 'signals',
                  label: 'SIGNALS',
                  icon: 'mdi-bell-ring-outline',
                  badge: incomingCount,
                },
              ]"
              :key="tab.key"
              :class="['vault-nav-btn', { active: activeTab === tab.key }]"
              @click="selectMessagingTab(tab.key)"
            >
              <q-icon :name="tab.icon" size="14px" />
              <span>{{ tab.label }}</span>
              <span v-if="tab.badge > 0" class="vault-badge">{{ tab.badge }}</span>
            </button>

            <!-- Connectivity indicator: only surfaces when the secure socket is
                 down AFTER the vault is up, so startup never flashes it. -->
            <span
              v-if="vaultStore.isInitialized && !vaultStore.transportConnected"
              class="vault-conn-indicator"
              title="Secure socket disconnected — messages may be delayed"
            >
              <q-icon name="mdi-cloud-off-outline" size="13px" />
              <span>OFFLINE</span>
            </span>

            <!-- (⋮) — Discover + Com settings, and the home for whatever gets added
                 next. Hand-rolled popup rather than a <q-menu>: a QMenu nested in its
                 own activator button opens and immediately closes again. -->
            <div class="vault-nav-more">
              <button
                type="button"
                class="vault-nav-more-btn"
                :class="{ 'is-open': navMenuOpen }"
                aria-label="More options"
                @click.stop="navMenuOpen = !navMenuOpen"
              >
                <q-icon name="mdi-dots-vertical" size="18px" />
              </button>
              <template v-if="navMenuOpen">
                <div class="vault-nav-menu-backdrop" @click="navMenuOpen = false" />
                <div class="vault-nav-menu bg-black">
                  <button
                    type="button"
                    class="vault-nav-menu-item"
                    @click="onNavSync"
                  >
                    <q-icon name="mdi-sync" size="16px" />
                    <span>Sync devices</span>
                  </button>
                  <button
                    type="button"
                    class="vault-nav-menu-item"
                    @click="openComsSettingsFromNav"
                  >
                    <q-icon name="mdi-shield-account-variant" size="16px" />
                    <span>Com settings</span>
                  </button>
                </div>
              </template>
            </div>
          </nav>

          <div class="vault-left-divider" />

          <!-- Real pager. All three panes live in ONE horizontal track translated
               by -100% per tab plus the live finger offset, so the outgoing pane
               slides fully off screen while the next slides in — and both are
               visible mid-drag, which is what reads as sliding instead of a swap.
               The pull-to-refresh indicator sits above the track and grows in
               flow, so the list is pushed down the way a native refresh does. -->
          <div
            class="vault-tabs-viewport"
            @touchstart.passive="pullRefreshHandlers.onTouchstart"
            @touchmove.passive="pullRefreshHandlers.onTouchmove"
            @touchend="pullRefreshHandlers.onTouchend"
            @touchcancel="pullRefreshHandlers.onTouchcancel"
          >
            <div
              class="vault-pull-indicator"
              :class="{ 'is-armed': pullArmed }"
              :style="{
                height: pullOffset + 'px',
                transition: pullDragging ? 'none' : 'height 0.2s ease',
              }"
            >
              <q-spinner color="primary" size="14px" />
              <span>{{
                pullRefreshing ? 'REFRESHING' : pullArmed ? 'RELEASE TO REFRESH' : 'PULL TO REFRESH'
              }}</span>
            </div>

            <div
              class="vault-tabs-track"
              :class="{ 'is-dragging': tabDragging || pullDragging }"
              :style="tabTrackStyle"
            >
              <!-- CHATS Panel -->
              <div class="vault-left-body vault-tabs-pane">
                <div v-if="linksStore.linksLoading" class="vault-empty-state">
                  <q-spinner color="primary" size="24px" />
                </div>

                <div v-else-if="linksStore.chatChains.length === 0" class="vault-empty-state">
                  <q-icon name="mdi-link-variant-off" size="32px" class="vault-empty-icon" />
                  <span class="vault-empty-label">NO ACTIVE CHAINS</span>
                  <span class="vault-empty-sub">Use Discover to find users</span>
                  <button class="vault-empty-action" @click="openSearch()">
                    <q-icon name="mdi-account-search" size="14px" />
                    DISCOVER
                  </button>
                </div>

                <q-scroll-area v-else class="vault-scroll">
                  <!-- Filter chips replace the old PINNED / ACTIVE / CLOSED sections.
                   A pinned chat keeps its red left border but no longer gets its own
                   region: pinned chats used to fill the whole pane, which hid every
                   unpinned conversation and its notifications. -->
                  <!-- Chips scroll horizontally; the (+) sits OUTSIDE that scroller,
                       because an overflow-x:auto container clips a popup anchored
                       inside it. -->
                  <div class="vault-chat-filters-row">
                    <div class="vault-chat-filters">
                      <button
                        v-for="option in CHAT_FILTERS"
                        :key="option.key"
                        type="button"
                        class="vault-filter-chip"
                        :class="{ 'is-active': chatFilter === option.key }"
                        @click="chatFilter = option.key"
                      >
                        {{ option.label }}
                        <span
                          v-if="option.key === 'unread' && unreadChatCount > 0"
                          class="vault-filter-count"
                        >
                          {{ unreadChatCount }}
                        </span>
                      </button>
                    </div>

                    <!-- (+) New chat / New suite / Find people. Hand-rolled anchored
                         menu (same pattern as the (⋮)): a <q-menu> anchored to this
                         target computed no position and rendered at (0,0), off screen. -->
                    <div class="vault-filter-add-wrap">
                      <button
                        type="button"
                        class="vault-filter-add"
                        :class="{ 'is-open': newMenuOpen }"
                        aria-label="New chat or suite"
                        @click.stop="newMenuOpen = !newMenuOpen"
                      >
                        <q-icon name="mdi-plus" size="16px" />
                      </button>
                      <template v-if="newMenuOpen">
                        <div class="vault-nav-menu-backdrop" @click="newMenuOpen = false" />
                        <div class="vault-nav-menu bg-black">
                          <button
                            type="button"
                            class="vault-nav-menu-item"
                            @click="onNewMenuAction('chat')"
                          >
                            <q-icon name="mdi-message-plus-outline" size="16px" />
                            <span>New Chat</span>
                          </button>
                          <button
                            type="button"
                            class="vault-nav-menu-item"
                            @click="onNewMenuAction('suite')"
                          >
                            <q-icon name="mdi-account-multiple-plus-outline" size="16px" />
                            <span>New Suite</span>
                          </button>
                          <button
                            type="button"
                            class="vault-nav-menu-item"
                            @click="onNewMenuAction('find')"
                          >
                            <q-icon name="mdi-account-search-outline" size="16px" />
                            <span>Find people</span>
                          </button>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div v-if="visibleChatLinks.length === 0" class="vault-empty-state">
                    <q-icon name="mdi-filter-variant-remove" size="28px" class="vault-empty-icon" />
                    <span class="vault-empty-label">NOTHING HERE</span>
                    <span class="vault-empty-sub">
                      {{
                        chatFilter === 'all'
                          ? 'Use Discover to find users'
                          : 'No ' + chatFilter + ' chats right now'
                      }}
                    </span>
                  </div>

                  <transition-group v-else name="vault-chat-list" tag="div">
                    <ChatListItem
                      v-for="link in visibleChatLinks"
                      :key="link.id"
                      :link="link"
                      :is-active="selectedLink?.id === link.id"
                      @select="openChat"
                      @mark-read="handleChatMarkRead"
                      @toggle-mute="handleChatToggleMute"
                      @vault-sync="handleChatVaultSync"
                      @anchor="handleChatAnchor"
                      @unanchor="handleChatUnanchor"
                      @sever="handleChatSever"
                      @purge="handleChatPurge"
                      @delete-local="handleChatDeleteLocal"
                      @request-relink="handleChatRequestRelink"
                    />
                  </transition-group>
                </q-scroll-area>
              </div>

              <!-- SUITES Panel -->
              <div class="vault-left-body vault-tabs-pane">
                <div class="vault-suites-head">
                  <span class="vault-suites-title">YOUR SUITES</span>
                  <q-btn
                    flat
                    dense
                    no-caps
                    icon="mdi-earth"
                    label="DISCOVER"
                    class="btn-secondary vault-discover-btn"
                    @click="openGroupDiscover()"
                  />
                  <q-btn
                    flat
                    dense
                    no-caps
                    icon="mdi-plus"
                    label="CREATE"
                    class="vault-create-btn"
                    :disable="ownedSuiteCount >= 3"
                    @click="openCreateSuite()"
                  />
                </div>

                <div v-if="groupStore.groupsLoading" class="vault-empty-state">
                  <q-spinner color="primary" size="24px" />
                </div>

                <div v-else-if="suitesList.length === 0" class="vault-empty-state">
                  <q-icon name="mdi-office-building-outline" size="32px" class="vault-empty-icon" />
                  <span class="vault-empty-label">NO SUITES</span>
                  <span class="vault-empty-sub">Tap DISCOVER to find public suites</span>
                </div>

                <q-scroll-area v-else class="vault-scroll">
                  <div
                    v-for="g in suitesList"
                    :key="g.id"
                    :class="['vault-suite-item', { active: isSuiteActive(g.id) }]"
                    @click="openGroupChat(g.id)"
                    @contextmenu.prevent="openSuiteMenu($event, g)"
                  >
                    <q-avatar size="36px" class="vault-suite-avatar">
                      <MournLogoInline v-if="isBroadcastId(g.id)" class="vault-suite-mourn-logo" />
                      <img v-else-if="g.avatarUrl" :src="g.avatarUrl" :alt="g.name" />
                      <q-icon v-else name="mdi-shape" size="18px" color="grey-6" />
                    </q-avatar>
                    <div class="vault-suite-info">
                      <span class="vault-suite-name">
                        <q-icon v-if="g.isPinned" name="mdi-pin" size="14px" class="q-mr-xs" />
                        {{ g.name }}
                        <span v-if="g.isLeft" class="text-grey-6 text-xs q-ml-xs">(left)</span>
                      </span>
                      <span class="vault-suite-sub"
                        >{{ g.memberCount ?? g.members?.length ?? 0 }} members</span
                      >
                    </div>
                    <div class="vault-suite-actions">
                      <span v-if="suiteUnreadCount(g.id) > 0" class="vault-badge">
                        {{ suiteUnreadCount(g.id) }}
                      </span>
                      <template v-if="!isBroadcastId(g.id)">
                        <q-btn
                          flat
                          round
                          dense
                          :icon="g.isPinned ? 'mdi-pin' : 'mdi-pin-outline'"
                          size="xs"
                          class="vault-icon-btn"
                          :class="{ 'text-primary': g.isPinned }"
                          @click.stop="groupStore.togglePinGroup(g.id)"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-cog-outline"
                          size="xs"
                          class="vault-icon-btn"
                          @click.stop="openGroupSettings(g.id)"
                        />
                      </template>
                    </div>
                  </div>
                </q-scroll-area>
              </div>

              <!-- SIGNALS Panel -->
              <div class="vault-left-body vault-tabs-pane">
                <div v-if="linksStore.linksLoading" class="vault-empty-state">
                  <q-spinner color="primary" size="24px" />
                </div>

                <div v-else-if="!hasSignals" class="vault-empty-state">
                  <q-icon name="mdi-bell-sleep-outline" size="32px" class="vault-empty-icon" />
                  <span class="vault-empty-label">NO SIGNALS</span>
                </div>

                <q-scroll-area v-else class="vault-scroll">
                  <!-- Incoming -->
                  <template v-if="incomingRequests.length > 0">
                    <div class="vault-cat vault-cat--incoming">
                      <q-icon name="mdi-arrow-down-bold" size="12px" />
                      <span>INCOMING</span>
                    </div>
                    <div v-for="link in incomingRequests" :key="link.id" class="vault-signal-item">
                      <q-avatar size="32px" class="vault-signal-avatar">
                        <img
                          v-if="link.sender?.profile?.profilePicture"
                          :src="link.sender?.profile?.profilePicture"
                          :alt="link.sender?.username"
                        />
                        <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
                      </q-avatar>
                      <div class="vault-signal-info">
                        <span class="vault-signal-name">
                          {{
                            link.sender?.profile?.displayName || link.sender?.username || 'Unknown'
                          }}
                        </span>
                        <span class="vault-signal-sub"
                          >@{{ link.sender?.username ?? 'user' }} wants to link</span
                        >
                      </div>
                      <div class="vault-signal-actions">
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-check"
                          size="xs"
                          class="vault-signal-accept"
                          :loading="respondingId === link.id"
                          @click.stop="respond(link.id, 'accept')"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-close"
                          size="xs"
                          class="vault-signal-reject"
                          :loading="respondingId === link.id"
                          @click.stop="respond(link.id, 'reject')"
                        />
                      </div>
                    </div>
                  </template>

                  <!-- Outgoing -->
                  <template v-if="outgoingRequests.length > 0">
                    <div class="vault-cat vault-cat--pending">
                      <q-icon name="mdi-arrow-up-bold" size="12px" />
                      <span>OUTGOING</span>
                    </div>
                    <div v-for="link in outgoingRequests" :key="link.id" class="vault-signal-item">
                      <q-avatar size="32px" class="vault-signal-avatar">
                        <img
                          v-if="link.receiver?.profile?.profilePicture"
                          :src="link.receiver?.profile?.profilePicture"
                          :alt="link.receiver?.username"
                        />
                        <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
                      </q-avatar>
                      <div class="vault-signal-info">
                        <span class="vault-signal-name">
                          {{
                            link.receiver?.profile?.displayName ||
                            link.receiver?.username ||
                            'Unknown'
                          }}
                        </span>
                        <span class="vault-signal-sub"
                          >Waiting for @{{ link.receiver?.username ?? 'user' }}</span
                        >
                      </div>
                      <div class="vault-signal-actions">
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-close"
                          size="xs"
                          class="vault-signal-reject"
                          :loading="cancellingLinkId === link.id"
                          @click.stop="cancelOutgoingLink(link.id)"
                        >
                          <q-tooltip class="font-mono text-[10px]">Cancel request</q-tooltip>
                        </q-btn>
                      </div>
                    </div>
                  </template>

                  <!-- Sent Suite join requests -->
                  <template v-if="pendingSentGroupRequests.length > 0">
                    <div class="vault-cat vault-cat--pending">
                      <q-icon name="mdi-office-building-clock-outline" size="12px" />
                      <span>SUITE REQUESTS</span>
                    </div>
                    <div
                      v-for="request in pendingSentGroupRequests"
                      :key="request.requestId || request.groupId"
                      class="vault-signal-item"
                    >
                      <q-avatar size="32px" class="vault-signal-avatar">
                        <img
                          v-if="request.group.avatarUrl"
                          :src="request.group.avatarUrl"
                          :alt="request.group.name"
                        />
                        <q-icon v-else name="mdi-shape" size="18px" color="grey-6" />
                      </q-avatar>
                      <div class="vault-signal-info">
                        <span class="vault-signal-name">{{ request.group.name }}</span>
                        <span class="vault-signal-sub">Waiting for Suite approval</span>
                      </div>
                      <div class="vault-signal-actions">
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-close"
                          size="xs"
                          class="vault-signal-reject"
                          :loading="cancellingGroupId === request.groupId"
                          @click.stop="cancelJoinRequest(request.groupId)"
                        >
                          <q-tooltip class="font-mono text-[10px]">Cancel request</q-tooltip>
                        </q-btn>
                      </div>
                    </div>
                  </template>

                  <!-- Incoming Invites (to me) -->
                  <template v-if="groupStore.myInvites.length > 0">
                    <div class="vault-cat vault-cat--incoming">
                      <q-icon name="mdi-account-plus" size="12px" />
                      <span>INVITES</span>
                      <span class="vault-cat-count">{{ groupStore.myInvites.length }}</span>
                    </div>
                    <div
                      v-for="inv in groupStore.myInvites"
                      :key="inv.id"
                      class="vault-signal-item"
                    >
                      <q-avatar size="32px" class="vault-signal-avatar">
                        <img
                          v-if="inv.group.avatarUrl"
                          :src="inv.group.avatarUrl"
                          :alt="inv.group.name"
                        />
                        <q-icon v-else name="mdi-shape" size="18px" color="grey-6" />
                      </q-avatar>
                      <div class="vault-signal-info">
                        <span class="vault-signal-name">Suite invitation</span>
                        <span class="vault-signal-sub"
                          >You’re being added to {{ inv.group.name }}</span
                        >
                      </div>
                      <div class="vault-signal-actions">
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-check"
                          size="xs"
                          class="vault-signal-accept"
                          :loading="groupInviteRespondingId === inv.id"
                          @click.stop="respondGroupInvite(inv, 'ACCEPTED')"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-close"
                          size="xs"
                          class="vault-signal-reject"
                          :loading="groupInviteRespondingId === inv.id"
                          @click.stop="respondGroupInvite(inv, 'REJECTED')"
                        />
                      </div>
                    </div>
                  </template>

                  <!-- Join Requests (group owner) -->
                  <template v-if="groupJoinRequests.length > 0">
                    <div class="vault-cat vault-cat--incoming">
                      <q-icon name="mdi-account-plus" size="12px" />
                      <span>JOIN REQUESTS</span>
                    </div>
                    <div
                      v-for="req in groupJoinRequests"
                      :key="req.requestId"
                      class="vault-signal-item"
                    >
                      <q-avatar size="32px" class="vault-signal-avatar">
                        <q-icon name="mdi-office-building-outline" size="18px" color="grey-6" />
                      </q-avatar>
                      <div class="vault-signal-info">
                        <span class="vault-signal-name">{{ req.groupName }}</span>
                        <span class="vault-signal-sub">@{{ req.username }} requests to join</span>
                      </div>
                      <div class="vault-signal-actions">
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-check"
                          size="xs"
                          class="vault-signal-accept"
                          :loading="groupRespondingId === req.requestId"
                          @click.stop="respondGroupRequest(req, 'ACCEPTED')"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          icon="mdi-close"
                          size="xs"
                          class="vault-signal-reject"
                          :loading="groupRespondingId === req.requestId"
                          @click.stop="respondGroupRequest(req, 'REJECTED')"
                        />
                      </div>
                    </div>
                  </template>
                </q-scroll-area>
              </div>
            </div>
          </div>
        </aside>

        <!-- Resize handle -->
        <div class="vault-resize" @mousedown.prevent="startResize" />

        <!-- -------------------------------------------------------------------
           CENTER PANEL � Chat Area
           ------------------------------------------------------------------- -->
        <main
          class="vault-center"
          :style="chatPaneStyle"
          @dragenter.prevent="onChatDragEnter"
          @dragover.prevent="onChatDragOver"
          @dragleave.prevent="onChatDragLeave"
          @drop.prevent="onChatDrop"
        >
          <!-- No chat selected -->
          <div
            v-if="!selectedLink && !groupStore.activeGroupId && !broadcastActive"
            class="vault-center-empty"
          >
            <div class="vault-center-empty-inner">
              <div class="vault-hex-icon">
                <q-icon name="mdi-shield-lock-outline" size="36px" />
              </div>
              <span class="vault-center-empty-title">SELECT A CHAIN</span>
              <span class="vault-center-empty-sub">
                Zero-trust E2EE messaging.<br />Choose a conversation to begin.
              </span>
            </div>
          </div>

          <!-- Announcement broadcast channel -->
          <BroadcastChatWindow v-else-if="broadcastActive" key="broadcast" @close="onChatBack" />

          <!-- Group chat -->
          <GroupChatWindow
            v-else-if="groupStore.activeGroupId"
            :key="groupStore.activeGroupId"
            :group-id="groupStore.activeGroupId"
            :right-panel-open="rightPanelOpen"
            @close="onChatBack"
            @open-settings="openGroupSettings(groupStore.activeGroupId)"
            @invite="openGroupInvite(groupStore.activeGroupId)"
            @leave="confirmLeaveGroup(groupStore.activeGroupId)"
            @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
          />

          <template v-else-if="selectedLink">
            <!-- Chat Header -->
            <header class="vault-chat-head">
              <div class="vault-chat-head-left">
                <button class="vault-back-btn" @click="closeConversation">
                  <q-icon name="mdi-arrow-left" size="16px" />
                </button>
                <q-avatar size="36px" class="vault-head-avatar">
                  <img :src="partnerAvatar" />
                </q-avatar>
                <div class="vault-head-info">
                  <span class="vault-head-name">{{ chatPartnerName }}</span>
                  <span class="vault-head-status">
                    <template v-if="selectedLink.status === 'ANCHORED'">
                      <q-icon name="mdi-pin" size="10px" class="text-[var(--dash-accent)]" />
                      PINNED
                    </template>
                    <template v-else-if="selectedLink.status === 'SEVERED'">
                      <q-icon name="mdi-link-off" size="10px" class="text-[var(--dash-accent)]" />
                      CLOSED
                    </template>
                    <template v-else-if="selectedLink.status === 'ESTABLISHED'">
                      <q-icon name="mdi-timer-sand" size="10px" />
                      {{ chatTimeRemaining }}
                    </template>
                  </span>
                </div>
              </div>

              <div class="vault-chat-head-right">
                <q-btn
                  v-if="!messageSearchMode"
                  flat
                  round
                  dense
                  icon="search"
                  size="sm"
                  class="vault-icon-btn"
                  @click="enterSearchMode"
                >
                  <q-tooltip class="font-mono text-[10px]">Search Messages</q-tooltip>
                </q-btn>

                <q-btn
                  v-if="!messageSearchMode"
                  flat
                  round
                  dense
                  icon="mdi-dots-vertical"
                  size="sm"
                  class="vault-icon-btn"
                >
                  <q-tooltip class="font-mono text-[10px]">Actions</q-tooltip>
                  <q-menu anchor="bottom right" self="top right" class="vault-action-menu">
                    <q-list style="min-width: 200px">
                      <q-item clickable @click="() => requestVaultSync()">
                        <q-item-section avatar>
                          <q-icon name="mdi-sync" size="14px" />
                        </q-item-section>
                        <q-item-section>Sync Messages</q-item-section>
                      </q-item>
                      <q-item
                        v-if="selectedLink && partnerUsername !== 'user'"
                        clickable
                        @click="openPartnerProfile"
                      >
                        <q-item-section avatar>
                          <q-icon name="mdi-account-box-outline" size="14px" />
                        </q-item-section>
                        <q-item-section>View Profile</q-item-section>
                      </q-item>
                      <q-separator />
                      <q-item
                        v-if="selectedLink.status === 'ESTABLISHED'"
                        clickable
                        @click="anchorCurrentChat"
                      >
                        <q-item-section avatar>
                          <q-icon name="mdi-link-lock" size="14px" />
                        </q-item-section>
                        <q-item-section>Pin Connection</q-item-section>
                      </q-item>
                      <q-item
                        v-if="selectedLink.status === 'ANCHORED'"
                        clickable
                        @click="unanchorCurrentChat"
                      >
                        <q-item-section avatar>
                          <q-icon name="mdi-link-variant-off" size="14px" />
                        </q-item-section>
                        <q-item-section>Unpin</q-item-section>
                      </q-item>
                      <template v-if="selectedLink.status === 'SEVERED'">
                        <q-separator />
                        <q-item clickable @click="purgeCurrentSeveredFromHeader">
                          <q-item-section avatar>
                            <q-icon
                              name="mdi-delete"
                              size="14px"
                              class="text-[var(--dash-accent)]"
                            />
                          </q-item-section>
                          <q-item-section class="text-[var(--dash-accent)]">Remove</q-item-section>
                        </q-item>
                        <q-item clickable @click="requestRelink">
                          <q-item-section avatar>
                            <q-icon name="mdi-link-plus" size="14px" />
                          </q-item-section>
                          <q-item-section>Reconnect</q-item-section>
                        </q-item>
                      </template>
                      <template v-else>
                        <q-item
                          v-if="
                            selectedLink.status === 'ESTABLISHED' ||
                            selectedLink.status === 'ANCHORED'
                          "
                          clickable
                          @click="severLinkKeepHistory"
                        >
                          <q-item-section avatar>
                            <q-icon name="mdi-link-off" size="14px" />
                          </q-item-section>
                          <q-item-section>Close (Keep History)</q-item-section>
                        </q-item>
                        <q-item
                          v-if="
                            selectedLink.status === 'ESTABLISHED' ||
                            selectedLink.status === 'ANCHORED'
                          "
                          clickable
                          @click="purgeOpenLinkLocalFromHeader"
                        >
                          <q-item-section avatar>
                            <q-icon
                              name="mdi-delete"
                              size="14px"
                              class="text-[var(--dash-accent)]"
                            />
                          </q-item-section>
                          <q-item-section class="text-[var(--dash-accent)]"
                            >Clear History</q-item-section
                          >
                        </q-item>
                        <q-item
                          v-if="
                            selectedLink.status === 'ESTABLISHED' ||
                            selectedLink.status === 'ANCHORED'
                          "
                          clickable
                          @click="severLinkAndPurge"
                        >
                          <q-item-section avatar>
                            <q-icon name="mdi-delete-forever" size="14px" />
                          </q-item-section>
                          <q-item-section>Close &amp; Clear</q-item-section>
                        </q-item>
                      </template>
                      <q-separator />
                      <!-- Report the whole conversation. Same contract as the
                           message context menu: targetRef is the link id, and
                           the composer's thread picker decides which messages
                           the reviewer actually reads. -->
                      <q-item clickable @click="reportCurrentConversation">
                        <q-item-section avatar>
                          <q-icon
                            name="mdi-alert-octagon-outline"
                            size="14px"
                            class="text-[#ffaa00]"
                          />
                        </q-item-section>
                        <q-item-section class="text-[#ffaa00]">Report Conversation</q-item-section>
                      </q-item>
                      <q-separator />
                      <q-item clickable @click="showSettingsModal = true">
                        <q-item-section avatar>
                          <q-icon name="mdi-shield-lock" size="14px" />
                        </q-item-section>
                        <q-item-section>Message Retention</q-item-section>
                      </q-item>
                      <q-item clickable @click="showChatSettingsModal = true">
                        <q-item-section avatar>
                          <q-icon name="mdi-cog" size="14px" />
                        </q-item-section>
                        <q-item-section>Chat Settings</q-item-section>
                      </q-item>
                      <q-item clickable @click="showDeleteModal = true">
                        <q-item-section avatar>
                          <q-icon name="mdi-delete-variant" size="14px" />
                        </q-item-section>
                        <q-item-section>Delete Chat</q-item-section>
                      </q-item>
                    </q-list>
                  </q-menu>
                </q-btn>

                <q-btn
                  v-if="!messageSearchMode && canToggleRightPanel"
                  flat
                  round
                  dense
                  :icon="rightPanelOpen ? 'mdi-dock-right' : 'mdi-dock-right'"
                  size="sm"
                  class="vault-icon-btn"
                  @click="rightPanelOpen = !rightPanelOpen"
                >
                  <q-tooltip class="font-mono text-[10px]">{{
                    rightPanelOpen ? 'Hide Panel' : 'Show Panel'
                  }}</q-tooltip>
                </q-btn>
              </div>
            </header>

            <!-- Search Mode UI -->
            <div v-if="messageSearchMode" class="vault-search-bar">
              <q-btn
                flat
                round
                dense
                icon="close"
                size="sm"
                class="vault-icon-btn"
                @click="exitSearchMode"
              />
              <q-input
                v-model="messageSearchQuery"
                flat
                dense
                type="text"
                placeholder="Search messages..."
                class="vault-search-input"
                @keydown.enter="performMessageSearch"
                @keydown="onSearchKeydown"
              />
              <div v-if="searchResults.length > 0" class="vault-search-counter">
                {{ searchCurrentIndex + 1 }} / {{ searchResults.length }}
              </div>
              <q-btn
                v-if="searchResults.length > 0"
                flat
                round
                dense
                icon="expand_less"
                size="sm"
                class="vault-icon-btn"
                @click="navigateSearchPrev"
              />
              <q-btn
                v-if="searchResults.length > 0"
                flat
                round
                dense
                icon="expand_more"
                size="sm"
                class="vault-icon-btn"
                @click="navigateSearchNext"
              />
              <q-btn
                flat
                round
                dense
                icon="check"
                size="sm"
                class="vault-icon-btn"
                @click="performMessageSearch"
              />
            </div>

            <!-- Security Banners -->
            <div
              v-if="isCompromised && !tempSafetyActive && !isSevered"
              class="vault-banner vault-banner--danger"
            >
              <q-icon name="mdi-shield-alert" size="14px" />
              <span>SECURITY: Device identity changed. Link quarantined.</span>
              <q-space />
              <button class="vault-banner-action" @click="showCompromiseModal = true">
                TAKE ACTION
              </button>
            </div>

            <div v-if="quarantinedQueue.length > 0" class="vault-banner vault-banner--warning">
              <q-icon name="mdi-shield-key" size="14px" />
              <span>{{ quarantinedQueue.length }} messages blocked from compromised link</span>
              <q-space />
              <button
                class="vault-banner-action vault-banner-action--allow"
                @click="allowQuarantine"
              >
                Allow
              </button>
              <button
                class="vault-banner-action vault-banner-action--reject"
                @click="rejectQuarantine"
              >
                Reject
              </button>
            </div>

            <!-- Messages Area -->
            <q-scroll-area ref="messagesScrollRef" class="vault-messages">
              <!-- Still reading this conversation: never claim the channel is empty
                   before we have actually read it. A transient empty store read (a
                   re-init, or a teardown mid-send) used to render the empty state
                   over a chat that has messages — the "chats show empty" report. -->
              <div
                v-if="vaultMessages.length === 0 && !messagesReady"
                class="vault-messages-loading"
              >
                <q-spinner color="primary" size="26px" />
              </div>

              <!-- Empty chat -->
              <div v-else-if="vaultMessages.length === 0" class="vault-messages-empty">
                <div class="vault-lock-icon">
                  <q-icon :name="vaultEnrollmentNeeded ? 'mdi-shield-lock-outline' : 'mdi-lock-outline'" size="40px" />
                </div>
                <span class="vault-messages-empty-title">{{
                  vaultEnrollmentNeeded ? 'MESSAGES LOCKED' : 'NO MESSAGES YET'
                }}</span>
                <span class="vault-messages-empty-sub">
                  <template v-if="vaultEnrollmentNeeded">
                    This device isn't enrolled for the Vault.<br />
                    Unlock it below to read and send messages.
                  </template>
                  <template v-else>
                    End-to-end encrypted. Zero-trust architecture.<br />
                    Say something to start the conversation.
                  </template>
                </span>
              </div>

              <!-- Message List -->
              <div v-else ref="messageListRef" class="vault-message-list">
                <template v-for="(msg, idx) in vaultMessages" :key="msg.id">
                  <!-- Day separator -->
                  <div
                    v-if="isDifferentDay(vaultMessages[idx - 1]?.timestamp, msg.timestamp)"
                    class="vault-day-sep"
                  >
                    <span class="vault-day-sep-label">{{ formatDaySeparator(msg.timestamp) }}</span>
                  </div>

                  <div
                    :data-msg-id="msg.id"
                    :class="[
                      'vault-msg',
                      msg.isSender ? 'vault-msg--sent' : 'vault-msg--recv',
                      msg.status?.startsWith('FAILED') ? 'vault-msg--failed' : '',
                      { 'vault-msg--reply-to-me': isVaultReplyToMe(msg) },
                    ]"
                    @contextmenu.prevent="openContextMenu($event, msg)"
                    @dblclick.stop.prevent="startReplyingToMessage(msg)"
                    @mouseenter="hoveredMsgId = msg.id"
                    @mouseleave="hoveredMsgId = null"
                  >
                    <!-- Kept in the DOM even mid-streak (just hidden) so every
                         bubble in the run stays on the same left edge. -->
                    <q-avatar
                      size="40px"
                      :class="[
                        'vault-msg-avatar',
                        {
                          'vault-msg-avatar--unsafe': msg.isUnsafe,
                          'is-continuation': !isStreakStart(idx),
                        },
                      ]"
                      :style="isStreakStart(idx) ? null : { visibility: 'hidden' }"
                    >
                      <img :src="msg.isSender ? myAvatar : partnerAvatar" />
                    </q-avatar>
                    <div class="vault-msg-body">
                      <div class="vault-msg-meta">
                        <span v-if="isStreakStart(idx)" class="vault-msg-sender">
                          {{ msg.isSender ? myUsername : partnerUsername }}
                        </span>
                        <span class="vault-msg-time">
                          <q-icon
                            v-if="msg.status?.startsWith('FAILED')"
                            name="mdi-exclamation-circle"
                            size="10px"
                            class="text-red-600 mr-1"
                          />
                          {{ formatDiscordLikeTimestamp(msg.timestamp) }}
                        </span>
                      </div>

                      <MessageReplyReference
                        v-if="msg.replyTo"
                        :reference="msg.replyTo"
                        @navigate="scrollToMessage"
                      />

                      <div
                        v-if="hasBubbleContent(msg)"
                        :class="[
                          'vault-msg-bubble',
                          msg.isSender ? 'vault-msg-bubble--sent' : 'vault-msg-bubble--recv',
                          msg.isUnsafe ? 'vault-msg-bubble--unsafe' : '',
                          msg.status?.startsWith('FAILED') ? 'vault-msg-bubble--failed' : '',
                        ]"
                      >
                        <!-- Rich content: text with embeds (hidden if text is empty after media strip) -->
                        <div
                          v-if="renderMessageContent(msg.text)"
                          class="vault-msg-text"
                          v-html="renderMessageContent(msg.text)"
                        />

                        <button
                          v-if="
                            !remoteMediaAllowed[msg.id] &&
                            ((imagesMap[msg.id]?.length ?? 0) > 0 ||
                              (gifsMap[msg.id]?.length ?? 0) > 0 ||
                              extractVideos(msg.text).length > 0)
                          "
                          class="vault-remote-media-consent"
                          @click="remoteMediaAllowed[msg.id] = true"
                        >
                          load remote media
                        </button>

                        <!-- Remote embeds load only after explicit recipient consent. -->
                        <div
                          v-if="
                            remoteMediaAllowed[msg.id] &&
                            ((imagesMap[msg.id]?.length ?? 0) > 0 ||
                              (gifsMap[msg.id]?.length ?? 0) > 0)
                          "
                          class="vault-msg-images"
                        >
                          <img
                            v-for="(imgUrl, idx) in imagesMap[msg.id] || []"
                            :key="'img-' + idx"
                            :src="imgUrl"
                            class="vault-msg-image"
                            loading="lazy"
                            referrerpolicy="no-referrer"
                            @click="openImagePreview(imgUrl)"
                            @contextmenu.prevent.stop="
                              openMediaContextMenu($event, imgUrl, 'image')
                            "
                            @error="($event.target as HTMLImageElement).style.display = 'none'"
                          />
                          <div
                            v-for="(gifUrl, idx) in gifsMap[msg.id] || []"
                            :key="'gif-' + idx"
                            class="vault-gif-loader-wrapper"
                          >
                            <img
                              :src="gifUrl"
                              class="vault-msg-image vault-msg-gif"
                              loading="lazy"
                              referrerpolicy="no-referrer"
                              @click="openImagePreview(gifUrl)"
                              @contextmenu.prevent.stop="
                                openMediaContextMenu($event, gifUrl, 'image')
                              "
                              @load="gifLoadingStates[msg.id + '-gif-' + idx] = false"
                              @error="
                                (e) => {
                                  gifLoadingStates[msg.id + '-gif-' + idx] = false;
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }
                              "
                            />
                            <div
                              v-if="gifLoadingStates[msg.id + '-gif-' + idx] !== false"
                              class="vault-gif-loading-spinner"
                            >
                              <q-spinner size="32px" color="primary" />
                            </div>
                          </div>
                        </div>

                        <!-- Video embeds — custom player -->
                        <div
                          v-if="remoteMediaAllowed[msg.id] && extractVideos(msg.text).length > 0"
                          class="vault-msg-videos"
                        >
                          <div
                            v-for="(vidUrl, idx) in extractVideos(msg.text)"
                            :key="idx"
                            :class="[
                              'vault-video-wrapper',
                              {
                                'vault-video-wrapper--expanded':
                                  videoStates[msg.id + '-' + idx]?.expanded,
                              },
                            ]"
                            @contextmenu.prevent.stop="
                              openMediaContextMenu($event, vidUrl, 'video')
                            "
                          >
                            <video
                              :ref="
                                (el) => registerVideoRef(msg.id + '-' + idx, el as HTMLVideoElement)
                              "
                              :src="vidUrl"
                              class="vault-video-el"
                              preload="metadata"
                              muted
                              @loadedmetadata="onVideoMeta(msg.id + '-' + idx, $event)"
                              @timeupdate="onVideoTime(msg.id + '-' + idx, $event)"
                              @ended="
                                videoStates[msg.id + '-' + idx]
                                  ? (videoStates[msg.id + '-' + idx]!.playing = false)
                                  : undefined
                              "
                              @error="($event.target as HTMLVideoElement).style.display = 'none'"
                            />
                            <div class="vault-video-controls">
                              <button
                                class="vault-vc-btn"
                                @click="toggleVideoPlay(msg.id + '-' + idx)"
                              >
                                <q-icon
                                  :name="
                                    videoStates[msg.id + '-' + idx]?.playing
                                      ? 'mdi-pause'
                                      : 'mdi-play'
                                  "
                                  size="18px"
                                />
                              </button>
                              <div
                                class="vault-vc-progress"
                                @click="seekVideo(msg.id + '-' + idx, $event)"
                              >
                                <div
                                  class="vault-vc-progress-bar"
                                  :style="{
                                    width: (videoStates[msg.id + '-' + idx]?.progress ?? 0) + '%',
                                  }"
                                />
                              </div>
                              <span class="vault-vc-time">
                                {{
                                  formatVideoTime(videoStates[msg.id + '-' + idx]?.currentTime ?? 0)
                                }}
                              </span>
                              <button
                                class="vault-vc-btn"
                                @click="toggleVideoMute(msg.id + '-' + idx)"
                              >
                                <q-icon
                                  :name="
                                    videoStates[msg.id + '-' + idx]?.muted !== false
                                      ? 'mdi-volume-off'
                                      : 'mdi-volume-high'
                                  "
                                  size="16px"
                                />
                              </button>
                              <button
                                class="vault-vc-btn"
                                @click="toggleVideoExpand(msg.id + '-' + idx)"
                              >
                                <q-icon
                                  :name="
                                    videoStates[msg.id + '-' + idx]?.expanded
                                      ? 'mdi-fullscreen-exit'
                                      : 'mdi-fullscreen'
                                  "
                                  size="16px"
                                />
                              </button>
                            </div>
                          </div>
                        </div>

                        <!-- Link embeds with favicon -->
                        <div
                          v-for="embed in extractLinkEmbeds(msg.text)"
                          :key="embed.url"
                          class="vault-msg-embed"
                        >
                          <q-icon name="mdi-link" size="16px" class="vault-embed-favicon" />
                          <div class="vault-embed-info">
                            <a
                              :href="embed.url"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="vault-embed-link"
                            >
                              {{ embed.hostname }}
                            </a>
                            <span class="vault-embed-path">{{ embed.path }}</span>
                          </div>
                          <q-icon name="mdi-open-in-new" size="12px" class="vault-embed-external" />
                        </div>
                      </div>

                      <!-- Blob attachment. Images and videos render as a single
                           media box with NO filename/size strip (WhatsApp/Discord
                           shape); audio gets an inline Discord-style player; any
                           other file is an always-visible file row (mobile has no
                           hover, so the old hover-only row was invisible and the
                           bubble read as an empty dark rectangle). -->
                      <div
                        v-if="blobAttachmentsMap[msg.id]"
                        class="vault-blob-attachment"
                        @mouseenter="void ensureBlobPreview(msg.text)"
                      >
                        <!-- IMAGE — one rounded box, no metadata strip -->
                        <div
                          v-if="isBlobImage(blobAttachmentsMap[msg.id]!.mimetype)"
                          class="vault-blob-media vault-blob-media--image"
                        >
                          <img
                            v-if="blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            :src="blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            :alt="blobAttachmentsMap[msg.id]!.filename"
                            loading="lazy"
                            @click="
                              openImagePreview(
                                blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]!,
                                blobAttachmentsMap[msg.id]!.filename,
                              )
                            "
                          />
                          <div
                            v-else-if="
                              blobAttachmentErrors[blobAttachmentsMap[msg.id]!.blobId]
                            "
                            class="vault-blob-media-loading vault-blob-media-unavailable"
                          >
                            <q-icon name="mdi-image-off-outline" size="26px" />
                            <span class="vault-blob-unavailable-text">No longer available</span>
                          </div>
                          <div v-else class="vault-blob-media-loading">
                            <q-spinner color="primary" size="28px" />
                          </div>
                          <button
                            class="vault-blob-media-save"
                            :disabled="!!downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId]"
                            title="Download"
                            @click.stop="downloadBlobAttachment(msg.text)"
                          >
                            <q-icon
                              :name="
                                downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId]
                                  ? 'mdi-loading'
                                  : savedBlobSuccess[blobAttachmentsMap[msg.id]!.blobId]
                                    ? 'mdi-check-circle'
                                    : 'mdi-download'
                              "
                              size="16px"
                              :class="{
                                'vault-blob-spinner':
                                  !!downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId],
                              }"
                            />
                          </button>
                        </div>

                        <!-- VIDEO — one rounded box, no metadata strip -->
                        <div
                          v-else-if="isBlobVideo(blobAttachmentsMap[msg.id]!.mimetype)"
                          class="vault-blob-media vault-blob-media--video"
                        >
                          <video
                            v-if="blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            :src="blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            class="vault-video-el"
                            controls
                            preload="metadata"
                            @click.stop="
                              openVideoPreview(
                                blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]!,
                                blobAttachmentsMap[msg.id]!.filename,
                              )
                            "
                          />
                          <div
                            v-else-if="
                              blobAttachmentErrors[blobAttachmentsMap[msg.id]!.blobId]
                            "
                            class="vault-blob-media-loading vault-blob-media-unavailable"
                          >
                            <q-icon name="mdi-image-off-outline" size="26px" />
                            <span class="vault-blob-unavailable-text">No longer available</span>
                          </div>
                          <div v-else class="vault-blob-media-loading">
                            <q-spinner color="primary" size="28px" />
                          </div>
                        </div>

                        <!-- AUDIO — inline Discord-style player -->
                        <div
                          v-else-if="isBlobAudio(blobAttachmentsMap[msg.id]!.mimetype)"
                          class="vault-audio-player"
                          @click.stop
                        >
                          <button
                            class="vault-audio-play"
                            :disabled="!blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            :aria-label="
                              audioStates[blobAttachmentsMap[msg.id]!.blobId]?.playing
                                ? 'Pause'
                                : 'Play'
                            "
                            @click.stop="toggleAudioPlayback(blobAttachmentsMap[msg.id]!.blobId)"
                          >
                            <q-icon
                              v-if="blobAttachmentErrors[blobAttachmentsMap[msg.id]!.blobId]"
                              name="mdi-alert-circle-outline"
                              size="18px"
                            />
                            <q-spinner
                              v-else-if="!blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                              size="18px"
                              color="primary"
                            />
                            <q-icon
                              v-else
                              :name="
                                audioStates[blobAttachmentsMap[msg.id]!.blobId]?.playing
                                  ? 'mdi-pause'
                                  : 'mdi-play'
                              "
                              size="20px"
                            />
                          </button>
                          <div class="vault-audio-main">
                            <div
                              class="vault-audio-track"
                              @click.stop="seekAudio(blobAttachmentsMap[msg.id]!.blobId, $event)"
                            >
                              <div
                                class="vault-audio-fill"
                                :style="{
                                  width:
                                    (audioStates[blobAttachmentsMap[msg.id]!.blobId]?.progress ??
                                      0) + '%',
                                }"
                              />
                              <div
                                class="vault-audio-knob"
                                :style="{
                                  left:
                                    (audioStates[blobAttachmentsMap[msg.id]!.blobId]?.progress ??
                                      0) + '%',
                                }"
                              />
                            </div>
                            <div class="vault-audio-meta">
                              <span class="vault-audio-name">{{
                                blobAttachmentsMap[msg.id]!.filename
                              }}</span>
                              <span
                                v-if="
                                  (audioStates[blobAttachmentsMap[msg.id]!.blobId]?.duration ??
                                    0) > 0
                                "
                                class="vault-audio-time"
                              >
                                {{
                                  formatVideoTime(
                                    audioStates[blobAttachmentsMap[msg.id]!.blobId]?.currentTime ??
                                      0,
                                  )
                                }}
                                /
                                {{
                                  formatVideoTime(
                                    audioStates[blobAttachmentsMap[msg.id]!.blobId]?.duration ?? 0,
                                  )
                                }}
                              </span>
                              <span
                                v-else
                                class="vault-audio-time vault-audio-time--state"
                              >{{
                                blobAttachmentErrors[blobAttachmentsMap[msg.id]!.blobId]
                                  ? 'No longer available'
                                  : 'Loading…'
                              }}</span>
                            </div>
                          </div>
                          <audio
                            :ref="
                              (el) =>
                                registerAudioRef(
                                  blobAttachmentsMap[msg.id]?.blobId,
                                  el as HTMLAudioElement,
                                )
                            "
                            :src="blobPreviewUrls[blobAttachmentsMap[msg.id]!.blobId]"
                            preload="metadata"
                            @loadedmetadata="
                              onAudioMeta(blobAttachmentsMap[msg.id]!.blobId, $event)
                            "
                            @timeupdate="onAudioTime(blobAttachmentsMap[msg.id]!.blobId, $event)"
                            @ended="onAudioEnded(blobAttachmentsMap[msg.id]!.blobId)"
                          />
                        </div>

                        <!-- ANY OTHER FILE — visible row (icon + name + size + save) -->
                        <div v-else class="vault-blob-file">
                          <q-icon
                            name="mdi-file-document-outline"
                            size="18px"
                            class="vault-blob-file-icon"
                          />
                          <div class="vault-blob-file-info">
                            <span class="vault-blob-filename">{{
                              blobAttachmentsMap[msg.id]!.filename
                            }}</span>
                            <span class="vault-blob-size">{{
                              formatFileSize(blobAttachmentsMap[msg.id]!.size)
                            }}</span>
                          </div>
                          <button
                            class="vault-blob-download-btn"
                            :disabled="!!downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId]"
                            @click.stop="downloadBlobAttachment(msg.text)"
                            title="Download"
                          >
                            <q-icon
                              :name="
                                downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId]
                                  ? 'mdi-loading'
                                  : savedBlobSuccess[blobAttachmentsMap[msg.id]!.blobId]
                                    ? 'mdi-check-circle'
                                    : 'mdi-download'
                              "
                              size="16px"
                              :class="{
                                'vault-blob-spinner':
                                  !!downloadingBlobs[blobAttachmentsMap[msg.id]!.blobId],
                              }"
                            />
                          </button>
                        </div>
                      </div>

                      <MessageReactions
                        :reactions="msg.reactions"
                        :current-actor="authStore.user?.id || ''"
                        @toggle="addReaction(msg.id, $event)"
                      />

                      <!-- Shared hover actions (also used by Suites) -->
                      <MessageQuickActions
                        :visible="hoveredMsgId === msg.id && !msg.status?.startsWith('FAILED')"
                        :emojis="QUICK_EMOJIS"
                        :emoji-url="discordEmojiUrl"
                        @react="addReaction(msg.id, $event)"
                        @open-picker="openEmojiPicker($event, msg.id)"
                      />

                      <!-- Failed actions bar -->
                      <transition name="vault-fade">
                        <div
                          v-if="
                            msg.status?.startsWith('FAILED') &&
                            (mobileChatOpen || hoveredMsgId === msg.id)
                          "
                          class="vault-failed-bar"
                        >
                          <button
                            class="vault-failed-bar-btn"
                            title="Retry"
                            @click.stop="retryMessage(msg.id)"
                          >
                            <q-icon name="mdi-refresh" size="16px" />
                          </button>
                          <button
                            class="vault-failed-bar-btn"
                            title="Delete"
                            @click.stop="deleteLocalMessage(msg.id)"
                          >
                            <q-icon name="mdi-delete-outline" size="16px" />
                          </button>
                        </div>
                      </transition>
                    </div>
                  </div>
                </template>
              </div>

              <!-- Jump to latest -->
              <transition name="vault-fade-up">
                <div v-if="showJumpToLatest" class="vault-jump-btn-wrap">
                  <button class="vault-jump-btn" @click="scrollToLatest">
                    <q-icon name="mdi-chevron-double-down" size="18px" />
                  </button>
                </div>
              </transition>
            </q-scroll-area>

            <!-- Input area -->
            <div
              class="vault-input-area"
              :class="{ 'is-picker-open': showEmojiPicker }"
              :style="
                showEmojiPicker && pickerPanelHeight > 0
                  ? { '--picker-h': pickerPanelHeight + 'px' }
                  : null
              "
            >
              <!-- Reply preview bar -->
              <div v-if="replyingTo" class="vault-reply-bar">
                <q-icon name="mdi-reply" size="14px" class="vault-reply-bar-icon" />
                <div class="vault-reply-bar-content">
                  <span class="vault-reply-bar-name">
                    {{ replyingTo.isSender ? myUsername : partnerUsername }}
                  </span>
                  <span class="vault-reply-bar-text">{{ truncate(replyingTo.text, 100) }}</span>
                </div>
                <button class="vault-reply-bar-close" @click="replyingTo = null">
                  <q-icon name="mdi-close" size="14px" />
                </button>
              </div>

              <!-- Severed state -->
              <div v-if="isSevered" class="vault-severed-input">
                <q-icon name="mdi-link-off" size="20px" class="text-[var(--dash-accent)]" />
                <div class="vault-severed-text">
                  <span>Connection closed.</span>
                  <span class="vault-severed-note"
                    >Your message history is saved on this device.</span
                  >
                </div>
                <button class="vault-relink-btn" @click="requestRelink">Reconnect</button>
              </div>

              <!-- Device not enrolled for the Vault.
                   Without this strip the composer simply sat there with a dead send
                   button and no explanation: `isSendBlocked` is true while the vault
                   store is uninitialised, and the only trace of WHY was a console
                   error ("Current password is required to enroll a new device").
                   Mirrors the severed-state pattern above. -->
              <div v-else-if="vaultEnrollmentNeeded" class="vault-severed-input">
                <q-icon name="mdi-shield-key-outline" size="20px" class="text-[var(--dash-accent)]" />
                <div class="vault-severed-text">
                  <span>Secure messaging is locked.</span>
                  <span class="vault-severed-note">This device isn't enrolled for the Vault.</span>
                </div>
                <button class="vault-relink-btn" :disabled="isEnrolling" @click="startVaultEnrollment">
                  {{ isEnrolling ? 'Enrolling…' : 'Unlock' }}
                </button>
              </div>

              <!-- Normal input -->
              <q-form v-else @submit.prevent="sendVaultMessage" class="vault-input-form">
                <!-- Attachment button (+) -->
                <div class="vault-attach-wrap">
                  <button
                    type="button"
                    class="vault-input-action-btn vault-attach-btn"
                    :disabled="isChatUnavailable"
                    @click="onAttachClick"
                  >
                    <q-icon name="mdi-plus" size="20px" />
                    <q-tooltip class="bg-black text-white text-xs font-mono"
                      >Attach photo, file or audio (max 100 MB)</q-tooltip
                    >
                  </button>
                  <!-- Mobile attach sheet. Hand-rolled popup, deliberately NOT a
                       <q-menu>: a QMenu nested inside its own activator button gets
                       activated twice over (Quasar's implicit parent activator plus
                       the @click), so it opened and instantly closed again — which is
                       why (+) looked like it did nothing. Only rendered on mobile;
                       desktop keeps going straight to the file picker. -->
                  <template v-if="isMobile">
                    <div
                      v-if="attachMenuOpen"
                      class="vault-attach-backdrop"
                      @click="attachMenuOpen = false"
                    />
                    <div v-if="attachMenuOpen" class="vault-attach-sheet bg-black">
                      <button
                        type="button"
                        class="vault-attach-option"
                        @click="pickPhoto('camera')"
                      >
                        <q-icon name="mdi-camera-outline" size="18px" />
                        <span>Camera</span>
                      </button>
                      <button
                        type="button"
                        class="vault-attach-option"
                        @click="pickPhoto('photos')"
                      >
                        <q-icon name="mdi-image-multiple-outline" size="18px" />
                        <span>Gallery</span>
                      </button>
                      <button type="button" class="vault-attach-option" @click="pickAudio">
                        <q-icon name="mdi-music-note-outline" size="18px" />
                        <span>Audio</span>
                      </button>
                      <button type="button" class="vault-attach-option" @click="pickFile">
                        <q-icon name="mdi-paperclip" size="18px" />
                        <span>File</span>
                      </button>
                    </div>
                  </template>
                </div>
                <input ref="fileInputRef" type="file" class="hidden" @change="handleFileSelected" />
                <input
                  ref="audioInputRef"
                  type="file"
                  accept="audio/*"
                  class="hidden"
                  @change="handleFileSelected"
                />

                <q-input
                  ref="messageInputRef"
                  v-model="draftMessage"
                  dense
                  outlined
                  dark
                  type="textarea"
                  autogrow
                  rows="1"
                  class="vault-input-field"
                  placeholder="Type a message..."
                  bg-color="transparent"
                  hide-bottom-space
                  autocomplete="on"
                  autocorrect="on"
                  autocapitalize="sentences"
                  spellcheck="true"
                  :disable="isChatUnavailable"
                  :input-style="{ maxHeight: '120px', overflow: 'auto', resize: 'none' }"
                  @keydown="onInputKeydown"
                  @paste="onComposerPaste"
                />

                <!-- Emoji picker button -->
                <button
                  type="button"
                  :class="[
                    'vault-input-action-btn',
                    'vault-emoji-btn',
                    { 'vault-emoji-btn--active': showEmojiPicker },
                  ]"
                  :disabled="isChatUnavailable"
                  @pointerdown.prevent="toggleEmojiPicker"
                >
                  <q-icon :name="emojiBtnIcon" size="17px" />
                  <q-tooltip class="bg-black text-white text-xs font-mono">
                    {{ showEmojiPicker ? 'Keyboard' : 'Emoji' }}
                  </q-tooltip>
                </button>

                <!-- GIF browser button -->
                <button
                  type="button"
                  :class="[
                    'vault-input-action-btn',
                    'vault-gif-btn',
                    { 'vault-gif-btn--active': showGifPicker },
                  ]"
                  :disabled="isChatUnavailable"
                  @click="toggleGifPicker"
                >
                  <q-icon name="fas fa-image" size="16px" />
                  <q-tooltip class="bg-black text-white text-xs font-mono">Search GIFs</q-tooltip>
                </button>

                <button
                  type="button"
                  class="vault-send-btn"
                  :disabled="isSendBlocked || isRateLimited || !draftMessage.trim() || isSending"
                  @mousedown.prevent
                  @click="sendVaultMessage"
                >
                  <q-icon name="mdi-send" size="18px" />
                </button>
              </q-form>

              <!-- Active file transfers -->
              <div v-if="activeTransfers.length > 0" class="vault-transfers">
                <div v-for="t in activeTransfers" :key="t.transferId" class="vault-transfer-item">
                  <q-icon
                    :name="t.direction === 'upload' ? 'mdi-upload' : 'mdi-download'"
                    size="16px"
                  />
                  <span class="vault-transfer-name">{{ t.filename }}</span>
                  <span class="vault-transfer-size">{{ formatFileSize(t.size) }}</span>
                  <q-linear-progress
                    :value="t.progress / 100"
                    rounded
                    size="4px"
                    class="vault-transfer-bar vault-accent-progress"
                    color="red"
                    track-color="grey-10"
                  />
                  <span class="vault-transfer-pct">{{ t.progress }}%</span>
                  <span v-if="t.state === 'failed'" class="vault-transfer-err">{{
                    t.error || 'Failed'
                  }}</span>
                  <button
                    v-if="t.state === 'failed' || t.state === 'complete'"
                    class="vault-transfer-remove"
                    @click="removeTransfer(t.transferId)"
                  >
                    <q-icon name="mdi-close" size="14px" />
                  </button>
                </div>
              </div>

              <!-- GIF Picker Panel -->
              <transition name="vault-slide-up">
                <div
                  v-if="showGifPicker && !isSevered"
                  class="vault-gif-picker"
                  @click.capture="guardPickerTap"
                  @click.self="showGifPicker = false"
                >
                  <div class="vault-gif-header">
                    <q-input
                      v-model="gifSearchQuery"
                      dense
                      outlined
                      dark
                      placeholder="Search GIFs..."
                      bg-color="transparent"
                      hide-bottom-space
                      class="vault-gif-search"
                      debounce="400"
                      @update:model-value="searchGifs"
                    >
                      <template v-slot:prepend>
                        <q-icon name="mdi-magnify" size="16px" />
                      </template>
                    </q-input>
                    <button class="vault-gif-close" @click="showGifPicker = false">
                      <q-icon name="mdi-close" size="16px" />
                    </button>
                  </div>
                  <div v-if="gifLoading" class="vault-gif-loading">
                    <q-spinner size="24px" color="red" class="vault-accent-spinner" />
                  </div>
                  <div v-else class="vault-gif-grid">
                    <!-- Loading placeholders -->
                    <template v-if="gifLoading">
                      <div
                        v-for="i in 12"
                        :key="'placeholder-' + i"
                        class="vault-gif-item vault-gif-placeholder"
                      >
                        <div class="vault-gif-skeleton" />
                      </div>
                    </template>

                    <!-- GIF results -->
                    <img
                      v-for="gif in gifResults"
                      :key="gif.id"
                      :src="gif.preview"
                      class="vault-gif-item"
                      loading="lazy"
                      @click="sendGif(gif.url)"
                    />
                    <div v-if="gifResults.length === 0 && gifSearchQuery" class="vault-gif-empty">
                      No GIFs found
                    </div>
                  </div>
                  <div class="vault-gif-footer">
                    <span class="vault-gif-powered">Powered by KLIPY</span>
                  </div>
                </div>
              </transition>

              <!-- Emoji Picker Panel -->
              <transition name="vault-slide-up">
                <div
                  v-if="showEmojiPicker && !isSevered"
                  class="vault-emoji-picker"
                  @click.capture="guardPickerTap"
                  @click.self="showEmojiPicker = false"
                >
                  <div class="vault-emoji-header">
                    <!-- Telegram-shaped top row: search on the left, the EMOJI/GIF
                         segment in the middle, close on the right. -->
                    <q-input
                      v-model="pickerSearchQuery"
                      dense
                      borderless
                      dark
                      :placeholder="pickerTab === 'gif' ? 'Search GIFs' : 'Search emoji'"
                      class="vault-picker-search"
                    >
                      <template #prepend>
                        <q-icon name="mdi-magnify" size="15px" />
                      </template>
                    </q-input>
                    <div class="vault-picker-tabs">
                      <button
                        type="button"
                        class="vault-picker-tab"
                        :class="{ 'vault-picker-tab--active': pickerTab === 'emoji' }"
                        title="Emoji"
                        @click="switchPickerTab('emoji')"
                      >
                        <q-icon name="mdi-emoticon-outline" size="16px" />
                      </button>
                      <button
                        type="button"
                        class="vault-picker-tab"
                        :class="{ 'vault-picker-tab--active': pickerTab === 'gif' }"
                        title="GIF"
                        @click="switchPickerTab('gif')"
                      >
                        GIF
                      </button>
                    </div>
                    <button class="vault-gif-close" @click="showEmojiPicker = false">
                      <q-icon name="mdi-close" size="16px" />
                    </button>
                  </div>

                  <!-- Emoji tab: section header, grid, then the category bar pinned
                       to the bottom of the panel like Telegram's. -->
                  <div v-if="pickerTab === 'emoji'" class="vault-picker-emoji-body">
                    <div class="vault-picker-section">{{ emojiSectionLabel }}</div>
                    <div class="vault-emoji-grid">
                      <button
                        v-for="emoji in visibleEmojis"
                        :key="emoji"
                        class="vault-emoji-cell"
                        :title="emoji"
                        @click="insertEmoji(emoji)"
                      >
                        {{ emoji }}
                      </button>
                    </div>
                    <div v-if="visibleEmojis.length === 0" class="vault-empty-label">
                      NO EMOJI
                    </div>
                    <div class="vault-picker-cats">
                      <button
                        v-for="cat in EMOJI_CATEGORIES"
                        :key="cat.key"
                        type="button"
                        class="vault-picker-cat"
                        :class="{ 'is-active': emojiCategory === cat.key }"
                        :title="cat.label"
                        @click="emojiCategory = cat.key"
                      >
                        {{ cat.icon }}
                      </button>
                    </div>
                  </div>

                  <!-- GIF tab. Its own search bar was removed: the panel's top row
                       now hosts a single search field that follows the active tab
                       (it used to render two search boxes at once, one claiming
                       "Search emoji" while the GIF tab was showing). -->
                  <template v-else>
                    <div v-if="gifLoading" class="vault-gif-loading">
                      <q-spinner size="24px" color="red" class="vault-accent-spinner" />
                    </div>
                    <div v-else class="vault-gif-grid">
                      <img
                        v-for="gif in gifResults"
                        :key="gif.id"
                        :src="gif.preview"
                        class="vault-gif-item"
                        loading="lazy"
                        @click="sendGif(gif.url)"
                      />
                      <div v-if="gifResults.length === 0 && gifSearchQuery" class="vault-gif-empty">
                        No GIFs found
                      </div>
                    </div>
                    <div class="vault-gif-footer">
                      <span class="vault-gif-powered">Powered by KLIPY</span>
                    </div>
                  </template>
                </div>
              </transition>
            </div>

            <!-- Expired overlay -->
            <div v-if="isChatExpired" class="vault-expired-overlay">
              <q-icon name="mdi-link-off" size="48px" class="vault-expired-icon" />
              <span class="vault-expired-title">LINK EXPIRED</span>
              <span class="vault-expired-sub">This chain has reached its time limit</span>
              <button class="vault-expired-close" @click="closeConversation">CLOSE</button>
            </div>
          </template>

          <!-- Fallback empty state (safety net) -->
          <div v-else class="vault-center-empty">
            <div class="vault-center-empty-inner">
              <div class="vault-hex-icon">
                <q-icon name="mdi-shield-lock-outline" size="36px" />
              </div>
              <span class="vault-center-empty-title">SELECT A CHAIN</span>
              <span class="vault-center-empty-sub">
                Zero-trust E2EE messaging.<br />Choose a conversation to begin.
              </span>
            </div>
          </div>

          <!-- Drop-to-send overlay (1:1 chains only — Suite attachments unsupported) -->
          <transition name="vault-fade-up">
            <div v-if="dragActive" class="vault-drop-overlay">
              <div class="vault-drop-box">
                <q-icon name="mdi-tray-arrow-down" size="34px" class="vault-drop-icon" />
                <span class="vault-drop-title">DROP TO SEND</span>
                <span class="vault-drop-sub">
                  Encrypted on this device before upload · 100 MB max per file
                </span>
              </div>
            </div>
          </transition>
        </main>

        <!-- -------------------------------------------------------------------
           RIGHT PANEL � Partner Mini Profile
           ------------------------------------------------------------------- -->
        <!-- RIGHT PANEL: Actions & Protocol Stats -->
        <aside
          v-if="activeTab === 'chats' && selectedLink"
          :class="['vault-right', { 'vault-right--closed': !rightPanelOpen }]"
        >
          <div v-if="!selectedLink" class="vault-right-empty">
            <q-icon name="mdi-dock-right" size="28px" class="vault-empty-icon" />
            <span class="vault-empty-label">PANEL</span>
          </div>

          <template v-else>
            <q-scroll-area class="vault-right-scroll">
              <!-- Partner Profile Card -->
              <div class="vault-profile-card">
                <!-- Profile Picture -->
                <div class="vault-profile-pic-wrap">
                  <q-avatar size="72px" class="vault-profile-pic">
                    <img :src="partnerAvatar" />
                  </q-avatar>
                  <div
                    :class="[
                      'vault-profile-status-dot',
                      selectedLink.status === 'ANCHORED'
                        ? 'vault-profile-status-dot--anchored'
                        : '',
                      selectedLink.status === 'SEVERED' ? 'vault-profile-status-dot--severed' : '',
                    ]"
                  />
                </div>

                <!-- Username -->
                <span class="vault-profile-display">{{ chatPartnerName }}</span>
                <span class="vault-profile-username">@{{ partnerUsername }}</span>

                <!-- Divider -->
                <div class="vault-profile-divider" />

                <!-- Link Info -->
                <div class="vault-profile-section">
                  <span class="vault-profile-section-title">LINK STATUS</span>
                  <div class="vault-profile-row">
                    <q-icon
                      :name="
                        selectedLink.status === 'ANCHORED'
                          ? 'mdi-link-lock'
                          : selectedLink.status === 'SEVERED'
                            ? 'mdi-link-off'
                            : selectedLink.status === 'ESTABLISHED'
                              ? 'mdi-timer-sand'
                              : 'mdi-clock-outline'
                      "
                      size="14px"
                      :class="[
                        selectedLink.status === 'ANCHORED' ? 'text-[var(--dash-accent)]' : '',
                        selectedLink.status === 'SEVERED' ? 'text-[var(--dash-accent)]' : '',
                        selectedLink.status === 'ESTABLISHED' ? 'text-[var(--dash-warning)]' : '',
                      ]"
                    />
                    <span>{{ selectedLink.status }}</span>
                  </div>
                  <div v-if="selectedLink.status === 'ESTABLISHED'" class="vault-profile-row">
                    <q-icon name="mdi-clock-fast" size="14px" />
                    <span>{{ chatTimeRemaining }}</span>
                  </div>
                </div>

                <div class="vault-profile-divider" />
              </div>
            </q-scroll-area>
          </template>
        </aside>

        <aside
          v-else-if="activeTab === 'suites' && groupStore.activeGroup"
          :class="['vault-right', { 'vault-right--closed': !rightPanelOpen }]"
        >
          <q-scroll-area class="vault-right-scroll">
            <div class="vault-profile-card">
              <div class="vault-profile-pic-wrap">
                <q-avatar size="72px" class="vault-profile-pic">
                  <img
                    v-if="groupStore.activeGroup.avatarUrl"
                    :src="groupStore.activeGroup.avatarUrl"
                    :alt="groupStore.activeGroup.name"
                  />
                  <q-icon v-else name="mdi-shape" size="32px" color="grey-6" />
                </q-avatar>
              </div>
              <span class="vault-profile-display">{{ groupStore.activeGroup.name }}</span>
              <span class="vault-profile-username">
                {{ groupStore.activeGroup.memberCount ?? groupStore.activeGroup.members.length }}
                MEMBERS
              </span>
              <div class="vault-profile-divider" />
              <div class="vault-profile-section">
                <span class="vault-profile-section-title">SUITE STATUS</span>
                <div class="vault-profile-row">
                  <q-icon name="mdi-shield-lock-outline" size="14px" />
                  <span>MLS EPOCH {{ groupStore.activeGroup.epoch }}</span>
                </div>
                <div class="vault-profile-row">
                  <q-icon
                    :name="groupStore.activeGroup.isPublic ? 'mdi-earth' : 'mdi-lock-outline'"
                    size="14px"
                  />
                  <span>{{ groupStore.activeGroup.isPublic ? 'PUBLIC' : 'PRIVATE' }}</span>
                </div>
                <div class="vault-profile-row">
                  <q-icon name="mdi-account-key-outline" size="14px" />
                  <span>{{ groupStore.activeUserRole ?? 'MEMBER' }}</span>
                </div>
              </div>
              <div class="vault-profile-divider" />

              <!-- Members grouped by role (owner first, then admins, then members) -->

              <div class="suite-right-actions">
                <q-btn
                  unelevated
                  no-caps
                  icon="mdi-cog-outline"
                  label="Suite settings"
                  class="btn-secondary"
                  @click="openGroupSettings(groupStore.activeGroup.id)"
                />
                <q-btn
                  v-if="canAddMembersForGroup(groupStore.activeGroup.id)"
                  unelevated
                  no-caps
                  icon="mdi-account-plus"
                  label="Invite member"
                  class="btn-primary-action"
                  @click="openGroupInvite(groupStore.activeGroup.id)"
                />
              </div>

              <div class="vault-profile-divider" />

              <div class="suite-panel-members">
                <template v-if="panelOwnerMembers.length > 0">
                  <div class="suite-panel-category">
                    <span>OWNER</span>
                    <span class="suite-panel-category-count">{{ panelOwnerMembers.length }}</span>
                  </div>
                  <div
                    v-for="member in panelOwnerMembers"
                    :key="member.userId"
                    class="suite-panel-member"
                  >
                    <q-avatar size="32px" class="suite-panel-member-avatar">
                      <img
                        v-if="member.profile?.profilePicture"
                        :src="member.profile.profilePicture"
                        :alt="member.username"
                      />
                      <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                    </q-avatar>
                    <div class="suite-panel-member-copy">
                      <span class="suite-panel-member-name">{{
                        member.profile?.displayName || member.username || 'Member'
                      }}</span>
                      <span class="suite-panel-member-handle"
                        >@{{ member.username || 'user' }}</span
                      >
                    </div>
                    <span class="suite-role-badge suite-role-badge--owner">OWNER</span>
                  </div>
                </template>

                <template v-if="panelAdminMembers.length > 0">
                  <div class="suite-panel-category">
                    <span>ADMINS</span>
                    <span class="suite-panel-category-count">{{ panelAdminMembers.length }}</span>
                  </div>
                  <div
                    v-for="member in panelAdminMembers"
                    :key="member.userId"
                    class="suite-panel-member"
                  >
                    <q-avatar size="32px" class="suite-panel-member-avatar">
                      <img
                        v-if="member.profile?.profilePicture"
                        :src="member.profile.profilePicture"
                        :alt="member.username"
                      />
                      <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                    </q-avatar>
                    <div class="suite-panel-member-copy">
                      <span class="suite-panel-member-name">{{
                        member.profile?.displayName || member.username || 'Member'
                      }}</span>
                      <span class="suite-panel-member-handle"
                        >@{{ member.username || 'user' }}</span
                      >
                    </div>
                    <span class="suite-role-badge suite-role-badge--admin">ADMIN</span>
                  </div>
                </template>

                <template v-if="panelUserMembers.length > 0">
                  <div class="suite-panel-category">
                    <span>MEMBERS</span>
                    <span class="suite-panel-category-count">{{ panelUserMembers.length }}</span>
                  </div>
                  <div
                    v-for="member in panelUserMembers"
                    :key="member.userId"
                    class="suite-panel-member"
                  >
                    <q-avatar size="32px" class="suite-panel-member-avatar">
                      <img
                        v-if="member.profile?.profilePicture"
                        :src="member.profile.profilePicture"
                        :alt="member.username"
                      />
                      <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                    </q-avatar>
                    <div class="suite-panel-member-copy">
                      <span class="suite-panel-member-name">{{
                        member.profile?.displayName || member.username || 'Member'
                      }}</span>
                      <span class="suite-panel-member-handle"
                        >@{{ member.username || 'user' }}</span
                      >
                    </div>
                    <span class="suite-role-badge">MEMBER</span>
                  </div>
                </template>
              </div>
            </div>
          </q-scroll-area>
        </aside>
      </div>

      <!-- -----------------------------------------------------------------------
         MODALS � Vault Settings, Compromise, Delete
         ----------------------------------------------------------------------- -->

      <!-- Generic Confirm Modal -->
      <q-dialog v-model="showConfirmModal" persistent>
        <q-card class="vault-modal">
          <q-card-section
            :class="['vault-modal-head', confirmModal.danger ? 'vault-modal-head--danger' : '']"
          >
            <span class="vault-modal-title">{{ confirmModal.title }}</span>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <p class="vault-modal-desc">{{ confirmModal.message }}</p>
          </q-card-section>
          <q-card-actions align="right" class="vault-modal-actions">
            <q-btn flat label="Cancel" class="vault-modal-btn" @click="showConfirmModal = false" />
            <q-btn
              flat
              :label="confirmModal.confirmLabel"
              :class="[
                'vault-modal-btn',
                confirmModal.danger ? 'vault-modal-btn--danger' : 'vault-modal-btn--primary',
              ]"
              @click="
                confirmModal.onConfirm();
                showConfirmModal = false;
              "
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Vault Mode Settings -->
      <q-dialog v-model="showSettingsModal" persistent>
        <q-card class="vault-modal">
          <q-card-section class="vault-modal-head">
            <span class="vault-modal-title">MESSAGE RETENTION</span>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <p class="vault-modal-desc">
              Choose how long messages are kept. This applies to your account on all devices.
            </p>
            <div class="vault-modal-options">
              <q-radio
                dark
                v-model="settingsForm.mode"
                val="persistent"
                label="Keep Forever"
                color="primary"
                class="vault-radio"
              />
              <q-radio
                dark
                v-model="settingsForm.mode"
                val="ephemeral_time"
                label="Decay Timer"
                color="primary"
                class="vault-radio"
              />
              <q-input
                v-if="settingsForm.mode === 'ephemeral_time'"
                dark
                dense
                outlined
                v-model.number="settingsForm.retainHours"
                type="number"
                min="1"
                max="720"
                class="vault-hours-input"
                suffix="hours"
              />
              <q-radio
                dark
                v-model="settingsForm.mode"
                val="ephemeral_session"
                label="Clear on Close"
                color="negative"
                class="vault-radio"
              />
            </div>
          </q-card-section>
          <q-card-actions align="right" class="vault-modal-actions">
            <q-btn flat label="Cancel" class="vault-modal-btn" @click="showSettingsModal = false" />
            <q-btn
              flat
              label="CONFIRM"
              class="vault-modal-btn vault-modal-btn--primary"
              @click="saveSettingsAndInit"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Compromised Link Modal -->
      <q-dialog v-model="showCompromiseModal" persistent>
        <q-card class="vault-modal vault-modal--danger">
          <q-card-section class="vault-modal-head vault-modal-head--danger">
            <span class="vault-modal-title">SECURITY ALERT</span>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <p class="vault-modal-desc">
              Device identity changed. Messages from your partner are blocked until you decide.
            </p>
            <div class="vault-compromise-actions">
              <button
                class="vault-compromise-btn vault-compromise-btn--safe"
                @click="markSafeCurrentChat"
              >
                <q-icon name="mdi-shield-check" size="16px" /> Trust this contact
              </button>
              <button
                class="vault-compromise-btn vault-compromise-btn--temp"
                @click="allowMessagingForNow"
              >
                <q-icon name="mdi-timer" size="16px" /> Allow for 5 minutes
              </button>
              <template v-if="quarantinedQueue.length > 0">
                <button
                  class="vault-compromise-btn vault-compromise-btn--temp"
                  @click="allowQuarantine"
                >
                  <q-icon name="mdi-email-check" size="16px" /> Accept quarantined messages
                </button>
                <button
                  class="vault-compromise-btn vault-compromise-btn--danger"
                  @click="rejectQuarantine"
                >
                  <q-icon name="mdi-email-remove" size="16px" /> Reject quarantined messages
                </button>
              </template>
              <template v-if="!isSevered">
                <button
                  class="vault-compromise-btn vault-compromise-btn--temp"
                  @click="severLinkKeepHistory"
                >
                  <q-icon name="mdi-link-off" size="16px" /> Close (keep history)
                </button>
                <button
                  class="vault-compromise-btn vault-compromise-btn--danger"
                  @click="severLinkAndPurge"
                >
                  <q-icon name="mdi-delete-forever" size="16px" /> Close &amp; clear
                </button>
              </template>
              <template v-else>
                <button
                  class="vault-compromise-btn vault-compromise-btn--danger"
                  @click="purgeCurrentSeveredFromHeader"
                >
                  <q-icon name="mdi-delete" size="16px" /> Remove
                </button>
                <button
                  class="vault-compromise-btn vault-compromise-btn--temp"
                  @click="requestRelink"
                >
                  <q-icon name="mdi-link-plus" size="16px" /> Reconnect
                </button>
              </template>
              <button class="vault-compromise-btn" @click="showCompromiseModal = false">
                Cancel
              </button>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Delete Chat Modal -->
      <q-dialog v-model="showDeleteModal" persistent>
        <q-card class="vault-modal">
          <q-card-section class="vault-modal-head vault-modal-head--danger">
            <span class="vault-modal-title">DELETE CHAT</span>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <p class="vault-modal-desc">
              This deletes all messages from your side. The recipient keeps their copy.
            </p>
          </q-card-section>
          <q-card-actions align="right" class="vault-modal-actions">
            <q-btn flat label="Cancel" class="vault-modal-btn" @click="showDeleteModal = false" />
            <q-btn
              flat
              label="DELETE"
              class="vault-modal-btn vault-modal-btn--danger"
              @click="deleteChatLocal"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Chat Settings Modal -->
      <q-dialog v-model="showChatSettingsModal" persistent>
        <q-card class="vault-modal">
          <q-card-section class="vault-modal-head">
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
              "
            >
              <span class="vault-modal-title">CHAT SETTINGS</span>
              <q-btn
                flat
                round
                dense
                icon="close"
                size="sm"
                @click="showChatSettingsModal = false"
                style="color: var(--dash-accent)"
              />
            </div>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <!-- Session Entropy Section -->
            <div class="vault-modal-section">
              <span class="vault-modal-section-title">CONNECTION INFO</span>
              <div class="vault-entropy-stats">
                <div class="vault-entropy-row">
                  <span class="vault-entropy-label">Messages</span>
                  <span class="vault-entropy-value">{{ vaultMessages.length }}</span>
                </div>
                <div class="vault-entropy-row">
                  <span class="vault-entropy-label">Est. At</span>
                  <span class="vault-entropy-value">{{
                    formatDiscordLikeTimestamp(new Date(selectedLink?.establishedAt || 0).getTime())
                  }}</span>
                </div>
                <div class="vault-entropy-row">
                  <span class="vault-entropy-label">Expires In</span>
                  <span class="vault-entropy-value">{{ chatTimeRemaining }}</span>
                </div>
              </div>
              <!-- Health Bar -->
              <div class="vault-health-bar">
                <div
                  class="vault-health-bar-fill"
                  :style="{ width: ((vaultMessages.length % 100) / 100) * 100 + '%' }"
                />
              </div>
              <span class="vault-health-label">Protocol Health</span>
            </div>

            <div style="height: 16px" />

            <!-- Encryption Proof Section -->
            <div class="vault-modal-section">
              <span class="vault-modal-section-title">ENCRYPTION PROOF</span>
              <div v-if="peerDevices.length > 0" class="vault-device-list">
                <div
                  v-for="(device, idx) in peerDevices"
                  :key="device.id"
                  class="vault-device-item"
                >
                  <div class="vault-device-header">
                    <span class="vault-device-label">Device {{ idx + 1 }}</span>
                  </div>
                  <div class="vault-fingerprint-value vault-device-fp">
                    {{ device.devicePub?.slice(0, 32) || 'N/A' }}
                  </div>
                  <div class="vault-fingerprint-value vault-device-fp">
                    {{ device.devicePub?.slice(32) || '' }}
                  </div>
                </div>
              </div>
              <div v-else class="vault-empty-devices">No active devices</div>
            </div>

            <div style="height: 16px" />

            <!-- Link Health Proof Section -->
            <div class="vault-modal-section">
              <span class="vault-modal-section-title">LINK HEALTH</span>
              <div class="vault-health-info">
                <div class="vault-health-row">
                  <span class="vault-health-key">Active Devices</span>
                  <span class="vault-health-value">{{ peerDevices.length }}</span>
                </div>
                <div class="vault-health-row">
                  <span class="vault-health-key">Link Status</span>
                  <span
                    class="vault-health-value"
                    :class="'status-' + (selectedLink?.status || 'unknown').toLowerCase()"
                  >
                    {{ selectedLink?.status || 'UNKNOWN' }}
                  </span>
                </div>
                <div class="vault-health-row">
                  <span class="vault-health-key">Last Updated</span>
                  <span class="vault-health-value">{{
                    formatDiscordLikeTimestamp(new Date(selectedLink?.updatedAt || 0).getTime())
                  }}</span>
                </div>
              </div>
            </div>

            <div style="height: 16px" />

            <!-- Verification Section -->
            <div class="vault-modal-section">
              <span class="vault-modal-section-title">VERIFICATION</span>
              <button class="vault-verify-btn" @click="showVerificationModal = true">
                <q-icon name="mdi-shield-check" size="14px" />
                <span>Verify Peer</span>
              </button>
              <span class="vault-verify-hint">Core Fingerprint</span>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Verification Modal (Peer Ed25519 Fingerprint) -->
      <q-dialog v-model="showVerificationModal" persistent>
        <q-card class="vault-modal">
          <q-card-section class="vault-modal-head">
            <span class="vault-modal-title">PEER VERIFICATION</span>
          </q-card-section>
          <q-card-section class="vault-modal-body">
            <p class="vault-modal-desc">
              Use this fingerprint to verify your peer's identity over a secondary channel.
            </p>
            <div class="vault-fingerprint-block">
              <div class="vault-fingerprint-row">
                <span class="vault-fingerprint-label">Device Fingerprint</span>
                <button class="vault-fingerprint-copy" @click="copyDeviceFingerprint">
                  <q-icon name="mdi-content-copy" size="14px" />
                </button>
              </div>
              <div class="vault-fingerprint-value">{{ peerDevicePub?.slice(0, 32) || 'N/A' }}</div>
              <div class="vault-fingerprint-value">{{ peerDevicePub?.slice(32) || '' }}</div>
            </div>
          </q-card-section>
          <q-card-actions align="right" class="vault-modal-actions">
            <q-btn
              flat
              label="Close"
              class="vault-modal-btn"
              @click="showVerificationModal = false"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <MessageContextMenu
        :visible="contextMenu.visible"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :message="
          contextMenu.msg ? { id: contextMenu.msg.id, isOwn: contextMenu.msg.isSender } : null
        "
        :media-url="contextMenu.mediaUrl"
        :media-type="contextMenu.mediaType"
        :emojis="QUICK_EMOJIS"
        :emoji-url="discordEmojiUrl"
        @close="closeContextMenu"
        @react="
          (messageId, emoji) => {
            addReaction(messageId, emoji);
            closeContextMenu();
          }
        "
        @open-picker="
          (event, messageId) => {
            openEmojiPicker(event, messageId);
            closeContextMenu();
          }
        "
        @reply="ctxReply"
        @copy-text="ctxCopyText"
        @report="ctxReport"
        @delete-for-me="ctxDeleteForMe"
        @delete-for-everyone="ctxDeleteForEveryone"
        @refresh="ctxRefresh"
        @open-media="ctxOpenMediaLink"
        @copy-media-link="ctxCopyMediaLink"
        @copy-image="ctxCopyImage"
        @save-media="ctxSaveMedia"
      />

      <!-- Emoji Picker -->
      <Teleport to="body">
        <div
          v-if="emojiPickerState.visible"
          class="vault-ctx-backdrop"
          @click="closeEmojiPicker"
          @contextmenu.prevent="closeEmojiPicker"
        />
        <div
          v-if="emojiPickerState.visible"
          class="vault-context-emoji-picker"
          :style="{ top: emojiPickerState.y + 'px', left: emojiPickerState.x + 'px' }"
        >
          <div class="vault-context-emoji-grid" @click.capture="guardReactionPickerTap">
            <button
              v-for="(emoji, index) in ALL_EMOJIS"
              :key="`${emoji}-${index}`"
              class="vault-context-emoji-btn"
              :title="emoji"
              @click="emojiPickerState.msgId && addReaction(emojiPickerState.msgId, emoji)"
            >
              <img class="vault-emoji-icon" :src="discordEmojiUrl(emoji)" :alt="emoji" />
            </button>
          </div>
        </div>
      </Teleport>

      <!-- Image Preview Dialog -->
      <q-dialog
        v-model="imagePreview.visible"
        maximized
        transition-show="fade"
        transition-hide="fade"
      >
        <div
          class="vault-image-preview"
          @click.self="imagePreview.visible = false"
          @wheel="onImageZoom"
        >
          <img
            :src="imagePreview.url"
            class="vault-image-preview-img"
            :style="{
              transform: `scale(${imagePreview.zoom})`,
              transformOrigin: 'center center',
            }"
            @click.stop="onImageClick"
          />
          <button class="vault-image-preview-close" @click="imagePreview.visible = false">
            <q-icon name="mdi-close" size="20px" />
          </button>
          <div v-if="imagePreview.filename" class="vault-image-preview-header">
            {{ imagePreview.filename }}
          </div>
          <div class="vault-image-preview-controls">
            <button @click="imagePreview.zoom = Math.max(0.25, imagePreview.zoom - 0.25)">
              <q-icon name="mdi-minus" size="18px" />
            </button>
            <span class="vault-image-zoom-label">{{ Math.round(imagePreview.zoom * 100) }}%</span>
            <button @click="imagePreview.zoom = Math.min(5, imagePreview.zoom + 0.25)">
              <q-icon name="mdi-plus" size="18px" />
            </button>
            <button @click="resetImageZoom()">
              <q-icon name="mdi-fit-to-screen" size="18px" />
            </button>
            <!-- Save the full-size image. On mobile this writes through the
                 Filesystem plugin (an anchor download is ignored by the
                 Capacitor WebView); on desktop it opens the save dialog. -->
            <button
              :disabled="imagePreviewDownloading"
              title="Save image"
              @click.stop="saveImagePreview()"
            >
              <q-icon
                :name="
                  imagePreviewDownloading
                    ? 'mdi-loading'
                    : imagePreviewSaved
                      ? 'mdi-check-circle'
                      : 'mdi-download'
                "
                size="18px"
                :class="{ 'vault-blob-spinner': imagePreviewDownloading }"
              />
            </button>
          </div>
        </div>
      </q-dialog>

      <!-- Video Preview Dialog -->
      <q-dialog
        v-model="videoPreview.visible"
        maximized
        transition-show="fade"
        transition-hide="fade"
      >
        <div class="vault-image-preview" @click.self="videoPreview.visible = false">
          <video
            :src="videoPreview.url"
            class="vault-video-preview-el"
            controls
            autoplay
            @click.stop
          />
          <button class="vault-image-preview-close" @click="videoPreview.visible = false">
            <q-icon name="mdi-close" size="20px" />
          </button>
          <div v-if="videoPreview.filename" class="vault-image-preview-header">
            {{ videoPreview.filename }}
          </div>
        </div>
      </q-dialog>

      <!-- GROUP DISCOVER POPUP -->
      <q-dialog v-model="groupDiscoverOpen" class="group-discover-dialog" dark>
        <q-card class="group-discover-card">
          <q-card-section class="group-discover-head">
            <div class="group-discover-title">
              <q-icon name="mdi-earth" size="18px" />
              <span>DISCOVER SUITES</span>
            </div>
            <div class="group-discover-head-actions">
              <q-btn
                flat
                dense
                no-caps
                icon="mdi-plus"
                label="CREATE"
                class="vault-create-btn"
                :disable="ownedSuiteCount >= 3"
                @click="openCreateSuite()"
              />
              <q-btn
                flat
                round
                dense
                icon="mdi-close"
                size="sm"
                @click="groupDiscoverOpen = false"
              />
            </div>
          </q-card-section>

          <q-card-section class="group-discover-search">
            <q-input
              :model-value="groupDiscoverQuery"
              dense
              outlined
              dark
              bg-color="transparent"
              placeholder="Search public suites by name…"
              @update:model-value="onGroupDiscoverSearch"
            >
              <template #prepend>
                <q-icon name="mdi-magnify" />
              </template>
            </q-input>
          </q-card-section>

          <q-card-section class="group-discover-body">
            <div v-if="groupDiscoverLoading" class="group-discover-empty">
              <q-spinner color="primary" size="24px" />
            </div>
            <div v-else-if="groupDiscoverResults.length === 0" class="group-discover-empty">
              {{
                groupDiscoverQuery ? 'No public suites match that name.' : 'No public suites yet.'
              }}
            </div>

            <div v-else class="group-discover-list">
              <div v-for="g in groupDiscoverResults" :key="g.id" class="group-discover-item">
                <q-avatar size="40px" class="group-discover-avatar">
                  <img v-if="g.avatarUrl" :src="g.avatarUrl" :alt="g.name" />
                  <q-icon v-else name="mdi-shape" size="20px" color="grey-6" />
                </q-avatar>
                <div class="group-discover-info">
                  <span class="group-discover-name">{{ g.name }}</span>
                  <span v-if="g.description" class="group-discover-description">{{
                    g.description
                  }}</span>
                  <span class="group-discover-sub">{{ g.memberCount }} members</span>
                </div>
                <q-btn
                  v-if="myGroupIds.has(g.id)"
                  flat
                  dense
                  no-caps
                  disable
                  label="Already in Suite"
                  class="btn-secondary group-discover-requested"
                />
                <q-btn
                  v-else-if="joinRequestStatus(g.id) === 'PENDING'"
                  flat
                  dense
                  no-caps
                  disable
                  label="Pending"
                  class="btn-secondary group-discover-requested"
                />
                <q-btn
                  v-else
                  unelevated
                  dense
                  no-caps
                  icon="mdi-account-plus"
                  :label="joinRequestStatus(g.id) === 'REJECTED' ? 'Request again' : 'Join'"
                  class="btn-primary-action"
                  :loading="requestingGroupIds.has(g.id)"
                  @click="requestJoinGroup(g.id)"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- NEW CHAT POPUP — opened from the (+) on the filter row. Searching a user
           shows "go to chat" when a link with them already exists (either
           direction), otherwise a send-link action, mirroring the Discover flow. -->
      <q-dialog v-model="newChatOpen" class="new-chat-dialog" dark>
        <q-card class="modal-card new-chat-card">
          <div class="modal-header">
            <h3>new chat</h3>
            <q-btn
              flat
              round
              dense
              icon="mdi-close"
              size="sm"
              class="btn-secondary"
              @click="newChatOpen = false"
            />
          </div>
          <div class="modal-body">
            <q-input
              v-model="newChatQuery"
              dense
              outlined
              dark
              bg-color="transparent"
              placeholder="Search a user…"
              class="new-chat-search"
              @update:model-value="onNewChatSearch"
            >
              <template #prepend>
                <q-icon name="mdi-magnify" />
              </template>
              <template #append>
                <q-spinner v-if="newChatLoading" color="primary" size="xs" />
                <q-icon
                  v-else-if="newChatQuery"
                  name="mdi-close"
                  class="cursor-pointer"
                  @click="newChatQuery = ''"
                />
              </template>
            </q-input>

            <q-scroll-area class="new-chat-list">
              <div v-for="u in newChatResults" :key="u.id" class="new-chat-row">
                <q-avatar size="36px" class="new-chat-avatar">
                  <img
                    v-if="u.profile?.profilePicture"
                    :src="u.profile.profilePicture"
                    :alt="u.username"
                  />
                  <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
                </q-avatar>
                <div class="new-chat-info">
                  <span class="new-chat-name">{{ u.profile?.displayName || u.username }}</span>
                  <span class="new-chat-handle">@{{ u.username }}</span>
                </div>
                <button
                  v-if="existingLinkFor(u.id)"
                  type="button"
                  class="new-chat-action is-goto"
                  @click="goToChatWith(u.id)"
                >
                  go to chat
                </button>
                <button
                  v-else
                  type="button"
                  class="new-chat-action"
                  :disabled="newChatSendingId === u.id"
                  @click="sendLinkTo(u.id)"
                >
                  <q-icon name="mdi-link-variant-plus" size="15px" />
                  <span>send link</span>
                </button>
              </div>

              <div
                v-if="
                  !newChatLoading && newChatQuery.trim().length >= 1 && newChatResults.length === 0
                "
                class="vault-empty-label"
              >
                NO USERS
              </div>
              <div v-else-if="newChatQuery.trim().length < 1" class="vault-empty-label">
                TYPE A USERNAME
              </div>
            </q-scroll-area>
          </div>
        </q-card>
      </q-dialog>

      <!-- CREATE SUITE POPUP -->
      <q-dialog v-model="createSuiteOpen" class="create-suite-dialog" dark>
        <q-card class="create-suite-card">
          <!-- Stage 1: select members -->
          <q-card-section v-show="createStage === 'select'" class="create-suite-stage">
            <div class="create-suite-head">
              <div class="create-suite-title">
                <q-icon name="mdi-account-multiple-plus" size="18px" />
                <span>CREATE SUITE</span>
              </div>
              <q-btn flat round dense icon="mdi-close" size="sm" @click="createSuiteOpen = false" />
            </div>

            <!-- Added chips (WhatsApp-style) -->
            <div v-if="addedMembers.length" class="create-suite-chips">
              <div v-for="m in addedMembers" :key="m.id" class="create-suite-chip">
                <q-avatar size="40px" class="create-suite-chip-avatar">
                  <img
                    v-if="m.profile?.profilePicture"
                    :src="m.profile.profilePicture"
                    :alt="m.username"
                  />
                  <q-icon v-else name="mdi-account" size="20px" color="grey-6" />
                </q-avatar>
                <span class="create-suite-chip-name">{{
                  m.profile?.displayName || m.username
                }}</span>
                <q-btn
                  flat
                  round
                  dense
                  icon="mdi-close"
                  size="xs"
                  class="create-suite-chip-remove"
                  @click="removeAdded(m.id)"
                />
              </div>
            </div>

            <!-- Search any user -->
            <q-input
              :model-value="createSearchQuery"
              dense
              outlined
              dark
              bg-color="transparent"
              placeholder="Search any user…"
              class="create-suite-search"
              @update:model-value="onCreateSearch"
            >
              <template #prepend>
                <q-icon name="mdi-magnify" />
              </template>
            </q-input>

            <!-- Connections (default) + search results -->
            <q-scroll-area class="create-suite-list">
              <div
                v-for="u in createCandidateList"
                :key="u.id"
                class="create-suite-cand"
                :class="{ 'is-added': isAdded(u.id) }"
              >
                <q-avatar size="36px" class="create-suite-cand-avatar">
                  <img
                    v-if="u.profile?.profilePicture"
                    :src="u.profile.profilePicture"
                    :alt="u.username"
                  />
                  <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
                </q-avatar>
                <div class="create-suite-cand-info">
                  <span class="create-suite-cand-name">{{
                    u.profile?.displayName || u.username
                  }}</span>
                  <span class="create-suite-cand-handle">@{{ u.username }}</span>
                </div>
                <q-btn
                  v-if="!isAdded(u.id)"
                  flat
                  round
                  dense
                  icon="mdi-plus"
                  size="sm"
                  class="create-suite-cand-add"
                  @click="addMember(u)"
                />
                <q-icon v-else name="mdi-check" size="18px" class="create-suite-cand-added" />
              </div>
            </q-scroll-area>
          </q-card-section>

          <!-- Stage 2: configure -->
          <q-card-section v-show="createStage === 'configure'" class="create-suite-stage">
            <div class="create-suite-head">
              <div class="create-suite-title">
                <q-icon name="mdi-cog-outline" size="18px" />
                <span>CONFIGURE SUITE</span>
              </div>
              <q-btn flat round dense icon="mdi-close" size="sm" @click="createSuiteOpen = false" />
            </div>

            <div class="create-suite-form">
              <div class="create-suite-field">
                <label class="create-suite-label">Group Avatar URL</label>
                <q-input
                  v-model="newGroupAvatarUrl"
                  dense
                  outlined
                  dark
                  bg-color="transparent"
                  placeholder="https://example.com/avatar.png"
                />
              </div>
              <div class="create-suite-field">
                <label class="create-suite-label">Group Name *</label>
                <q-input
                  v-model="newGroupName"
                  dense
                  outlined
                  dark
                  bg-color="transparent"
                  :error="!newGroupName.trim()"
                  error-message="Name is required"
                />
              </div>

              <div class="create-suite-field">
                <label class="create-suite-label">Default permissions</label>
                <div class="create-suite-permissions-summary">
                  <div class="create-suite-perm-row">
                    <span>change options</span><span class="create-suite-perm-val">owner only</span>
                  </div>
                  <div class="create-suite-perm-row">
                    <span>send media</span><span class="create-suite-perm-val">everyone</span>
                  </div>
                  <div class="create-suite-perm-row">
                    <span>pin messages</span><span class="create-suite-perm-val">admin only</span>
                  </div>
                  <div class="create-suite-perm-row">
                    <span>add members</span><span class="create-suite-perm-val">admin only</span>
                  </div>
                </div>
              </div>

              <div class="create-suite-field">
                <label class="create-suite-label">Visibility</label>
                <q-btn-toggle
                  v-model="isPublicSuite"
                  dense
                  no-caps
                  spread
                  class="create-suite-visibility"
                  :options="[
                    { label: 'PRIVATE', value: false },
                    { label: 'PUBLIC', value: true },
                  ]"
                />
                <span class="create-suite-hint">
                  {{
                    isPublicSuite ? 'Discoverable by anyone' : 'Invite-only — hidden from discovery'
                  }}
                </span>
              </div>
            </div>
          </q-card-section>

          <!-- Footer -->
          <q-separator />
          <q-card-actions class="create-suite-footer">
            <q-btn flat label="Cancel" class="btn-secondary" @click="createSuiteOpen = false" />
            <q-btn
              v-if="createStage === 'select'"
              unelevated
              label="Next"
              class="btn-primary-action"
              @click="createStage = 'configure'"
            />
            <q-btn
              v-else
              unelevated
              label="Create"
              class="btn-primary-action"
              :loading="creatingSuite"
              :disable="!newGroupName.trim()"
              @click="createSuite()"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- GROUP SETTINGS MODAL -->
      <GroupSettingsModal v-model="showGroupSettingsModal" :group-id="settingsGroupId" />

      <!-- SUITE RIGHT-CLICK CONTEXT MENU -->
      <div
        v-if="suiteMenu.open"
        class="suite-ctx-menu"
        :style="{ left: suiteMenu.x + 'px', top: suiteMenu.y + 'px' }"
        @click.stop
      >
        <div class="suite-ctx-list">
          <!-- Announcement broadcast channel -->
          <template v-if="isBroadcastId(suiteMenu.groupId)">
            <div
              class="suite-ctx-item"
              @click="
                toggleBroadcastMenuMute();
                suiteMenu.open = false;
              "
            >
              <q-icon
                :name="broadcastStore.muted ? 'mdi-bell-outline' : 'mdi-bell-off-outline'"
                size="18px"
              />
              <span>{{ broadcastStore.muted ? 'Unmute' : 'Mute' }}</span>
            </div>
            <template v-if="broadcastStore.isAdmin">
              <div class="suite-ctx-sep" />
              <div
                class="suite-ctx-item"
                @click="
                  openBroadcastMembers();
                  suiteMenu.open = false;
                "
              >
                <q-icon name="mdi-account-group-outline" size="18px" />
                <span>Members</span>
              </div>
            </template>
          </template>

          <!-- For active groups (not left) -->
          <template v-else-if="!isLeftGroup(suiteMenu.groupId)">
            <div
              v-if="canAddMembersForGroup(suiteMenu.groupId)"
              class="suite-ctx-item"
              @click="
                openGroupInvite(suiteMenu.groupId);
                suiteMenu.open = false;
              "
            >
              <q-icon name="mdi-account-plus" size="18px" />
              <span>Invite</span>
            </div>
            <div
              class="suite-ctx-item"
              @click="
                openGroupSettings(suiteMenu.groupId);
                suiteMenu.open = false;
              "
            >
              <q-icon name="mdi-cog-outline" size="18px" />
              <span>Settings</span>
            </div>
            <div
              class="suite-ctx-item suite-ctx-report"
              @click="
                reportSuite(suiteMenu.groupId);
                suiteMenu.open = false;
              "
            >
              <q-icon name="mdi-alert-octagon-outline" size="18px" />
              <span>Report Suite</span>
            </div>
            <div class="suite-ctx-sep" />
            <div
              class="suite-ctx-item suite-ctx-danger"
              @click="
                confirmLeaveGroup(suiteMenu.groupId);
                suiteMenu.open = false;
              "
            >
              <q-icon name="mdi-exit-to-app" size="18px" />
              <span>Leave Suite</span>
            </div>
          </template>
          <!-- For left groups -->
          <template v-else>
            <div
              class="suite-ctx-item suite-ctx-danger"
              @click="
                confirmDeleteLeftGroup(suiteMenu.groupId);
                suiteMenu.open = false;
              "
            >
              <q-icon name="mdi-delete" size="18px" />
              <span>Remove from Device</span>
            </div>
          </template>
        </div>
      </div>

      <!-- BROADCAST MEMBER-PICKER DIALOG (admin remove/re-add) -->
      <q-dialog v-model="broadcastMembersOpen" class="group-invite-dialog" dark>
        <q-card class="modal-card broadcast-members-card">
          <div class="modal-header">
            <h3>announcement members</h3>
            <q-btn
              flat
              round
              dense
              icon="mdi-close"
              size="sm"
              class="btn-secondary"
              @click="broadcastMembersOpen = false"
            />
          </div>
          <q-scroll-area class="broadcast-members-scroll">
            <q-inner-loading :showing="broadcastMembersLoading" />
            <template v-if="!broadcastMembersLoading">
              <template v-if="broadcastStore.groupedMembers.owners.length > 0">
                <div class="suite-panel-category">
                  <span>OWNER</span>
                  <span class="suite-panel-category-count">
                    {{ broadcastStore.groupedMembers.owners.length }}
                  </span>
                </div>
                <div
                  v-for="member in broadcastStore.groupedMembers.owners"
                  :key="member.userId"
                  class="suite-panel-member"
                >
                  <q-avatar size="32px" class="suite-panel-member-avatar">
                    <img
                      v-if="member.profilePicture"
                      :src="member.profilePicture"
                      :alt="member.username || ''"
                    />
                    <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                  </q-avatar>
                  <div class="suite-panel-member-copy">
                    <span class="suite-panel-member-name">{{
                      member.displayName || member.username || 'Member'
                    }}</span>
                    <span class="suite-panel-member-handle">@{{ member.username || 'user' }}</span>
                  </div>
                  <span class="suite-role-badge">OWNER</span>
                </div>
              </template>

              <template v-if="broadcastStore.groupedMembers.admins.length > 0">
                <div class="suite-panel-category">
                  <span>ADMINS</span>
                  <span class="suite-panel-category-count">
                    {{ broadcastStore.groupedMembers.admins.length }}
                  </span>
                </div>
                <div
                  v-for="member in broadcastStore.groupedMembers.admins"
                  :key="member.userId"
                  class="suite-panel-member"
                >
                  <q-avatar size="32px" class="suite-panel-member-avatar">
                    <img
                      v-if="member.profilePicture"
                      :src="member.profilePicture"
                      :alt="member.username || ''"
                    />
                    <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                  </q-avatar>
                  <div class="suite-panel-member-copy">
                    <span class="suite-panel-member-name">{{
                      member.displayName || member.username || 'Member'
                    }}</span>
                    <span class="suite-panel-member-handle">@{{ member.username || 'user' }}</span>
                  </div>
                  <div class="broadcast-member-actions">
                    <q-btn
                      v-if="broadcastStore.isAdmin && !isSelfMember(member.userId)"
                      flat
                      dense
                      no-caps
                      icon="mdi-account-key-outline"
                      size="sm"
                      class="suite-role-badge suite-role-badge--action"
                      label="READD"
                      @click="readdBroadcastMember(member.userId)"
                    />
                    <q-btn
                      v-if="broadcastStore.isAdmin && !isSelfMember(member.userId)"
                      flat
                      dense
                      no-caps
                      icon="mdi-account-remove-outline"
                      size="sm"
                      class="suite-role-badge suite-role-badge--action suite-role-badge--danger"
                      label="REMOVE"
                      @click="removeBroadcastMember(member.userId)"
                    />
                  </div>
                </div>
              </template>

              <template v-if="broadcastStore.groupedMembers.members.length > 0">
                <div class="suite-panel-category">
                  <span>MEMBERS</span>
                  <span class="suite-panel-category-count">
                    {{ broadcastStore.groupedMembers.members.length }}
                  </span>
                </div>
                <div
                  v-for="member in broadcastStore.groupedMembers.members"
                  :key="member.userId"
                  class="suite-panel-member"
                >
                  <q-avatar size="32px" class="suite-panel-member-avatar">
                    <img
                      v-if="member.profilePicture"
                      :src="member.profilePicture"
                      :alt="member.username || ''"
                    />
                    <q-icon v-else name="mdi-account" size="16px" color="grey-6" />
                  </q-avatar>
                  <div class="suite-panel-member-copy">
                    <span class="suite-panel-member-name">{{
                      member.displayName || member.username || 'Member'
                    }}</span>
                    <span class="suite-panel-member-handle">@{{ member.username || 'user' }}</span>
                  </div>
                  <div class="broadcast-member-actions">
                    <q-btn
                      v-if="broadcastStore.isAdmin && !isSelfMember(member.userId)"
                      flat
                      dense
                      no-caps
                      icon="mdi-account-key-outline"
                      size="sm"
                      class="suite-role-badge suite-role-badge--action"
                      label="READD"
                      @click="readdBroadcastMember(member.userId)"
                    />
                    <q-btn
                      v-if="broadcastStore.isAdmin && !isSelfMember(member.userId)"
                      flat
                      dense
                      no-caps
                      icon="mdi-account-remove-outline"
                      size="sm"
                      class="suite-role-badge suite-role-badge--action suite-role-badge--danger"
                      label="REMOVE"
                      @click="removeBroadcastMember(member.userId)"
                    />
                  </div>
                </div>
              </template>

              <div v-if="broadcastStore.members.length === 0" class="suite-panel-empty">
                No members.
              </div>
            </template>
          </q-scroll-area>
        </q-card>
      </q-dialog>

      <!-- INVITE TO EXISTING GROUP DIALOG -->
      <q-dialog v-model="groupInviteOpen" class="group-invite-dialog" dark>
        <q-card class="modal-card group-invite-card">
          <div class="modal-header">
            <h3>invite to suite</h3>
            <q-btn
              flat
              round
              dense
              icon="mdi-close"
              size="sm"
              class="btn-secondary"
              @click="groupInviteOpen = false"
            />
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">search users</label>
              <input
                class="form-input"
                placeholder="type a username…"
                :value="groupInviteQuery"
                @input="onGroupInviteSearch(($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="group-invite-results">
              <div v-if="groupInviteLoading" class="vault-empty-state">
                <q-spinner color="primary" size="20px" />
              </div>
              <button
                v-for="u in groupInviteResults"
                :key="u.id"
                type="button"
                class="group-invite-user"
                @click="inviteUserFromDialog(u)"
              >
                <q-avatar size="32px">
                  <img
                    v-if="u.profile?.profilePicture"
                    :src="u.profile.profilePicture"
                    :alt="u.username"
                  />
                  <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
                </q-avatar>
                <span class="group-invite-user-name">{{
                  u.profile?.displayName || u.username
                }}</span>
                <span class="group-invite-user-handle">@{{ u.username }}</span>
                <span class="group-invite-user-add">+ invite</span>
              </button>
              <div
                v-if="
                  !groupInviteLoading &&
                  groupInviteQuery.length >= 1 &&
                  groupInviteResults.length === 0
                "
                class="vault-empty-label"
              >
                NO USERS
              </div>
            </div>
          </div>
        </q-card>
      </q-dialog>

      <!-- LEAVE GROUP CONFIRM -->
      <q-dialog v-model="leaveConfirmOpen" class="group-leave-dialog" dark>
        <q-card class="group-leave-card bg-dark">
          <q-card-section>
            <div class="group-leave-title">
              <q-icon name="mdi-exit-to-app" size="18px" />
              <span>Leave this suite?</span>
            </div>
            <p class="group-leave-body">
              You'll stop receiving messages. You can be re-invited later.
            </p>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" class="btn-secondary" v-close-popup />
            <q-btn unelevated label="Leave" class="btn-danger" @click="leaveGroupConfirmed" />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- OWNER LEAVE DIALOG (transfer ownership or delete) -->
      <q-dialog v-model="ownerLeaveOpen" class="owner-leave-dialog" dark>
        <q-card class="owner-leave-card bg-dark">
          <q-card-section>
            <div class="group-leave-title">
              <q-icon name="mdi-crown" size="18px" class="text-warning" />
              <span>You're the owner</span>
            </div>
            <p class="group-leave-body">
              <template v-if="otherGroupMembers.length === 0">
                You're the only member. You can delete this suite entirely.
              </template>
              <template v-else-if="otherGroupMembers.length === 1">
                Ownership will be transferred to:
                <strong>{{ otherGroupMembers[0]?.displayName || 'the other member' }}</strong>
              </template>
              <template v-else> Select a new owner before leaving: </template>
            </p>

            <!-- Owner selection for multiple members -->
            <div v-if="otherGroupMembers.length > 1" class="owner-select q-mt-md">
              <q-option-group
                v-model="selectedNewOwner"
                :options="otherGroupMembers.map((m) => ({ label: m.displayName, value: m.userId }))"
                type="radio"
                color="primary"
              />
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" class="btn-secondary" v-close-popup />
            <q-btn
              v-if="otherGroupMembers.length === 0"
              unelevated
              class="btn-danger"
              label="Delete Suite"
              @click="handleOwnerLeave"
            />
            <q-btn
              v-else
              unelevated
              class="btn-primary-action"
              label="Transfer & Leave"
              :loading="isTransferringOwnership"
              @click="handleOwnerLeave"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- DELETE GROUP CONFIRM -->
      <q-dialog v-model="deleteGroupOpen" class="delete-group-dialog" dark>
        <q-card class="delete-group-card bg-dark">
          <q-card-section>
            <div class="group-leave-title text-negative">
              <q-icon name="mdi-delete" size="18px" />
              <span>Delete this suite?</span>
            </div>
            <p class="group-leave-body">
              This will permanently delete the suite and all its messages. This action cannot be
              undone.
            </p>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" class="btn-secondary" v-close-popup />
            <q-btn unelevated label="Delete" class="btn-danger" @click="handleDeleteGroup" />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-page>

    <!-- COMS SETTINGS DIALOG -->
    <q-dialog v-model="showComsSettingsDialog" persistent dark>
      <q-card class="modal-card coms-settings-card">
        <q-card-section class="modal-header coms-settings-header">
          <div class="coms-settings-header-title">
            <q-icon name="mdi-shield-account-variant" size="18px" class="text-primary" />
            <span>Coms Settings</span>
          </div>
          <q-btn
            flat
            round
            dense
            icon="mdi-close"
            size="sm"
            class="btn-secondary"
            @click="closeComsSettings"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="modal-body coms-settings-content">
          <!-- Auto Download Media -->
          <div class="coms-settings-section">
            <div class="coms-settings-row">
              <div class="coms-settings-label">
                <span>Auto Download Media</span>
                <span class="coms-settings-desc"
                  >Automatically download images and videos in chats</span
                >
              </div>
              <label class="toggle-item compact">
                <input v-model="autoDownloadMedia" type="checkbox" />
                <span class="toggle-switch" aria-hidden="true" />
              </label>
            </div>
          </div>

          <q-separator class="q-my-sm" />

          <!-- In-app message banner -->
          <div class="coms-settings-section">
            <div class="coms-settings-row">
              <div class="coms-settings-label">
                <span>In-app Message Banners</span>
                <span class="coms-settings-desc"
                  >Show a banner with the sender and message when one arrives while the app is
                  open</span
                >
              </div>
              <label class="toggle-item compact">
                <input v-model="inAppBannerEnabledProxy" type="checkbox" />
                <span class="toggle-switch" aria-hidden="true" />
              </label>
            </div>
          </div>

          <q-separator class="q-my-sm" />

          <!-- Link to Dashboard Privacy Settings -->
          <div class="coms-settings-section">
            <div class="coms-settings-row">
              <div class="coms-settings-label">
                <span>Privacy Settings</span>
                <span class="coms-settings-desc">Configure who can message you and more</span>
              </div>
              <q-btn
                flat
                dense
                class="btn-secondary"
                label="Open Dashboard"
                icon="mdi-open-in-new"
                size="sm"
                @click="openComsSettingsDashboard"
              />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" class="btn-secondary" @click="closeComsSettings" />
          <q-btn unelevated label="Save" class="btn-primary-action" @click="saveComsSettings" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  onErrorCaptured,
  watch,
  nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useLinksStore } from 'stores/links';
import { useAuthStore } from 'stores/auth';
import { useNotificationsStore } from 'stores/notifications';
import { isOfflineVaultEnabled } from 'src/crypto/offlineVault';
import { isDeviceBindingRequired } from 'src/utils/apiAuthFailure';
import { useNavigation } from 'src/composables/useNavigation';
import { purgeAttachmentAccount, purgeAttachmentMessage, purgeAttachmentSession, type AttachmentCacheContext } from 'src/composables/useBlobAttachmentCache';
import { useVaultBlobAttachments, mediaAutoDownloadEnabled } from 'src/composables/useVaultBlobAttachments';
import { sameAccount, messageText, isSendEnter, useUiLifetime, type AccountSnapshot } from 'src/components/messaging/uiSafety';
import { useAppSettingsStore } from 'stores/appSettings';
import { scrollToHighlightedMessage } from 'src/composables/useMessageNavigation';
import { usePlatform } from 'src/composables/usePlatform';
import { registerMobileBackHandler } from 'src/composables/useAndroidBack';
import { hapticTap, hapticSelect, hapticSuccess } from 'src/composables/useHaptics';
import { useVaultEnrollment } from 'src/composables/useVaultEnrollment';
import { createSwipeHandlers } from 'src/composables/useSwipeGesture';
import ChatListItem from 'src/components/messaging/ChatListItem.vue';
import MessageContextMenu from 'src/components/messaging/MessageContextMenu.vue';
import { openTicketReport } from 'src/utils/ticketLinks';
import MessageQuickActions from 'src/components/messaging/MessageQuickActions.vue';
import MessageReplyReference from 'src/components/messaging/MessageReplyReference.vue';
import MessageReactions from 'src/components/messaging/MessageReactions.vue';
import OfflineAlert from 'src/components/offline/OfflineAlert.vue';
import GroupChatWindow from 'src/components/suites/GroupChatWindow.vue';
import GroupSettingsModal from 'src/components/suites/GroupSettingsModal.vue';
import BroadcastChatWindow from 'src/components/suites/BroadcastChatWindow.vue';
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';
import { useBroadcastStore } from 'src/stores/broadcastStore';
import type { Link, SearchUser } from 'src/types/links';
import { useVaultStore } from 'stores/vault';
import type { RetentionMode, MessageStatus } from 'stores/vault';
import { resolveApiUrl } from 'boot/axios';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  encryptAndUploadBlob,
  blobTransfers,
  buildBlobMessageText,
  parseBlobAttachment,
  type BlobAttachment,
} from 'src/crypto/blobTransfer';
import { useDashboardStore } from 'src/stores/dashboard';
import { useGroupStore } from 'src/stores/groupStore';
import type { PublicGroup } from 'src/stores/groupStore';
import type { Group } from 'src/stores/groupStore';
import { createKeyedOpener } from 'src/utils/chatOpenGuard';
import { resolveUploadFileName } from 'src/utils/fileNames';
import { DeliveryPollTracker, startDeliveryPolling } from 'src/composables/useDeliveryPolling';
import { normalizeMediaUrl } from 'src/utils/mediaUrls';
import { ALL_EMOJIS, QUICK_EMOJIS, messagingEmojiUrl } from 'src/utils/messagingEmoji';
import { invoke } from '@tauri-apps/api/core';
import { capturePhoto } from 'src/services/mobileMedia';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Configure marked for Discord-like markdown (GFM, no HTML passthrough)
const markedInstance = new Marked({
  gfm: true,
  breaks: true,
});

const $q = useQuasar();
const linksStore = useLinksStore();
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const lifetime = useUiLifetime();
const accountSnapshot = (): AccountSnapshot => ({ accountId: authStore.user?.id ?? '', generation: authStore.authOperationGeneration });
const currentAccount = (snapshot: AccountSnapshot) => lifetime.isAlive() && sameAccount(snapshot, accountSnapshot());

/** Offline messages badge only on the desktop (Tauri) runtime — zero web surface. */
const isDesktopVault = computed(() => isOfflineVaultEnabled());
const vaultStore = useVaultStore();

/**
 * Authorized offline mode (krul 2026-08): only when desktop + the user is
 * authenticated on this device + they chose "stay logged in". Without this,
 * messaging shows NO offline capability (no badge, no alert, nothing served).
 */
const offlineAuthorized = ref(false);
/** All offline messaging surfaces gate on this (badge + alert + reads). */
const offlineSurfaceVisible = computed(() => isDesktopVault.value && offlineAuthorized.value);
/** Offline alert only surfaces on the desktop when authorized + offline. */
const messagingOfflineAlert = computed(() => offlineSurfaceVisible.value && linksStore.offline);
const dashboardStore = useDashboardStore();
const groupStore = useGroupStore();
const broadcastStore = useBroadcastStore();
const { openSearch } = useNavigation();
const router = useRouter();

// Sorted groups with explicit typing
const sortedGroups = computed(() => groupStore.sortedGroups() as unknown as Group[]);

// ---------------------------------------------------------------------
// Announcement broadcast channel surfaced in the SUITES tab "like a group".
// It is not an MLS group; we prepend a synthetic group-shaped entry to the
// suite list and render BroadcastChatWindow when it is selected.
// ---------------------------------------------------------------------
/** Stable local id for the announcement channel entry (not a backend group id). */
const BROADCAST_SYNTHETIC_ID = 'broadcast:mourn-announcements';
function isBroadcastId(id: string): boolean {
  return id === BROADCAST_SYNTHETIC_ID;
}
const broadcastActive = ref(false);

const broadcastListItem = computed<Group>(() => ({
  id: BROADCAST_SYNTHETIC_ID,
  name: broadcastStore.activeChannel?.name || 'Announcements',
  avatarUrl: null,
  ownerId: '',
  isPublic: true,
  createdAt: '',
  updatedAt: '',
  epoch: 0,
  members: [],
  memberCount: broadcastStore.activeChannel?.memberCount ?? 0,
  isLeft: false,
  isPinned: false,
  permissions: {
    canPinMessages: 'ADMINS_ONLY',
    canAddMembers: 'ADMINS_ONLY',
    canSendMedia: 'ADMINS_ONLY',
    canChangeOptions: 'ADMINS_ONLY',
  },
}));

/** The suite list with the announcement channel pinned to the top. */
const suitesList = computed<Group[]>(() => [broadcastListItem.value, ...sortedGroups.value]);

/** Highlight in the suite list: broadcast channel or an MLS group. */
function isSuiteActive(id: string): boolean {
  if (isBroadcastId(id)) return broadcastActive.value;
  return groupStore.activeGroupId === id;
}

// Settings Modal State
const showSettingsModal = ref(false);
const showCompromiseModal = ref(false);
const showDeleteModal = ref(false);
const showVerificationModal = ref(false);
const showChatSettingsModal = ref(false);
const showConfirmModal = ref(false);
const confirmModal = ref<{
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}>({ title: '', message: '', confirmLabel: 'Confirm', danger: false, onConfirm: () => {} });

function openConfirm(opts: typeof confirmModal.value) {
  confirmModal.value = opts;
  showConfirmModal.value = true;
}

const RIGHT_PANEL_AUTO_HIDE_WIDTH = 1280;
const rightPanelOpen = ref(false);
const settingsForm = ref({
  mode: 'persistent' as RetentionMode,
  retainHours: 24,
});

// Message search state
const messageSearchMode = ref(false);
const messageSearchQuery = ref('');
const searchResults = ref<VaultMsgView[]>([]);
const searchCurrentIndex = ref(0);

type MessagingTab = 'chats' | 'suites' | 'signals';
const activeTab = ref<MessagingTab>('chats');
const selectedLink = ref<Link | null>(null);
const lastSelectedLinkId = ref<string | null>(null);
const lastSelectedGroupId = ref<string | null>(null);
let tabTransitionVersion = 0;

const { isMobile } = usePlatform();

/**
 * The mobile layout shows ONE pane at a time (WhatsApp/Telegram shape): while a
 * conversation is open the list is hidden and the chat owns the viewport, so the
 * chat header's back button is the only way out. The same flag drives the body
 * class that hides the app's bottom nav — that strip belongs to the message
 * input and the on-screen keyboard, not to navigation.
 */
const mobileChatOpen = computed(
  () =>
    isMobile.value &&
    Boolean(
      selectedLink.value ||
        groupStore.activeGroupId ||
        broadcastActive.value ||
        // closeConversation() clears this too, and the chat pane can be driven by
        // it alone — without it, back fell through to history and landed on home.
        vaultStore.activeLinkId,
    ),
);

/**
 * History trap for the Android back gesture.
 *
 * The registered handler below is the intended path, but it is not the only thing
 * that can act on a back press: Capacitor falls back to its own webview history
 * pop, and `boot/androidBack.ts` falls back to router.back(). Both of those pop the
 * ROUTE, so a press while a conversation was open skipped past the chat list
 * entirely and dumped the user on the home page.
 *
 * Pushing a marker entry when a conversation opens means the first press pops that
 * marker instead — we catch it in popstate, close the conversation, and stay on the
 * messaging route. Back from a chat now lands on the chat list, which is what every
 * messaging app does.
 */
function onChatPopState(): void {
  if (!mobileChatOpen.value) return;
  closeConversation();
}

let chatPopTrapAttached = false;

watch(
  mobileChatOpen,
  (open) => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('vault-chat-open', open);
    if (!open) return;
    if (!chatPopTrapAttached) {
      window.addEventListener('popstate', onChatPopState);
      chatPopTrapAttached = true;
    }
    history.pushState({ ...(history.state ?? {}), mournChat: true }, '');
  },
  { immediate: true },
);

/**
 * Android back (hardware + swipe) closes the open conversation instead of
 * leaving the app — the one behaviour every chat app has. Registered here so the
 * handler exists only while this page does; `boot/androidBack.ts` owns the
 * listener and falls back to the app's history.
 */
/**
 * Play the same slide-out the swipe gesture produces, then drop the conversation.
 * The header back button and the Android back gesture use this so leaving a chat
 * always looks identical to swiping it away. Guarded to mobile: on desktop the
 * `--chat-drag` transform has no mobile rule behind it and would shove the whole
 * two-pane layout sideways.
 */
function animateConversationOut(): void {
  if (!isMobile.value) {
    closeConversation();
    return;
  }
  chatDragging.value = false;
  chatDragOffset.value = Math.max(viewportWidth.value, 1);
  window.setTimeout(() => {
    chatDragOffset.value = 0;
    closeConversation();
  }, 240);
}

const disposeMobileBack = registerMobileBackHandler(() => {
  if (!mobileChatOpen.value) return false;
  void hapticTap();
  animateConversationOut();
  return true;
});

/**
 * Back/close from the chat header. Separate from closeConversation() itself
 * because that is also called programmatically (tab switches, mount), and a
 * haptic on a programmatic close would buzz for no reason.
 */
function onChatBack(): void {
  void hapticTap();
  animateConversationOut();
}

/** Tab order for the swipe gesture — must match the tab bar. */
const MESSAGING_TAB_ORDER = ['chats', 'suites', 'signals'] as const;

/** Live finger-follow offset of the pane track, in px. */
const tabDragOffset = ref(0);
const tabDragging = ref(false);

/** How far a swipe must travel before releasing commits to the next tab. */
const TAB_SWIPE_COMMIT_PX = 72;

/**
 * One full pane per tab, plus the finger offset. The horizontal part is expressed
 * as a percentage so it stays correct when the pane is resized.
 */
const tabTrackStyle = computed(() => ({
  transform: `translate3d(calc(${-100 * Math.max(tabIndexOf(activeTab.value), 0)}% + ${tabDragOffset.value}px), 0, 0)`,
}));

/** Damped travel past the first/last tab, so the end of the strip resists instead of doing nothing. */
function dampedTabDelta(delta: number): number {
  const index = tabIndexOf(activeTab.value);
  const atStart = index <= 0 && delta > 0;
  const atEnd = index >= MESSAGING_TAB_ORDER.length - 1 && delta < 0;
  return atStart || atEnd ? delta * 0.25 : delta;
}

function tabIndexOf(tab: string): number {
  return MESSAGING_TAB_ORDER.indexOf(tab as (typeof MESSAGING_TAB_ORDER)[number]);
}

function endTabDrag(): void {
  tabDragging.value = false;
  tabDragOffset.value = 0;
}

/** Advance/retreat through the tabs. `direction` 1 = next (chats → suites). */
function stepMessagingTab(direction: 1 | -1): void {
  const index = tabIndexOf(activeTab.value);
  if (index === -1) return;
  const next = MESSAGING_TAB_ORDER[index + direction];
  if (!next) return;
  void hapticSelect();
  selectMessagingTab(next);
}

/**
 * Swipe the list pane to move between the vault tabs, standard pager direction:
 * swipe LEFT goes forward (chats → suites → signals), swipe RIGHT goes back.
 *
 * The commit happens on RELEASE and the track follows the finger 1:1 the whole
 * way, so the panes actually slide past each other; `threshold` is set out of reach
 * on purpose so nothing commits mid-drag.
 *
 * A conversation row owns its own horizontal gesture (swipe right = reveal
 * actions), so a touch starting on one is ignored here.
 */
const tabSwipeHandlers = createSwipeHandlers({
  axis: 'x',
  threshold: Number.MAX_SAFE_INTEGER,
  shouldStart: (event) => {
    if (mobileChatOpen.value) return false;
    const target = event.target as HTMLElement | null;
    return !target?.closest?.('.vault-swipe-wrap');
  },
  onMove: (delta) => {
    tabDragging.value = true;
    tabDragOffset.value = dampedTabDelta(delta);
  },
  onEnd: ({ delta }) => {
    const committed = Math.abs(delta) >= TAB_SWIPE_COMMIT_PX;
    endTabDrag();
    if (!committed) return;
    stepMessagingTab(delta < 0 ? 1 : -1);
  },
  onCancel: () => endTabDrag(),
});

/**
 * Pull-to-refresh on the list panes.
 *
 * Only arms from the very top of the pane's scroller, and only on a downward drag,
 * so reading upwards never triggers it. The indicator grows in flow above the
 * track, which pushes the list down like a native refresh control rather than
 * floating over it.
 */
const PULL_TRIGGER_PX = 64;
const PULL_MAX_PX = 96;
const pullOffset = ref(0);
const pullDragging = ref(false);
const pullRefreshing = ref(false);
const pullArmed = computed(() => pullOffset.value >= PULL_TRIGGER_PX);

async function runPullRefresh(): Promise<void> {
  pullRefreshing.value = true;
  pullOffset.value = PULL_TRIGGER_PX;
  void hapticTap();
  try {
    await Promise.all([refreshLinks({ silent: true }), groupStore.fetchGroups().catch(() => {})]);
  } finally {
    pullRefreshing.value = false;
    pullOffset.value = 0;
  }
}

const pullRefreshHandlers = createSwipeHandlers({
  axis: 'y',
  threshold: Number.MAX_SAFE_INTEGER,
  shouldStart: (event) => {
    if (mobileChatOpen.value || pullRefreshing.value) return false;
    const target = event.target as HTMLElement | null;
    const scroller = target
      ?.closest?.('.vault-left-body')
      ?.querySelector('.q-scrollarea__container');
    return !scroller || scroller.scrollTop <= 0;
  },
  onMove: (delta) => {
    if (delta <= 0) return;
    pullDragging.value = true;
    // Resistance grows with distance, like a native refresh control.
    pullOffset.value = Math.min(PULL_MAX_PX, delta * 0.45);
  },
  onEnd: () => {
    pullDragging.value = false;
    if (!pullArmed.value) {
      pullOffset.value = 0;
      return;
    }
    void runPullRefresh();
  },
  onCancel: () => {
    pullDragging.value = false;
    pullOffset.value = 0;
  },
});

/**
 * Swipe inside an open conversation returns to the list — the in-app equivalent of
 * the back button. Only active while a conversation is open (on mobile that is the
 * whole screen). The Android system back gesture does the same through
 * boot/androidBack.ts, so both routes exist and neither conflicts with the list.
 */
/** Finger-follow offset for the conversation surface while swiping back. */
const chatDragOffset = ref(0);
const chatDragging = ref(false);
const chatDragVars = computed(() => ({ '--chat-drag': `${chatDragOffset.value}px` }));

/**
 * True while the conversation is being swiped away. Only then is the list rendered
 * behind it (see the CSS): keeping it rendered all the time let the list's row borders
 * show through the conversation, but it has to exist for the slide to reveal it.
 */
const chatRevealing = computed(() => chatDragging.value || chatDragOffset.value > 0);

/** How far a swipe must travel before releasing exits the conversation. */
const CHAT_SWIPE_EXIT_PX = 72;

/**
 * Swipe RIGHT inside a conversation returns to the list.
 *
 * The commit happens on release, and the conversation follows the finger 1:1 the
 * whole way: past the threshold it continues sliding fully off screen and only then
 * does the list take over, so the exit is one continuous motion rather than a swap.
 * The list stays rendered underneath (no display:none) precisely so it is already
 * there to be revealed.
 */
const chatSwipeHandlers = createSwipeHandlers({
  axis: 'x',
  threshold: Number.MAX_SAFE_INTEGER,
  shouldStart: () => mobileChatOpen.value,
  onMove: (delta) => {
    if (delta <= 0) return;
    chatDragging.value = true;
    chatDragOffset.value = delta;
  },
  onEnd: ({ delta }) => {
    chatDragging.value = false;
    if (delta < CHAT_SWIPE_EXIT_PX) {
      chatDragOffset.value = 0;
      return;
    }
    // Finish the slide first; the class that owns the takeover is only dropped once
    // the conversation is off screen, otherwise it disappears mid-gesture.
    chatDragOffset.value = Math.max(viewportWidth.value, delta);
    window.setTimeout(() => {
      chatDragOffset.value = 0;
      void hapticTap();
      closeConversation();
    }, 240);
  },
  onCancel: () => {
    chatDragging.value = false;
    chatDragOffset.value = 0;
  },
});

// ── Last-resort render boundary ───────────────────────────────────────────
// A throw anywhere in this page's own render tree (one message bubble, a picker,
// the Suites window, a media element) would otherwise propagate up and leave the
// conversation unmounted — the thread "goes empty" and stays that way until the
// route is re-entered. Swallow it here, log it on-device, and keep the rest of
// the page alive and usable.
onErrorCaptured((err, _instance, info) => {
  console.error('[MessagingPage] Captured render error — page kept alive', { info, err });
  return false; // stop propagation: do NOT let it reach the app root
});

function syncSelectedLinkFromStore(): Link | null {
  if (!selectedLink.value) return null;
  const fresh = linksStore.links.find((link) => link.id === selectedLink.value?.id) ?? null;
  selectedLink.value = fresh;
  return fresh;
}

function closeConversation(): void {
  selectedLink.value = null;
  groupStore.setActiveGroup(null);
  broadcastActive.value = false;
  vaultStore.setActiveLink(null);
  rightPanelOpen.value = false;
  replyingTo.value = null;
  exitSearchMode();
}

async function restoreSelectionForTab(tab: MessagingTab): Promise<void> {
  // The mobile layout shows ONE pane at a time, so landing on a tab (or opening
  // the page) must land on the LIST. Auto-reopening a conversation here dropped
  // the phone straight into a full-screen chat, which hid the conversation list
  // entirely — it read as "the list is gone / I can't scroll it". Desktop keeps
  // the two-pane behaviour, where an empty right pane beside a full list is the
  // worse outcome. Deep links still call openChat()/openGroupChat() directly.
  if (isMobile.value) {
    closeConversation();
    return;
  }

  if (tab === 'signals') {
    closeConversation();
    return;
  }

  if (tab === 'chats') {
    groupStore.setActiveGroup(null);
    broadcastActive.value = false;
    if (selectedLink.value && selectedLink.value.status !== 'PENDING') return;
    const candidates = sortLinksForDisplay(
      (linksStore.chatChains as Link[]).filter((link) => link.status !== 'PENDING'),
    );
    const preferred =
      candidates.find((link) => link.id === lastSelectedLinkId.value) ?? candidates[0] ?? null;
    if (preferred) await openChat(preferred);
    else closeConversation();
    return;
  }

  selectedLink.value = null;
  vaultStore.setActiveLink(null);
  rightPanelOpen.value = false;
  groupStore.setActiveGroup(null);
  // Prefer the previously selected item; if it was the announcement channel,
  // reopen the broadcast window. Otherwise fall back to the first non-left group.
  if (broadcastActive.value || lastSelectedGroupId.value === BROADCAST_SYNTHETIC_ID) {
    await openBroadcast();
    return;
  }
  const available = sortedGroups.value.filter((group) => !group.isLeft);
  const preferred =
    available.find((group) => group.id === lastSelectedGroupId.value) ?? available[0] ?? null;
  if (preferred) openGroupChat(preferred.id);
}

function selectMessagingTab(value: string): void {
  if (value !== 'chats' && value !== 'suites' && value !== 'signals') return;
  if (activeTab.value === value) {
    void restoreSelectionForTab(value);
    return;
  }
  // The track animates to whatever index this is, so no transition bookkeeping is
  // needed here — the slide direction falls out of the movement itself.
  activeTab.value = value;
}

// Reply state
const replyingTo = ref<{ id: string; text: string; isSender: boolean } | null>(null);

// Context menu state
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  msg: { id: string; text: string; isSender: boolean; timestamp: number } | null;
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | null;
}>({ visible: false, x: 0, y: 0, msg: null, mediaUrl: null, mediaType: null });

// Image / video preview state
const imagePreview = ref<{
  visible: boolean;
  url: string;
  zoom: number;
  originX: number;
  originY: number;
  filename?: string;
}>({ visible: false, url: '', zoom: 1, originX: 0, originY: 0 });
const videoPreview = ref<{ visible: boolean; url: string; filename?: string }>({
  visible: false,
  url: '',
});
const {
  blobPreviewUrls,
  blobAttachmentErrors,
  downloadingBlobs,
  cacheAttachmentBlob,
  releaseObjectUrls,
  savedBlobSuccess,
  ensurePreview,
  saveAttachment,
  saveBlobObjectUrl,
} = useVaultBlobAttachments({
  context: vaultAttachmentContext,
  scopeKey: () => `${authStore.user?.id}:${authStore.authOperationGeneration}:${selectedLink.value?.id}`,
});

function vaultAttachmentContext(attachment: BlobAttachment, messageId?: string, timestamp?: number): AttachmentCacheContext | null {
  const accountId = authStore.user?.id;
  const link = selectedLink.value;
  if (!accountId || !link) return null;
  const message = (vaultStore.messages[link.id] ?? []).find((m) => parseBlobAttachment(parseMessageEnvelope(m.plaintext).text)?.blobId === attachment.blobId);
  const id = messageId ?? message?.id;
  if (!id) return null;
  const settings = vaultStore.activeSettings[link.id] ?? vaultStore.accountRetention;
  const deadlines: number[] = [];
  if (link.expiresAt) deadlines.push(new Date(link.expiresAt).getTime());
  if (settings?.mode === 'ephemeral_time') deadlines.push((timestamp ?? message?.timestamp ?? 0) + (settings.retainHours ?? 24) * 3600000);
  return { accountId, conversationId: link.id, messageId: id, expiresAt: deadlines.length ? Math.min(...deadlines) : null, sessionId: settings?.mode === 'ephemeral_session' ? vaultStore.sessionId : null, keyHex: attachment.keyHex };
}

interface VaultMsgView {
  id: string;
  text: string;
  isSender: boolean;
  timestamp: number;
  isUnsafe: boolean;
  replyTo: { id: string; sender: string; text: string } | null;
  reactions: Record<string, string[]>;
  status?: MessageStatus;
  senderTimezone?: MessageTimezone;
}

// NOTE: `isDesktopBuild` / `isNativeShellBuild` used to be read here for the
// Discover + Com settings buttons that lived in the removed brand row. Those
// actions moved behind the (⋮) on the tab row, so the flags are no longer needed.

// Coms settings dialog state
const showComsSettingsDialog = ref(false);
const autoDownloadMedia = ref(mediaAutoDownloadEnabled());

const appSettingsStore = useAppSettingsStore();

/**
 * The in-app banner preference lives in the app settings store and is persisted the
 * moment it changes (no Save needed), so this dialog toggle writes straight through.
 */
const inAppBannerEnabledProxy = computed({
  get: () => appSettingsStore.inAppMessageBanner,
  set: (value: boolean) => appSettingsStore.setInAppMessageBanner(value),
});

function openComsSettings() {
  // Load current auto-download preference
  autoDownloadMedia.value = mediaAutoDownloadEnabled();
  // Make sure the persisted banner preference is loaded before the toggle renders.
  appSettingsStore.hydrate();
  showComsSettingsDialog.value = true;
}

function closeComsSettings() {
  showComsSettingsDialog.value = false;
}

function saveComsSettings() {
  try { localStorage.setItem('mourn_auto_download_media', autoDownloadMedia.value ? 'true' : 'false'); } catch { /* preference remains in memory */ }
  showComsSettingsDialog.value = false;
  $q.notify({ type: 'positive', message: 'Settings saved', position: 'bottom-right' });
}

function openComsSettingsDashboard() {
  // DashboardPage derives its active tab from ?tab=<id> (it watches route.query.tab).
  // This used to push '/dashboard/privacy#coms-settings' — a route that does not
  // exist — and in the desktop build it opened that dead URL in a NEW window, so the
  // button looked like it did nothing at all.
  showComsSettingsDialog.value = false;
  void router.push({ path: '/dashboard', query: { tab: 'privacy' } });
}

function startReplyingToMessage(msg: VaultMsgView) {
  replyingTo.value = {
    id: msg.id,
    text: msg.text,
    isSender: msg.isSender,
  };
}

/**
 * Has the selected conversation's message list been read for this link yet?
 *
 * Deliberately does NOT require the vault to be initialized: the stored thread is
 * plain `ClientMessage` rows read straight out of IndexedDB by `loadMessages`,
 * with no key, no socket and no network involved. Gating this on
 * `vaultStore.isInitialized` made a locally-stored conversation wait on device
 * enrollment + a WebSocket handshake before it could be shown — a loader over
 * messages that were already on disk.
 *
 * The `messageLoadState` half stays: it is exactly "we have read this link's local
 * store", which is what distinguishes an empty conversation from an unread one (a
 * teardown clears both the message map and this flag, so nothing claims a chat is
 * empty before it has actually been read).
 */
const messagesReady = computed(() => {
  const id = selectedLink.value?.id;
  if (!id) return false;
  return vaultStore.messageLoadState[id] === 'ready';
});

const vaultMessages = computed<VaultMsgView[]>(() => {
  if (!selectedLink.value) return [];
  const msgs = vaultStore.messages[selectedLink.value.id] || [];
  const me = authStore.user?.id;
  // ROBUSTNESS: convert each stored message in isolation. One unreadable record
  // (corrupt envelope, odd plaintext) is skipped with a warning instead of
  // throwing out of this computed — a throw here blanks the entire conversation,
  // which is exactly the "chat goes empty" report.
  const views: VaultMsgView[] = [];
  for (const m of msgs) {
    try {
      const parsed = parseMessageEnvelope(m.plaintext);
      // Derive ownership from the stored sender id (resolved once at append
      // time) instead of trusting the per-account `isSender` flag, so messages
      // stay attributed to the correct user across account switches. Legacy
      // messages without a senderId fall back to the old flag.
      const isSender = m.senderId != null ? m.senderId === me : m.isSender;
      views.push({
        id: m.id,
        text: sanitizeText(typeof parsed?.text === 'string' ? parsed.text : ''),
        isSender,
        timestamp: Number.isFinite(m.timestamp) ? m.timestamp : Date.now(),
        isUnsafe: m.isUnsafe === true,
        replyTo: parsed?.replyTo ?? null,
        reactions: m.reactions ?? {},
        status: m.status ?? 'SENT',
        senderTimezone: parsed?.timezone,
      });
    } catch (err) {
      console.warn('[MessagingPage] Skipping unrenderable message', { id: m?.id, err });
    }
  }
  return views.sort(
    (a, b) => a.timestamp - b.timestamp || String(a.id).localeCompare(String(b.id)),
  );
});

function isVaultReplyToMe(message: VaultMsgView): boolean {
  if (message.isSender || !message.replyTo) return false;
  return vaultMessages.value.some(
    (candidate) => candidate.id === message.replyTo?.id && candidate.isSender,
  );
}

const draftMessage = ref('');
let draftRevision = 0;
watch([draftMessage, replyingTo], () => { ++draftRevision; }, { flush: 'sync' });

function conversationSnapshot() {
  const account = accountSnapshot();
  const link = selectedLink.value;
  if (!account.accountId || !link) return null;
  if (link.senderId !== account.accountId && link.receiverId !== account.accountId) return null;
  const recipientId = link.senderId === account.accountId ? link.receiverId : link.senderId;
  return { ...account, linkId: link.id, recipientId };
}
function currentConversation(snapshot: NonNullable<ReturnType<typeof conversationSnapshot>>): boolean {
  if (!currentAccount(snapshot) || selectedLink.value?.id !== snapshot.linkId) return false;
  const link = linksStore.links.find((item) => item.id === snapshot.linkId);
  if (!link || (link.senderId !== snapshot.accountId && link.receiverId !== snapshot.accountId)) return false;
  return (link.senderId === snapshot.accountId ? link.receiverId : link.senderId) === snapshot.recipientId &&
    (link.status === 'ESTABLISHED' || link.status === 'ANCHORED') &&
    (!link.expiresAt || new Date(link.expiresAt).getTime() > Date.now());
}
function recipientDevices(snapshot: NonNullable<ReturnType<typeof conversationSnapshot>>) {
  const link = linksStore.links.find((item) => item.id === snapshot.linkId);
  const partner = link?.senderId === snapshot.accountId ? link.receiver : link?.sender;
  return (partner?.devices ?? []).filter((device) => Boolean(device.id && device.devicePub)).map((device) => ({ ...device }));
}
watch(() => selectedLink.value?.id, () => {
  ++draftRevision;
  closeContextMenu();
  closeEmojiPicker();
  imagePreview.value.visible = false;
  videoPreview.value.visible = false;
}, { flush: 'sync' });
watch(() => [authStore.user?.id, authStore.authOperationGeneration] as const, (_next, previous) => {
  if (previous?.[0]) void purgeAttachmentAccount(previous[0]).catch(() => {});
  closeConversation();
  draftMessage.value = '';
}, { flush: 'sync' });
watch(() => vaultStore.sessionId, (_next, previous) => {
  if (previous && authStore.user?.id) void purgeAttachmentSession(authStore.user.id, previous).catch(() => {});
});
const linksFetchedAt = ref(0);
const messageInputRef = ref<{ focus: () => void; $el?: HTMLElement } | null>(null);

// Type for Quasar QScrollArea
interface QScrollArea {
  getScrollTarget?: () => Element | null;
}

const messagesScrollRef = ref<QScrollArea | null>(null);
const isAtBottom = ref(true);
const showJumpToLatest = ref(false);

// Declare at module level (BEFORE they are used in onMounted)
let timer: ReturnType<typeof setInterval> | null = null;
/** Started on mount; called from onUnmounted. */
let stopDeliveryPolling: (() => void) | null = null;
const deliveryPollTracker = new DeliveryPollTracker();
interface PageListener {
  target: 'window' | 'document';
  type: string;
  handler: (event: Event) => void;
  options?: AddEventListenerOptions;
}

/**
 * L11: every listener this page instance adds, with the exact handler it added.
 * Teardown walks this list, so a remount can never leave the previous
 * instance's focus/keydown/click listeners attached to window/document.
 * (The previous code kept the focus/blur/open-messaging handlers in
 * module-level `let`s, so a remount overwrote them and their listeners leaked;
 * the GIF-picker handler leaked its reference on window as
 * `__gifPickerClickHandler`.)
 */
const pageListeners: PageListener[] = [];
/** The QScrollArea's scroll element, kept so teardown can remove its listener. */
let pageScrollTarget: Element | null = null;
const onScrollTargetScroll = (): void => checkScrollPosition();
function listen(target: PageListener['target'], type: string, handler: (event: Event) => void, options?: AddEventListenerOptions) {
  const host = target === 'window' ? window : document;
  host.addEventListener(type, handler as EventListener, options);
  pageListeners.push({ target, type, handler, options });
}
function releasePageListeners() {
  for (const { target, type, handler, options } of pageListeners.splice(0)) {
    (target === 'window' ? window : document).removeEventListener(type, handler as EventListener, options);
  }
}

// How long the first group-surface load waits for a session's Vault enrollment to
// bind this device. Device enrollment is a challenge + signature + registration
// round trip; past this the page proceeds and the next refresh picks groups up.
const VAULT_ENROLLMENT_WAIT_MS = 10_000;

function preventDefaultContextMenu(e: MouseEvent) {
  e.preventDefault();
}

// Sanitize text to prevent encoding issues (WhatsApp unicode issue fix)
function sanitizeText(text: string): string {
  if (!text) return '';
  return messageText(text);
}

// ── Message Envelope ──────────────────────────────────────────────────────
// Messages are JSON envelopes: { v: 1, text: "...", replyTo?: { id, sender, text } }
// Legacy plaintext (non-JSON) is treated as v0 with no metadata.

interface MessageTimezone {
  name: string;
  offsetMinutes: number;
}

interface MessageEnvelope {
  text: string;
  replyTo?: { id: string; sender: string; text: string };
  clientMessageId?: string;
  timezone?: MessageTimezone;
}

function parseMessageEnvelope(plaintext: string): MessageEnvelope {
  if (!plaintext) return { text: '' };
  // Detect JSON envelope (starts with '{' and has 'v' key)
  if (plaintext.charAt(0) === '{') {
    try {
      const parsed = JSON.parse(plaintext);
      if (parsed && typeof parsed.v === 'number' && typeof parsed.text === 'string') {
        return {
          text: parsed.text,
          replyTo: parsed.replyTo || undefined,
          clientMessageId:
            typeof parsed.clientMessageId === 'string' ? parsed.clientMessageId : undefined,
          timezone:
            parsed.timezone &&
            typeof parsed.timezone.name === 'string' &&
            typeof parsed.timezone.offsetMinutes === 'number'
              ? parsed.timezone
              : undefined,
        };
      }
    } catch {
      // Not valid JSON — treat as plain text
    }
  }
  return { text: plaintext };
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `msg_${crypto.randomUUID()}`;
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const localTimezone = ref<MessageTimezone>(detectBrowserTimezone());

function detectBrowserTimezone(): MessageTimezone {
  return {
    name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    offsetMinutes: -new Date().getTimezoneOffset(),
  };
}

async function refreshDesktopTimezone() {
  localTimezone.value = detectBrowserTimezone();
  if (!window.__TAURI_INTERNALS__) return;

  try {
    const desktopTz = (await invoke('get_desktop_timezone')) as Partial<MessageTimezone> | null;
    if (
      desktopTz &&
      typeof desktopTz.name === 'string' &&
      typeof desktopTz.offsetMinutes === 'number'
    ) {
      localTimezone.value = {
        name: desktopTz.name || localTimezone.value.name,
        offsetMinutes: desktopTz.offsetMinutes,
      };
    }
  } catch (err) {
    console.debug('[MessagingPage] Desktop timezone detection fallback in use', err);
  }
}

function buildMessageEnvelope(
  text: string,
  replyTo?: { id: string; sender: string; text: string } | null,
  clientMessageId?: string,
): string {
  const envelope: Record<string, unknown> = { v: 1, text, timezone: localTimezone.value };
  if (clientMessageId) {
    envelope.clientMessageId = clientMessageId;
  }
  if (replyTo) {
    envelope.replyTo = {
      id: replyTo.id,
      sender: replyTo.sender,
      text: replyTo.text.slice(0, 100),
    };
  }
  return JSON.stringify(envelope);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

// ── Rich Content Rendering ────────────────────────────────────────────────

const IMAGE_RE = /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?/gi;
const VIDEO_RE = /https?:\/\/[^\s<>"']+\.(?:mp4|webm|mov|m4v)(?:\?[^\s<>"']*)?/gi;
const MEDIA_RE =
  /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)(?:\?[^\s<>"']*)?/gi;
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function extractImages(text: string): string[] {
  return [...text.matchAll(IMAGE_RE)].map((m) => normalizeMediaUrl(m[0]));
}

function extractVideos(text: string): string[] {
  return [...text.matchAll(VIDEO_RE)].map((m) => normalizeMediaUrl(m[0]));
}

function extractAllMedia(text: string): Set<string> {
  const media = new Set([...text.matchAll(MEDIA_RE)].map((m) => normalizeMediaUrl(m[0])));
  // Also include Tenor/Giphy URLs that get embedded as GIFs
  for (const m of text.matchAll(TENOR_RE)) media.add(normalizeMediaUrl(m[0]));
  for (const m of text.matchAll(GIPHY_RE)) media.add(normalizeMediaUrl(m[0]));
  return media;
}

// Tenor/Giphy GIF URL resolution
const TENOR_RE = /https?:\/\/(?:media\.)?tenor\.com\/(?:view\/[^\s]+|[a-zA-Z0-9_-]+-\d+)/gi;
const GIPHY_RE = /https?:\/\/(?:media\.)?giphy\.com\/(?:gifs|media)\/[^\s]+/gi;

function extractGifEmbeds(text: string): string[] {
  const gifs: string[] = [];
  // Tenor: convert share URLs to direct GIF media
  for (const m of text.matchAll(TENOR_RE)) {
    const url = m[0];
    // Tenor share URLs → use the Tenor GIF view URL as-is (browser resolves)
    // For direct embed, append .gif to get the media URL
    if (/\.gif$/i.test(url)) continue; // Already an image URL, handled by IMAGE_RE
    gifs.push(url + '.gif');
  }
  // Giphy: convert to direct GIF
  for (const m of text.matchAll(GIPHY_RE)) {
    const url = m[0];
    if (/\.gif$/i.test(url)) continue;
    // Extract the giphy ID from the URL
    const idMatch = url.match(/[-/]([a-zA-Z0-9]+)$/);
    if (idMatch) {
      gifs.push(`https://media.giphy.com/media/${idMatch[1]}/giphy.gif`);
    }
  }
  return gifs;
}

// ── Custom video player state ─────────────────────────────────────────────

interface VideoState {
  playing: boolean;
  muted: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  expanded: boolean;
}

const videoRefs = new Map<string, HTMLVideoElement>();
const videoStates = reactive<Record<string, VideoState>>({});

// Track GIF loading states
const gifLoadingStates = reactive<Record<string, boolean>>({});
const remoteMediaAllowed = reactive<Record<string, boolean>>({});

// ── Inline audio player state (Discord-style playback for audio attachments) ──
interface AudioState {
  playing: boolean;
  currentTime: number;
  duration: number;
  progress: number;
}

const audioRefs = new Map<string, HTMLAudioElement>();
const audioStates = reactive<Record<string, AudioState>>({});

/**
 * Vue calls a template ref callback with `null` when the element unmounts — and on
 * a chat switch that teardown happens AFTER `blobAttachmentsMap` has been recomputed,
 * so the key can no longer be resolved. Dereferencing it there threw
 * "TypeError: Cannot read properties of undefined (reading 'blobId')" once per audio
 * attachment on every chat switch. Accept a missing key and no-op instead.
 */
function registerAudioRef(key: string | undefined | null, el: HTMLAudioElement | null) {
  if (!key) return;
  if (el) {
    audioRefs.set(key, el);
    if (!audioStates[key]) {
      audioStates[key] = { playing: false, currentTime: 0, duration: 0, progress: 0 };
    }
  } else {
    audioRefs.delete(key);
  }
}

function toggleAudioPlayback(key: string) {
  const el = audioRefs.get(key);
  if (!el) return;
  // One clip at a time: pause every other player before starting this one.
  for (const [otherKey, other] of audioRefs) {
    if (otherKey !== key && !other.paused) {
      other.pause();
      if (audioStates[otherKey]) audioStates[otherKey].playing = false;
    }
  }
  if (el.paused) {
    void el.play().catch(() => {
      $q.notify({ type: 'negative', message: 'Cannot play this audio', timeout: 2500 });
      if (audioStates[key]) audioStates[key].playing = false;
    });
    if (audioStates[key]) audioStates[key].playing = true;
  } else {
    el.pause();
    if (audioStates[key]) audioStates[key].playing = false;
  }
}

function onAudioMeta(key: string, e: Event) {
  const el = e.target as HTMLAudioElement;
  if (audioStates[key] && Number.isFinite(el.duration)) audioStates[key].duration = el.duration;
}

function onAudioTime(key: string, e: Event) {
  const el = e.target as HTMLAudioElement;
  const s = audioStates[key];
  if (s && el.duration) {
    s.currentTime = el.currentTime;
    s.progress = (el.currentTime / el.duration) * 100;
  }
}

function onAudioEnded(key: string) {
  const s = audioStates[key];
  if (s) {
    s.playing = false;
    s.currentTime = 0;
    s.progress = 0;
  }
}

function seekAudio(key: string, e: MouseEvent) {
  const el = audioRefs.get(key);
  if (!el || !el.duration) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  el.currentTime = pct * el.duration;
}

// Parsed blob attachment per message id. The old template called
// getBlobAttachment(msg.text) — a full JSON.parse — six-plus times per message
// on every render of the thread; this parses once per change instead, and makes
// the attachment markup readable.
const blobAttachmentsMap = computed<Record<string, BlobAttachment>>(() => {
  const map: Record<string, BlobAttachment> = {};
  for (const m of vaultMessages.value) {
    try {
      const attachment = getBlobAttachment(m.text);
      if (attachment) map[m.id] = attachment;
    } catch (err) {
      // A malformed marker/JSON must degrade to "no attachment", not a blank thread.
      console.warn('[MessagingPage] blob attachment parse failed', { id: m?.id, err });
    }
  }
  return map;
});

// Maps of message id -> arrays of images / gifs to avoid calling extractor functions in template
//
// ROBUSTNESS: every per-message derivation is isolated. A single message whose
// text trips an extractor must contribute [] for itself — never throw out of the
// computed, because a throwing computed takes the whole message list (and so the
// whole conversation) down with it, which is the "chat renders empty" failure.
const imagesMap = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};
  for (const m of vaultMessages.value) {
    try {
      map[m.id] = extractImages(m.text) || [];
    } catch (err) {
      console.warn('[MessagingPage] extractImages failed for a message', { id: m?.id, err });
      map[m.id] = [];
    }
  }
  return map;
});

const gifsMap = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};
  for (const m of vaultMessages.value) {
    try {
      map[m.id] = extractGifEmbeds(m.text) || [];
    } catch (err) {
      console.warn('[MessagingPage] extractGifEmbeds failed for a message', { id: m?.id, err });
      map[m.id] = [];
    }
  }
  return map;
});

// Initialize gif loading states whenever gifsMap changes
watch(
  () => gifsMap.value,
  (newMap) => {
    for (const msgId of Object.keys(newMap)) {
      const arr = newMap[msgId] || [];
      arr.forEach((_, idx) => {
        const key = msgId + '-gif-' + idx;
        if (gifLoadingStates[key] === undefined) gifLoadingStates[key] = true;
      });
    }
  },
  { immediate: true },
);

// Prevent duplicate sends by locking while a send is in progress
const isSending = ref(false);

function registerVideoRef(key: string, el: HTMLVideoElement | null) {
  if (el) {
    videoRefs.set(key, el);
    if (!videoStates[key]) {
      videoStates[key] = {
        playing: false,
        muted: true,
        currentTime: 0,
        duration: 0,
        progress: 0,
        expanded: false,
      };
    }
  } else {
    videoRefs.delete(key);
  }
}

function toggleVideoPlay(key: string) {
  const el = videoRefs.get(key);
  if (!el) return;
  if (el.paused) {
    el.play();
    if (videoStates[key]) videoStates[key].playing = true;
  } else {
    el.pause();
    if (videoStates[key]) videoStates[key].playing = false;
  }
}

function toggleVideoMute(key: string) {
  const el = videoRefs.get(key);
  if (!el) return;
  el.muted = !el.muted;
  if (videoStates[key]) videoStates[key].muted = el.muted;
}

function toggleVideoExpand(key: string) {
  const el = videoRefs.get(key);
  const src = el?.currentSrc || el?.src;
  if (src && /^https?:\/\//i.test(src)) {
    videoPreview.value = { visible: true, url: src };
    return;
  }
  const s = videoStates[key];
  if (s) s.expanded = !s.expanded;
}

function openVideoPreview(url: string, filename?: string) {
  if (!/^https?:\/\//i.test(url) && !url.startsWith('blob:')) return;
  videoPreview.value = { visible: true, url, filename };
}

function onVideoMeta(key: string, e: Event) {
  const el = e.target as HTMLVideoElement;
  if (videoStates[key]) videoStates[key].duration = el.duration;
}

function onVideoTime(key: string, e: Event) {
  const el = e.target as HTMLVideoElement;
  const s = videoStates[key];
  if (s && el.duration) {
    s.currentTime = el.currentTime;
    s.progress = (el.currentTime / el.duration) * 100;
  }
}

function seekVideo(key: string, e: MouseEvent) {
  const el = videoRefs.get(key);
  if (!el || !el.duration) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  el.currentTime = pct * el.duration;
}

function formatVideoTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface LinkEmbed {
  url: string;
  hostname: string;
  path: string;
  favicon: string;
}

function extractLinkEmbeds(text: string): LinkEmbed[] {
  const media = extractAllMedia(text);
  const links: LinkEmbed[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (media.has(url)) continue; // skip media URLs — they're embedded inline
    try {
      const parsed = new URL(url);
      links.push({
        url,
        hostname: parsed.hostname,
        path: parsed.pathname.length > 1 ? parsed.pathname.slice(0, 50) : '',
        favicon: '', // Never disclose private message-link hosts to a favicon service.
      });
    } catch {
      links.push({ url, hostname: url.slice(0, 40), path: '', favicon: '' });
    }
  }
  return links;
}

/**
 * Render a message's text to sanitised HTML.
 *
 * This is a HARD BOUNDARY: markdown parsing and sanitisation run on arbitrary
 * (possibly hostile, possibly malformed) user text, and this function is called
 * straight from the render function. If anything in the pipeline throws, the
 * exception would escape the render and blank the whole conversation — so a
 * failure degrades to escaped plain text instead. A message must always render
 * as *something*.
 */
function renderMessageContent(text: string): string {
  const raw = typeof text === 'string' ? text : '';
  // Keep the visible part for the fallback (drop blob-attachment metadata).
  const markerIdx = raw.indexOf(':::VAULT_BLOB:::');
  const visible = markerIdx === -1 ? raw : raw.slice(0, markerIdx).trim();
  try {
    return renderMessageContentUnsafe(raw);
  } catch (err) {
    console.error(
      '[MessagingPage] renderMessageContent threw; falling back to escaped plain text',
      err,
    );
    try {
      return escapeHtml(visible);
    } catch {
      return '';
    }
  }
}

/**
 * Does this message have anything to draw INSIDE its bubble?
 *
 * The blob attachment is NOT in-bubble content — it renders as a SIBLING of the
 * bubble (`.vault-msg-body > .vault-msg-bubble + .vault-blob-attachment`). Counting
 * it as content here is what kept drawing a blank rounded rectangle next to every
 * attachment: the bubble itself had nothing in it (all four inner v-ifs false) but
 * stayed visible because the attachment existed. Four such bubbles were measured
 * on-device (26x18px, zero children).
 *
 * In-bubble content is: the rendered text, the remote-media consent button, or the
 * in-bubble image/gif/video once allowed. Defaults to TRUE if the check throws, so a
 * real message is never hidden.
 */
function hasBubbleContent(msg: VaultMsgView): boolean {
  try {
    if (msg.status?.startsWith('FAILED')) return true; // status badge lives in the bubble
    if (renderMessageContent(msg.text)) return true;
    if ((imagesMap.value[msg.id]?.length ?? 0) > 0) return true;
    if ((gifsMap.value[msg.id]?.length ?? 0) > 0) return true;
    if (extractVideos(msg.text).length > 0) return true;
    return false;
  } catch {
    return true;
  }
}

function renderMessageContentUnsafe(text: string): string {
  // Strip blob attachment metadata from visible text
  const blobMarkerIdx = text.indexOf(':::VAULT_BLOB:::');
  if (blobMarkerIdx !== -1) {
    // Parse FIRST, while the marker is still present.
    const parsedAttachment = getBlobAttachment(text);
    text = text.slice(0, blobMarkerIdx).trim();
    // The attachment UI renders the filename and size itself (media box, file row,
    // audio player), so the decorative "📎 **name** (12.3 KB)" line that
    // buildBlobMessageText bakes into the payload showed up as a redundant stray
    // line ABOVE every attachment. History can't be rewritten — the line lives
    // inside the encrypted payload — so drop exactly that line at render time.
    //
    // ONLY when the marker parsed into a renderable attachment: if the metadata is
    // unreadable there is no attachment bubble to carry the filename, and stripping
    // the line would leave the message rendering as NOTHING but the empty bubble
    // container (a blank rounded rectangle).
    if (parsedAttachment) {
      text = text.replace(/^\s*📎[^\n]*?\(\s*\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)\s*\)\s*/u, '').trim();
    }
  }

  // Temporarily replace markdown links to preserve them from media stripping.
  // NOTE: the token must contain NO markdown-significant characters. It used to
  // be `__MD_LINK_N__`, and double underscores are `<strong>` in GFM — so marked
  // destroyed the token, the restore below never matched, and the raw
  // `__MD_LINK_0__` leaked into the visible message. Plain alphanumerics survive
  // markdown untouched (same fix as the @mention token below).
  const markdownLinkMap: Record<string, string> = {};
  let markdownLinkIdx = 0;
  const mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  text = text.replace(mdLinkRe, (match) => {
    const key = `MDLINKTOKEN${markdownLinkIdx++}`;
    markdownLinkMap[key] = match;
    return key;
  });

  // Strip media URLs from the displayed text (they get embedded inline as images/videos)
  const media = extractAllMedia(text);
  let cleaned = text;
  for (const url of media) {
    // Only remove if it's not inside a markdown link placeholder
    if (!url.includes('__MD_LINK_')) {
      cleaned = cleaned.split(url).join('');
    }
  }
  // Collapse leftover whitespace from removed URLs
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  // Discord-style subtitle syntax: -# line text
  cleaned = cleaned.replace(
    /(^|\n)-#\s+(.+?)(?=\n|$)/g,
    '$1<small class="vault-subtext">$2</small>',
  );

  // Restore markdown links
  for (const [key, value] of Object.entries(markdownLinkMap)) {
    cleaned = cleaned.replaceAll(key, value);
  }

  if (!cleaned) return ''; // message was only a media URL

  // Mentions before markdown: temporarily replace @username with a placeholder to survive markdown parsing.
  // IMPORTANT: the placeholder must contain NO markdown-significant characters (no double underscores —
  // `__X__` is interpreted by marked/GFM as <strong>, which destroys the token so the later replaceAll
  // never matches and the user literally sees "MENTION"). Use a plain alphanumeric token instead.
  const mentionMap: Record<string, string> = {};
  let mentionIdx = 0;
  cleaned = cleaned.replace(/@([a-zA-Z0-9_]{1,30})/g, (_match, name) => {
    const key = `MENTIONTOKEN${mentionIdx++}`;
    mentionMap[key] = `<span class="vault-mention">@${escapeHtml(name)}</span>`;
    return key;
  });

  // Render markdown using marked (GFM enabled, no HTML passthrough)
  let html = markedInstance.parse(cleaned) as string;

  // OWASP: Sanitize with DOMPurify — only allow safe markup from markdown
  html = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      's',
      'code',
      'pre',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'sub',
      'sup',
      'hr',
      'small',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
  });

  // Restore mention placeholders
  for (const [key, value] of Object.entries(mentionMap)) {
    html = html.replaceAll(key, value);
  }

  // Force all links to open in new tab with noopener (belt + suspenders)
  html = html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openImagePreview(url: string, filename?: string) {
  // OWASP: Only allow http/https or local blob URLs for image preview
  if (!/^https?:\/\//i.test(url) && !url.startsWith('blob:')) return;
  imagePreview.value = { visible: true, url, zoom: 1, originX: 0, originY: 0, filename };
}

function onImageZoom(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  imagePreview.value.zoom = Math.max(0.25, Math.min(5, imagePreview.value.zoom + delta));
}

function onImageClick() {
  // Keep zoom anchored at center. Cursor-relative transform origins caused cumulative drift.
  imagePreview.value.zoom = Math.min(5, imagePreview.value.zoom + 0.5);
}

function resetImageZoom() {
  imagePreview.value.zoom = 1;
  imagePreview.value.originX = 0;
  imagePreview.value.originY = 0;
}

/** Save the image currently open in the lightbox (WhatsApp/Telegram "download"). */
const imagePreviewDownloading = ref(false);
const imagePreviewSaved = ref(false);

async function saveImagePreview() {
  if (!imagePreview.value.url) return;
  imagePreviewDownloading.value = true;
  try {
    const ok = await saveBlobObjectUrl(
      imagePreview.value.url,
      imagePreview.value.filename || `mourn-image-${Date.now()}`,
    );
    imagePreviewSaved.value = ok;
    if (ok) window.setTimeout(() => (imagePreviewSaved.value = false), 2500);
  } finally {
    imagePreviewDownloading.value = false;
  }
}

// ── Context Menu ──────────────────────────────────────────────────────────

function openContextMenu(e: MouseEvent, msg: VaultMsgView) {
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 250);
  contextMenu.value = {
    visible: true,
    x,
    y,
    msg: { id: msg.id, text: msg.text, isSender: msg.isSender, timestamp: msg.timestamp },
    mediaUrl: null,
    mediaType: null,
  };
}

function openMediaContextMenu(e: MouseEvent, url: string, type: 'image' | 'video') {
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  contextMenu.value = {
    visible: true,
    x,
    y,
    msg: null,
    mediaUrl: url,
    mediaType: type,
  };
}

function closeContextMenu() {
  contextMenu.value = { visible: false, x: 0, y: 0, msg: null, mediaUrl: null, mediaType: null };
}

function ctxReply() {
  if (!contextMenu.value.msg) return;
  const msg = contextMenu.value.msg;
  replyingTo.value = {
    id: msg.id,
    text: msg.text,
    isSender: msg.isSender,
  };
  closeContextMenu();
  messageInputRef.value?.focus();
}

async function ctxCopyText() {
  if (!contextMenu.value.msg) return;
  try {
    await navigator.clipboard.writeText(contextMenu.value.msg.text);
    $q.notify({ type: 'info', message: 'Copied to clipboard', timeout: 1500 });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to copy', timeout: 1500 });
  }
  closeContextMenu();
}

/**
 * Report a message.
 *
 * targetRef is the CONVERSATION id, not the individual message id: vault
 * messages are end-to-end encrypted, so the server has no plaintext to resolve a
 * message id against, and a locally-sent message may not even have a server id
 * yet. The thread id is a real server-side `Link`, which the backend resolves and
 * authorises. What the reviewer actually reads is the reporter-selected text
 * (`messageContent`), seeded here with the message that was right-clicked — the
 * composer then lets them add or drop messages via the thread picker.
 */
function ctxReport() {
  const msg = contextMenu.value.msg;
  const link = selectedLink.value;
  if (!msg || !link) return;

  const partner = link.senderId === myId.value ? link.receiver : link.sender;
  const label = partner?.username
    ? `Message in vault chat with @${partner.username}`
    : 'Vault chat message';

  closeContextMenu();
  void openTicketReport(router, {
    targetType: 'message',
    targetRef: link.id,
    label,
    messageContent: msg.text,
  });
}

/**
 * Report a whole conversation from the chat header's actions menu.
 *
 * Same contract as `ctxReport`: `targetRef` is the conversation (link) id,
 * because Vault messages are end-to-end encrypted and a locally-sent message
 * may not have a server id yet. No `messageContent` is seeded — the reporter
 * picks which messages the reviewer reads via the composer's thread picker.
 */
function reportCurrentConversation() {
  const link = selectedLink.value;
  if (!link) return;

  const partner = link.senderId === myId.value ? link.receiver : link.sender;
  const label = partner?.username ? `Conversation with @${partner.username}` : 'Vault conversation';

  void openTicketReport(router, {
    targetType: 'message',
    targetRef: link.id,
    label,
  });
}

function ctxDeleteForMe() {
  if (!contextMenu.value.msg || !selectedLink.value) return;
  const msgId = contextMenu.value.msg.id;
  const linkId = selectedLink.value.id;
  deleteMessageLocal(linkId, msgId);
  closeContextMenu();
}

async function ctxDeleteForEveryone() {
  const snapshot = conversationSnapshot();
  const msg = contextMenu.value.msg;
  if (!snapshot || !msg) return;
  const owned = vaultStore.messages[snapshot.linkId]?.find((item) => item.id === msg.id);
  if (owned?.senderId !== snapshot.accountId) return;
  closeContextMenu();
  try {
    await refreshLinks();
    if (!currentConversation(snapshot)) return;
    const devices = recipientDevices(snapshot);
    if (!devices.length) throw new Error('Partner has no active devices; deletion was not sent');
    await vaultStore.sendMessage(snapshot.linkId, snapshot.recipientId, devices,
      JSON.stringify({ v: 1, type: 'delete', targetId: msg.id }),
      { persistLocal: false, deleteTargetMessageId: msg.id });
    if (!currentAccount(snapshot)) return;
    await vaultStore.deleteMessageById(snapshot.linkId, msg.id);
    if (currentConversation(snapshot)) {
      $q.notify({ type: 'info', message: 'Deletion sent to partner devices', timeout: 2000 });
    }
  } catch (error) {
    if (currentAccount(snapshot)) handleSendError(error);
  }
}

function deleteMessageLocal(linkId: string, msgId: string) {
  const accountId = authStore.user?.id;
  if (accountId) void purgeAttachmentMessage(accountId, linkId, msgId).catch(() => {});
  void vaultStore.deleteMessageById(linkId, msgId);
}

function ctxRefresh() {
  closeContextMenu();
  if (selectedLink.value) {
    void vaultStore.loadMessages(selectedLink.value.id);
  }
}

// ── Media Context Menu Actions ────────────────────────────────────────────

function ctxOpenMediaLink() {
  if (!contextMenu.value.mediaUrl) return;
  window.open(contextMenu.value.mediaUrl, '_blank', 'noopener,noreferrer');
  closeContextMenu();
}

async function ctxCopyMediaLink() {
  if (!contextMenu.value.mediaUrl) return;
  try {
    await navigator.clipboard.writeText(contextMenu.value.mediaUrl);
    $q.notify({ type: 'info', message: 'Link copied', timeout: 1500 });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to copy', timeout: 1500 });
  }
  closeContextMenu();
}

async function ctxCopyImage() {
  if (!contextMenu.value.mediaUrl) return;
  try {
    const resp = await fetch(contextMenu.value.mediaUrl);
    const blob = await resp.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    $q.notify({ type: 'info', message: 'Image copied', timeout: 1500 });
  } catch {
    // Fallback: copy the URL instead
    try {
      await navigator.clipboard.writeText(contextMenu.value.mediaUrl);
      $q.notify({ type: 'info', message: 'Image URL copied', timeout: 1500 });
    } catch {
      $q.notify({ type: 'negative', message: 'Failed to copy', timeout: 1500 });
    }
  }
  closeContextMenu();
}

async function ctxSaveMedia() {
  if (!contextMenu.value.mediaUrl) return;
  const url = contextMenu.value.mediaUrl;
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const filename = url.split('/').pop()?.split('?')[0] || 'download';
    const ext = filename.split('.').pop() || '';

    // Tauri: use native save dialog
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: filename,
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
      });
      if (filePath) {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const arrayBuf = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuf));
        $q.notify({ type: 'info', message: 'Saved', timeout: 1500 });
      }
    } else {
      // Web fallback
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      $q.notify({ type: 'info', message: 'Download started', timeout: 1500 });
    }
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  closeContextMenu();
}

function scrollToMessage(msgId: string) {
  scrollToHighlightedMessage(messagesScrollRef.value as QScrollArea | null, msgId);
}

// ── Reaction System ───────────────────────────────────────────────────────

const discordEmojiUrl = messagingEmojiUrl;

const emojiPickerState = ref<{
  visible: boolean;
  msgId: string | null;
  x: number;
  y: number;
}>({ visible: false, msgId: null, x: 0, y: 0 });

const hoveredMsgId = ref<string | null>(null);

function openEmojiPicker(e: MouseEvent, msgId: string) {
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 260));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 300));
  emojiPickerState.value = { visible: true, msgId, x, y };
  // This popover opens exactly under the tap that requested it, so the same
  // tap's synthesized click would otherwise land on the first emoji cell and
  // fire a reaction nobody asked for. Arm the guard (see guardReactionPickerTap).
  reactionPickerOpenedAt.value = Date.now();
}

function closeEmojiPicker() {
  emojiPickerState.value = { visible: false, msgId: null, x: 0, y: 0 };
}

async function addReaction(msgId: string, emoji: string) {
  const snapshot = conversationSnapshot();
  if (!snapshot || !canExchangeMessages.value) return;
  const message = vaultStore.messages[snapshot.linkId]?.find((item) => item.id === msgId);
  if (!message) return;
  const remove = message.reactions?.[emoji]?.includes(snapshot.accountId) ?? false;
  try {
    await refreshLinks();
    if (!currentConversation(snapshot)) return;
    const devices = recipientDevices(snapshot);
    if (!devices.length) throw new Error('Partner has no active devices');
    await vaultStore.sendMessage(snapshot.linkId, snapshot.recipientId, devices,
      JSON.stringify({ v: 1, type: 'reaction', targetId: msgId, emoji, sender: snapshot.accountId, remove }),
      { persistLocal: false });
    if (!currentAccount(snapshot)) return;
    await vaultStore.toggleReaction(snapshot.linkId, msgId, emoji, snapshot.accountId, remove);
    if (currentConversation(snapshot)) closeEmojiPicker();
  } catch (error) {
    if (currentAccount(snapshot)) handleSendError(error);
  }
}

async function retryMessage(msgId: string) {
  const snapshot = conversationSnapshot();
  if (!snapshot) return;
  const original = vaultStore.messages[snapshot.linkId]?.find((m) => m.id === msgId);
  if (!original?.isSender) return;
  const plaintext = original.plaintext;
  try {
    await vaultStore.retryMessage(snapshot.linkId, msgId);
    if (!currentConversation(snapshot)) return;
    await refreshLinks();
    if (!currentConversation(snapshot)) return;
    const devices = recipientDevices(snapshot);
    if (!devices.length) throw new Error('Partner has no active devices');
    await vaultStore.sendMessage(snapshot.linkId, snapshot.recipientId, devices, plaintext, { persistLocal: false, localMessageId: msgId });
  } catch (error) { if (currentAccount(snapshot)) handleSendError(error); }
}

async function deleteLocalMessage(msgId: string) {
  if (!selectedLink.value) return;
  const linkId = selectedLink.value.id;
  await vaultStore.deleteLocalMessage(linkId, msgId);
  $q.notify({ type: 'info', message: 'Message deleted' });
}

// ── File Attachment System (P2P WebRTC) ──────────────────────────────────

const fileInputRef = ref<HTMLInputElement | null>(null);

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function triggerFileInput() {
  fileInputRef.value?.click();
}

/** (⋮) on the messaging tab row — Discover + Com settings, plus whatever is added
 *  next. Replaces the old brand row that used to sit above the tabs. */
const navMenuOpen = ref(false);

function openComsSettingsFromNav() {
  navMenuOpen.value = false;
  openComsSettings();
}

/** (+) menu on the chat-filter row: New Chat / New Suite / Find people. */
const newMenuOpen = ref(false);

function onNewMenuAction(action: 'chat' | 'suite' | 'find') {
  newMenuOpen.value = false;
  if (action === 'chat') openNewChat();
  else if (action === 'suite') openCreateSuite();
  else openSearch();
}

// ── New Chat dialog ──────────────────────────────────────────────────────
const newChatOpen = ref(false);
const newChatQuery = ref('');
const newChatLoading = ref(false);
const newChatSendingId = ref<string | null>(null);

/** Results only once the query is meaningful — mirrors the Discover gate. */
const newChatResults = computed(() =>
  newChatQuery.value.trim().length >= 1 ? linksStore.searchResults : [],
);

function openNewChat() {
  newChatQuery.value = '';
  linksStore.searchResults = [];
  newChatOpen.value = true;
}

async function onNewChatSearch(value: string | number | null) {
  newChatQuery.value = String(value ?? '');
  if (newChatQuery.value.trim().length < 1) {
    linksStore.searchResults = [];
    return;
  }
  newChatLoading.value = true;
  try {
    await linksStore.searchUsers(newChatQuery.value);
  } finally {
    newChatLoading.value = false;
  }
}

/** An existing link with this user, in either direction, if there is one. */
function existingLinkFor(userId: string) {
  return linksStore.links.find((l) => l.senderId === userId || l.receiverId === userId);
}

function goToChatWith(userId: string) {
  const link = existingLinkFor(userId);
  if (!link) return;
  newChatOpen.value = false;
  void openChat(link);
}

async function sendLinkTo(userId: string) {
  newChatSendingId.value = userId;
  try {
    await linksStore.requestLink(userId);
    await linksStore.fetchLinks();
    $q.notify({ type: 'positive', message: 'Link request sent', position: 'bottom-right' });
  } catch (err: unknown) {
    $q.notify({
      type: 'negative',
      message: (err as Error).message || 'Could not send link request',
      position: 'bottom-right',
    });
  } finally {
    newChatSendingId.value = null;
  }
}

/** Height (px) the picker panel takes when it swaps in for the keyboard. Measured
 *  from the live keyboard so the composer does NOT move: with the keyboard up the
 *  composer sits on top of it, and a panel of the same height leaves it at exactly
 *  the same Y. Falls back to ~42% of the window when no keyboard was up. */
const pickerPanelHeight = ref(0);

/** How tall the soft keyboard currently is, 0 when it is not showing. */
function currentKeyboardHeight(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height));
}

/**
 * The emoji/GIF panel takes the keyboard's place: opening it dismisses the soft
 * keyboard, resizes the panel to the keyboard's exact height (so the composer
 * stays put), and closing it brings the keyboard straight back.
 *
 * The field genuinely cannot keep DOM focus while the keyboard is dismissed —
 * there is no way to hide the IME without blurring on Android. So the field is
 * given the same *look* as focused (see `.is-picker-open`) and the emoji button
 * turns into a keyboard button; tapping either one restores the real focus.
 */
function toggleEmojiPicker() {
  const willOpen = !showEmojiPicker.value;
  showGifPicker.value = false;
  if (willOpen) {
    const kb = currentKeyboardHeight();
    pickerPanelHeight.value = kb > 120 ? kb : Math.round(window.innerHeight * 0.42);
    showEmojiPicker.value = true;
    pickerOpenedAt.value = Date.now();
    (document.activeElement as HTMLElement | null)?.blur?.();
  } else {
    showEmojiPicker.value = false;
    void nextTick(() => messageInputRef.value?.focus());
  }
}

/**
 * Tap-through guard for the composer picker.
 *
 * The emoji/GIF toggle fires on `pointerdown` (Android eats the first tap that
 * dismisses the IME, so a plain click never arrived). Opening the panel then
 * shifts the layout — the panel takes the keyboard's place and the composer
 * jumps up — and the *synthesized click* from that very same tap is hit-tested
 * against the NEW layout, landing on an emoji cell in the just-opened panel and
 * inserting a random emoji (the "tapping the panel inserts the graveyard 🪦"
 * report). Any click inside this window is swallowed so only a genuine,
 * deliberate tap can insert. 450ms covers Android's ~300ms ghost-click window.
 */
const PICKER_TAP_GUARD_MS = 450;
const pickerOpenedAt = ref(0);
const reactionPickerOpenedAt = ref(0);

function guardPickerTap(event: MouseEvent) {
  if (Date.now() - pickerOpenedAt.value < PICKER_TAP_GUARD_MS) {
    event.stopPropagation();
    event.preventDefault();
  }
}

function guardReactionPickerTap(event: MouseEvent) {
  if (Date.now() - reactionPickerOpenedAt.value < PICKER_TAP_GUARD_MS) {
    event.stopPropagation();
    event.preventDefault();
  }
}

/** GIF browser toggle (mobile surfaces it as a tab inside the unified picker). */
function toggleGifPicker() {
  const willOpen = !showGifPicker.value;
  showEmojiPicker.value = false;
  showGifPicker.value = willOpen;
  if (willOpen) {
    pickerOpenedAt.value = Date.now();
  }
}

/** Emoji button doubles as the keyboard switch while the panel is open. */
const emojiBtnIcon = computed(() =>
  showEmojiPicker.value ? 'mdi-keyboard-outline' : 'mdi-emoticon-happy-outline',
);

/** Mobile attach sheet (camera / gallery / audio / file). Desktop goes straight to the picker. */
const attachMenuOpen = ref(false);
const audioInputRef = ref<HTMLInputElement | null>(null);

/**
 * The sheet's items must call .click() SYNCHRONOUSLY — Android's WebView only opens
 * a file chooser while the user-gesture window is still open, so awaiting anything
 * first silently swallows the dialog and the button looks dead.
 */
function pickFile() {
  attachMenuOpen.value = false;
  fileInputRef.value?.click();
}

function pickAudio() {
  attachMenuOpen.value = false;
  audioInputRef.value?.click();
}

function onAttachClick() {
  if (!isMobile.value) {
    triggerFileInput();
    return;
  }
  attachMenuOpen.value = true;
}

/**
 * Take a photo with the system camera (or pick one from the library) and push it
 * straight through the normal encrypted-attachment pipeline. Null = cancelled /
 * unsupported, which is not an error.
 */
async function pickPhoto(source: 'camera' | 'photos') {
  const shot = await capturePhoto(source);
  if (!shot) return;
  await sendVaultFiles([new File([shot.blob], shot.filename, { type: shot.mimetype })]);
}

// ── Paste + drag-and-drop attachments ───────────────────────────────────
// Both routes funnel into sendVaultFiles(), the exact pipeline the (+)
// picker uses, so there is only one upload/announce path to keep secure.

/** Files may only be attached while the composer itself accepts messages. */
const canAttachFiles = computed(() => Boolean(selectedLink.value) && !isSendBlocked.value);

/** True while a file drag is hovering the conversation pane. */
const dragActive = ref(false);

function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function onChatDragEnter(event: DragEvent) {
  if (!canAttachFiles.value || !dragHasFiles(event)) return;
  dragActive.value = true;
}

function onChatDragOver(event: DragEvent) {
  if (!canAttachFiles.value || !dragHasFiles(event)) return;
  // Signal a copy, and keep the overlay alive across child-element transitions.
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dragActive.value = true;
}

function onChatDragLeave(event: DragEvent) {
  const root = event.currentTarget as HTMLElement | null;
  const next = event.relatedTarget as Node | null;
  if (root && next && root.contains(next)) return; // still inside the pane
  dragActive.value = false;
}

function onChatDrop(event: DragEvent) {
  dragActive.value = false;
  if (!canAttachFiles.value) return;
  void sendVaultFiles(Array.from(event.dataTransfer?.files ?? []));
}

/** Ctrl+V in the composer: only file/image clipboard content is intercepted. */
function onComposerPaste(event: ClipboardEvent) {
  if (!canAttachFiles.value) return;
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (files.length === 0) return; // plain-text paste — let the composer handle it
  event.preventDefault();
  void sendVaultFiles(files);
}

// ── Blob attachment helpers ─────────────────────────────────────────────

function isBlobImage(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('image/'));
}

function isBlobVideo(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('video/'));
}

function isBlobAudio(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('audio/'));
}


async function ensureBlobPreview(text: string) {
  await ensurePreview(parseBlobAttachment(text));
}

function getBlobAttachment(text: string): BlobAttachment | null {
  return parseBlobAttachmentSync(text);
}

function parseBlobAttachmentSync(plaintext: string): BlobAttachment | null {
  return parseBlobAttachment(plaintext);
}

async function downloadBlobAttachment(text: string) {
  await saveAttachment(parseBlobAttachment(text));
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // Reset so same file can be picked again
  await sendVaultFiles(files);
}

/** Name for a clipboard/dropped file that carries none (e.g. a pasted bitmap). */
function attachmentFileName(file: File): string {
  if (file.name) return file.name;
  const subtype = (file.type.split('/')[1] || 'bin').split('+')[0];
  return `pasted-${Date.now()}.${subtype}`;
}

/**
 * Attachment pipeline shared by the (+) picker, Ctrl+V paste and drag-and-drop.
 * Every file is encrypted on this device before it leaves, then announced as an
 * E2EE vault message carrying its blob id + key (unchanged 1:1 relay contract).
 */
async function sendVaultFiles(picked: File[]) {
  const snapshot = conversationSnapshot();
  if (!snapshot || !canExchangeMessages.value || !picked.length) return;
  const files = picked.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
  if (files.length !== picked.length) $q.notify({ type: "negative", message: "Maximum attachment size is 100 MB" });
  const randomize = dashboardStore.randomizeFileNames;
  try {
    await vaultStore.initialize();
    if (!currentConversation(snapshot)) return;
    await refreshLinks();
    if (!currentConversation(snapshot)) return;
    await authStore.fetchCsrfToken();
    if (!currentConversation(snapshot)) return;
    const csrf = authStore.csrfToken;
    const devices = recipientDevices(snapshot);
    if (!csrf || !devices.length) throw new Error("Upload authorization unavailable");
    for (const file of files) {
      if (!currentConversation(snapshot)) return;
      const name = resolveUploadFileName(attachmentFileName(file), randomize);
      const upload = name !== file.name ? new File([file], name, { type: file.type }) : file;
      const attachment = await encryptAndUploadBlob(upload, { kind: "link", id: snapshot.linkId }, csrf, resolveApiUrl(""), { displayFilename: name });
      if (!currentConversation(snapshot)) return;
      const id = createClientMessageId();
      const envelope = buildMessageEnvelope(buildBlobMessageText(attachment), null, id);
      await vaultStore.sendMessage(snapshot.linkId, snapshot.recipientId, devices, envelope, { persistLocal: true, localMessageId: id });
      if (!currentConversation(snapshot)) return;
      const context = vaultAttachmentContext(attachment, id, Date.now());
      if (context) await cacheAttachmentBlob(attachment.blobId, upload, attachment, context);
      if (currentConversation(snapshot)) pinToBottom();
    }
  } catch (error) { if (currentAccount(snapshot)) handleSendError(error); }
}

const activeTransfers = computed(() => Object.values(blobTransfers));

function removeTransfer(transferId: string) {
  delete blobTransfers[transferId];
}

// ── GIF Browser (Tenor) ─────────────────────────────────────────────────

const showGifPicker = ref(false);
const gifSearchQuery = ref('');
const gifResults = ref<{ id: string; preview: string; url: string }[]>([]);
const gifLoading = ref(false);

// ── Emoji Picker (composer) ─────────────────────────────────────────────
const showEmojiPicker = ref(false);
/**
 * Active tab of the unified composer picker. Only the MOBILE composer exposes
 * the tab bar (emoji | GIF); on desktop the tabs are hidden and this stays
 * 'emoji', so the desktop picker behaves exactly as before.
 */
const pickerTab = ref<'emoji' | 'gif'>('emoji');

function switchPickerTab(tab: 'emoji' | 'gif') {
  pickerTab.value = tab;
  if (tab === 'gif' && gifResults.value.length === 0) {
    gifSearchQuery.value = '';
    void searchGifs();
  }
}

// ── Emoji picker: categories, recents and search (Telegram-shaped panel) ────
const EMOJI_RECENTS_KEY = 'mourn_emoji_recents';
const EMOJI_RECENTS_MAX = 24;

const emojiSearchQuery = ref('');
const emojiCategory = ref<'recent' | 'quick' | 'all'>('all');
const emojiRecents = ref<string[]>([]);

const EMOJI_CATEGORIES = [
  { key: 'recent', label: 'Recently used', icon: '\u{1F550}' },
  { key: 'quick', label: 'Quick reactions', icon: '\u{26A1}' },
  { key: 'all', label: 'All emoji', icon: '\u{1F600}' },
] as const;

function loadEmojiRecents() {
  try {
    const raw = localStorage.getItem(EMOJI_RECENTS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        emojiRecents.value = parsed.filter((e): e is string => typeof e === 'string');
      }
    }
  } catch {
    emojiRecents.value = [];
  }
}

/** Recency list, most-recent-first, deduped and capped. */
function rememberEmoji(emoji: string) {
  const next = [emoji, ...emojiRecents.value.filter((e) => e !== emoji)].slice(0, EMOJI_RECENTS_MAX);
  emojiRecents.value = next;
  try {
    localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — recents are a nicety, never fatal */
  }
}

/** A search query overrides the category; otherwise the active category shows. */
const visibleEmojis = computed<string[]>(() => {
  const q = emojiSearchQuery.value.trim();
  if (q) return ALL_EMOJIS.filter((e) => e.includes(q));
  if (emojiCategory.value === 'recent') return emojiRecents.value;
  if (emojiCategory.value === 'quick') return [...QUICK_EMOJIS];
  return [...ALL_EMOJIS];
});

/** One search field for both tabs: it edits whichever query the active tab uses,
 *  so switching tabs keeps a single search row (like Telegram's panel). */
const pickerSearchQuery = computed({
  get: () => (pickerTab.value === 'gif' ? gifSearchQuery.value : emojiSearchQuery.value),
  set: (value: string) => {
    if (pickerTab.value === 'gif') {
      gifSearchQuery.value = value;
      void searchGifs();
    } else {
      emojiSearchQuery.value = value;
    }
  },
});

const emojiSectionLabel = computed(() => {
  if (emojiSearchQuery.value.trim()) return 'Search results';
  if (emojiCategory.value === 'recent' && emojiRecents.value.length === 0) return 'No recents yet';
  return EMOJI_CATEGORIES.find((c) => c.key === emojiCategory.value)?.label ?? 'Emoji';
});

onMounted(loadEmojiRecents);

/** Append an emoji to the composer draft at the cursor (or the end). */
function insertEmoji(emoji: string) {
  rememberEmoji(emoji);
  // While the panel is open the field stays blurred on purpose; refocusing here
  // would yank the keyboard back over the panel after every single emoji.
  const pickerWasOpen = showEmojiPicker.value;
  const el = messageInputRef.value?.$el as HTMLTextAreaElement | undefined;
  const textarea = el?.querySelector('textarea');
  if (textarea) {
    const start = textarea.selectionStart ?? draftMessage.value.length;
    const end = textarea.selectionEnd ?? start;
    draftMessage.value = draftMessage.value.slice(0, start) + emoji + draftMessage.value.slice(end);
    // Focus back and restore the caret just after the inserted emoji — but only
    // when the panel is closed. While the panel owns the keyboard's place, pulling
    // focus back would pop the keyboard up over the panel on every emoji tap.
    requestAnimationFrame(() => {
      if (pickerWasOpen) {
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
        return;
      }
      textarea.focus();
      const pos = start + emoji.length;
      textarea.setSelectionRange(pos, pos);
    });
  } else {
    draftMessage.value += emoji;
  }
}

const KLIPY_API_KEY = import.meta.env.VITE_KLIPY_API_KEY || '';

async function searchGifs(query?: string | number | null) {
  const q = typeof query === 'string' ? query.trim() : gifSearchQuery.value.trim();
  gifLoading.value = true;
  try {
    const endpoint = q
      ? `https://api.klipy.com/v2/search?q=${encodeURIComponent(q)}&key=${KLIPY_API_KEY}&client_key=mourn&limit=30&media_filter=tinygif,gif`
      : `https://api.klipy.com/v2/featured?key=${KLIPY_API_KEY}&client_key=mourn&limit=30&media_filter=tinygif,gif`;

    const resp = await fetch(endpoint);
    const data = await resp.json();

    gifResults.value = (data.results || []).map((r: Record<string, unknown>) => {
      const media = r.media_formats as Record<string, { url: string }> | undefined;
      return {
        id: r.id as string,
        preview: media?.tinygif?.url || media?.gif?.url || '',
        url: media?.gif?.url || '',
      };
    });
  } catch (err) {
    console.error('[GIF] Fetch failed', err);
    gifResults.value = [];
  } finally {
    gifLoading.value = false;
  }
}

async function sendGif(gifUrl: string) {
  if (!gifUrl || !selectedLink.value) return;

  showGifPicker.value = false;
  showEmojiPicker.value = false;
  draftMessage.value = gifUrl;
  await sendVaultMessage();
}

// Load trending GIFs when picker opens (either the standalone desktop GIF
// button or the GIF tab of the unified picker).
watch(showGifPicker, (open) => {
  if (!open) return;
  pickerTab.value = 'gif';
  if (gifResults.value.length === 0) {
    gifSearchQuery.value = '';
    void searchGifs();
  }
});

// ── Textarea key handling (Enter to send, Shift+Enter for newline) ──────

function onInputKeydown(e: KeyboardEvent) {
  if (isSendEnter(e)) {
    e.preventDefault();
    void sendVaultMessage();
  }
}

// ── Message Search (WhatsApp-style) ───────────────────────────────────

function enterSearchMode() {
  messageSearchMode.value = true;
  messageSearchQuery.value = '';
  searchResults.value = [];
  searchCurrentIndex.value = 0;
  nextTick(() => {
    // Focus the search input when entering search mode
    const input = document.querySelector('.vault-search-input input') as HTMLInputElement;
    if (input) input.focus();
  });
}

function exitSearchMode() {
  messageSearchMode.value = false;
  messageSearchQuery.value = '';
  searchResults.value = [];
  searchCurrentIndex.value = 0;
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!messageSearchMode.value) return;

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    navigateSearchPrev();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    navigateSearchNext();
  }
}

function performMessageSearch() {
  const query = messageSearchQuery.value.toLowerCase().trim();
  if (!query || !selectedLink.value) {
    searchResults.value = [];
    searchCurrentIndex.value = 0;
    return;
  }

  searchResults.value = vaultMessages.value.filter((msg) => msg.text.toLowerCase().includes(query));
  searchCurrentIndex.value = 0;

  if (searchResults.value.length > 0) {
    scrollToSearchResult();
  }
}

function navigateSearchNext() {
  if (searchResults.value.length === 0) return;
  searchCurrentIndex.value = (searchCurrentIndex.value + 1) % searchResults.value.length;
  scrollToSearchResult();
}

function navigateSearchPrev() {
  if (searchResults.value.length === 0) return;
  searchCurrentIndex.value =
    searchCurrentIndex.value === 0 ? searchResults.value.length - 1 : searchCurrentIndex.value - 1;
  scrollToSearchResult();
}

function scrollToSearchResult() {
  if (searchResults.value.length === 0) return;
  const message = searchResults.value[searchCurrentIndex.value];
  if (message)
    scrollToHighlightedMessage(messagesScrollRef.value as QScrollArea | null, message.id);
}

async function refreshLinks(options: { silent?: boolean } = { silent: true }) {
  const account = accountSnapshot();
  await authStore.checkSession();
  if (!currentAccount(account)) return;
  await linksStore.fetchLinks({ silent: options.silent });
  if (!currentAccount(account)) return;
  syncSelectedLinkFromStore();
  linksFetchedAt.value = Date.now();
}

async function sendVaultMessage() {
  if (isSending.value) return;
  if (linksStore.offline) {
    $q.notify({
      type: 'warning',
      message: 'Offline mode — messaging is disabled until you reconnect.',
      timeout: 2500,
    });
    return;
  }
  syncSelectedLinkFromStore();
  const snapshot = conversationSnapshot();
  const pendingDraft = draftMessage.value;
  const pendingReply = replyingTo.value;
  const text = sanitizeText(pendingDraft);
  if (!snapshot || !text) return;
  if (!currentConversation(snapshot) || isChatUnavailable.value) {
    $q.notify({ type: 'warning', message: 'Messaging is unavailable for this link.', timeout: 2500 });
    return;
  }
  if (text.length > 16_384) {
    $q.notify({ type: 'negative', message: 'Message exceeds Limit. Not cool.' });
    return;
  }
  if (isRateLimited.value) {
    $q.notify({ type: 'negative', message: 'Not cool, slow down.' });
    return;
  }
  const reply = pendingReply
    ? {
        id: pendingReply.id,
        sender: pendingReply.isSender ? myUsername.value : partnerUsername.value,
        text: pendingReply.text,
      }
    : null;
  const id = createClientMessageId();
  const envelope = buildMessageEnvelope(text, reply, id);

  // Lock before initialization so Enter and click cannot submit the same draft twice.
  // Clear immediately, but restore pre-send failures only into the untouched composer.
  isSending.value = true;
  draftMessage.value = '';
  replyingTo.value = null;
  const clearedRevision = draftRevision;
  let dispatched = false;
  pinToBottom();
  void hapticSuccess();
  try {
    await vaultStore.initialize();
    if (!currentConversation(snapshot) || linksStore.offline || isChatUnavailable.value) return;
    const devices = recipientDevices(snapshot);
    if (!devices.length) throw new Error('Partner has no active devices');
    dispatched = true;
    await vaultStore.sendMessage(snapshot.linkId, snapshot.recipientId, devices, envelope, {
      persistLocal: true,
      localMessageId: id,
    });
    if (!currentConversation(snapshot)) return;
    pinToBottom();
    if (isMobile.value) {
      void nextTick(() => {
        if (currentConversation(snapshot)) messageInputRef.value?.focus?.();
      });
    }
  } catch (error) {
    if (currentAccount(snapshot)) {
      // Store validation/transport setup can reject before creating a retryable row.
      if (!vaultStore.messages[snapshot.linkId]?.some((message) => message.id === id)) {
        dispatched = false;
      }
      handleSendError(error);
    }
  } finally {
    // Once persisted, failure/retry belongs to the message bubble.
    if (!dispatched && currentConversation(snapshot) && draftRevision === clearedRevision) {
      draftMessage.value = pendingDraft;
      replyingTo.value = pendingReply;
    }
    isSending.value = false;
  }
}

function handleSendError(err: unknown) {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'MESSAGE_TOO_LONG') {
    $q.notify({ type: 'negative', message: 'Message exceeds Limit. Not cool.' });
    return;
  }
  if (msg === 'RATE_LIMIT') {
    $q.notify({ type: 'negative', message: 'Not cool, slow down.' });
    return;
  }
  if (msg === 'LINK_COMPROMISED') {
    $q.notify({
      type: 'negative',
      message: 'SECURITY: Device identity changed. Use Take Action to override.',
      timeout: 5000,
    });
    return;
  }
  if (msg === 'NO_PARTNER_DEVICES') {
    $q.notify({ type: 'warning', message: 'Partner has zero active vault devices' });
    return;
  }
  if (msg === 'connect_failed' || msg === 'TRANSPORT_CONNECT_FAIL') {
    $q.notify({ type: 'negative', message: 'Connection failed. Secure channel not ready.' });
    return;
  }
  console.error('Failed to send message', err);
  $q.notify({ type: 'negative', message: 'Unable to send � secure channel not ready' });
}
const respondingId = ref<string | null>(null);
const cancellingLinkId = ref<string | null>(null);
const cancellingGroupId = ref<string | null>(null);
const anchoringId = ref<string | null>(null);
const now = ref(Date.now());

//  Resizable sidebar
const SIDEBAR_MIN = 240;
const SIDEBAR_DEFAULT = 300;
const sidebarWidth = ref(SIDEBAR_DEFAULT);

let isResizing = false;
let resizeStartX = 0;
let resizeStartWidth = 0;

function startResize(e: MouseEvent) {
  isResizing = true;
  resizeStartX = e.clientX;
  resizeStartWidth = sidebarWidth.value;
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', stopResize);
}

function onResizeMove(e: MouseEvent) {
  if (!isResizing) return;
  const delta = e.clientX - resizeStartX;
  const maxWidth = Math.floor(window.innerWidth * 0.5);
  sidebarWidth.value = Math.max(SIDEBAR_MIN, Math.min(maxWidth, resizeStartWidth + delta));
}

function stopResize() {
  isResizing = false;
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', stopResize);
}

// Scroll detection and management
function checkScrollPosition() {
  if (!messagesScrollRef.value) return;
  const scrollArea = messagesScrollRef.value as QScrollArea;
  if (!scrollArea.getScrollTarget) return;

  const target = scrollArea.getScrollTarget();
  if (!target) return;

  const maxScroll = target.scrollHeight - target.clientHeight;
  const currentScroll = target.scrollTop;
  const offset = maxScroll - currentScroll;

  // Consider "at bottom" if within 100px of the end
  isAtBottom.value = offset < 100;
  showJumpToLatest.value = offset > 200; // Show button if >200px away
}

// Auto-scroll to latest message
function scrollToLatest() {
  if (!messagesScrollRef.value) return;
  const scrollArea = messagesScrollRef.value as QScrollArea;
  if (!scrollArea.getScrollTarget) return;

  const target = scrollArea.getScrollTarget();
  if (!target) return;

  target.scrollTop = target.scrollHeight;
  isAtBottom.value = true;
  showJumpToLatest.value = false;
}

/**
 * Pin the thread to the newest message. Called after WE send something (text,
 * GIF or media) so the just-sent bubble can never land below the fold. Media
 * previews (image / video / audio) decrypt asynchronously, so the content keeps
 * growing after the first paint — re-pin on the next animation frame too.
 */
function pinToBottom() {
  isAtBottom.value = true;
  void nextTick(() => {
    scrollToLatest();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => scrollToLatest());
    }
  });
}

/**
 * While the user is parked at the bottom, keep them there as the list grows
 * (media previews finishing their decrypt, keyboard-driven resize, etc.). This
 * is what stops a late-arriving image from pushing the newest bubble off screen.
 */
let scrollResizeObserver: ResizeObserver | null = null;
let observedListEl: HTMLElement | null = null;
const messageListRef = ref<HTMLElement | null>(null);

function observeMessageList() {
  if (typeof ResizeObserver === 'undefined') return;
  const el = messageListRef.value;
  // The list element only exists once the thread has messages, and it is reused
  // as the thread grows — re-observing the same node on every message is a
  // no-op that would just churn the observer.
  if (!el || el === observedListEl) return;
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = new ResizeObserver(() => {
    if (isAtBottom.value) scrollToLatest();
  });
  scrollResizeObserver.observe(el);
  observedListEl = el;
}

function stopObservingMessageList() {
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  observedListEl = null;
}

function warmBlobAttachmentCacheForMessages(messages: VaultMsgView[]) {
  for (const msg of messages) {
    const attachment = getBlobAttachment(msg.text);
    if (!attachment) continue;
    if (
      !isBlobImage(attachment.mimetype) &&
      !isBlobVideo(attachment.mimetype) &&
      !isBlobAudio(attachment.mimetype)
    ) {
      continue;
    }
    void ensureBlobPreview(msg.text);
  }
}

// Watch for new messages. A message WE just sent always pins to the bottom
// (that is the "renders empty, then populates without scrolling" fix); an
// incoming message only auto-scrolls when the user was already at the bottom.
const stopWatchMessages = watch(
  () => vaultMessages.value.length,
  async (newLength: number, oldLength: number) => {
    // Defer scroll to next tick to allow DOM to update
    await nextTick();
    observeMessageList();
    const last = vaultMessages.value[vaultMessages.value.length - 1];
    if (newLength > oldLength && last?.isSender) {
      pinToBottom();
      return;
    }
    if (isAtBottom.value) {
      scrollToLatest();
    } else {
      checkScrollPosition();
    }
  },
);

const stopWarmBlobCache = watch(
  () => vaultMessages.value.map((msg) => `${msg.id}:${getBlobAttachment(msg.text)?.blobId ?? ''}`),
  () => warmBlobAttachmentCacheForMessages(vaultMessages.value),
  { immediate: true },
);

async function processPersistedGroupNotifications(): Promise<void> {
  for (const notification of notificationsStore.notifications.filter((item) => !item.isRead)) {
    const kind =
      typeof notification.data?.kind === 'string' ? notification.data.kind : notification.type;
    const groupId = typeof notification.data?.groupId === 'string' ? notification.data.groupId : '';
    if (!groupId) continue;

    if (kind === 'GROUP_JOIN_ACCEPTED') {
      const published = await groupStore.publishMlsKeyPackageForGroup(groupId);
      if (!published) continue;
      await groupStore.handleGroupNotification(notification);
      await notificationsStore.markAsRead(notification.id);
    } else if (kind === 'GROUP_JOIN_REJECTED' || kind === 'GROUP_MEMBER_REMOVED') {
      await groupStore.handleGroupNotification(notification);
    }
  }
}

onMounted(async () => {
  // Authorized offline mode (krul 2026-08): desktop + authenticated + stay-logged-in.
  {
    const { isOfflineModeAuthorized } = await import('src/crypto/offlineVault');
    offlineAuthorized.value = (await isOfflineModeAuthorized()).authorized;
  }
  await refreshDesktopTimezone();

  dashboardStore.hydrateRandomizeFileNames();

  await authStore.checkSession();

  // Establish the vault in the BACKGROUND. Batch mode still coalesces the
  // notification sound (one chime only if >3 new unread messages arrive), but
  // nothing below this line waits on it: the conversation list comes from the
  // links API, so blocking it behind the vault's key/socket work is what made
  // first open feel like a long "syncing across devices" freeze.
  const vaultEstablishment = (async () => {
    try {
      await vaultStore.beginBatchSync(() => vaultStore.initialize());
      // On first establishment, also pull the device's pending messages so the
      // new device is hydrated before the user first interacts.
      if (vaultStore.isInitialized) {
        await vaultStore.fetchPendingMessages().catch(() => {});
      }
    } catch (err) {
      console.error('[MessagingPage] Vault initialization failed on mount', err);
      $q.notify({
        type: 'negative',
        message: 'Connection to The Vault failed. Please check your network.',
        timeout: 3500,
      });
    }
  })();
  void vaultEstablishment;
  selectedLink.value = null;
  groupStore.setActiveGroup(null);
  vaultStore.setActiveLink(null);
  try {
    lastSelectedLinkId.value = localStorage.getItem('active_chat_link_id');
  } catch (err) {
    console.warn('[Messaging] Could not restore active chat id', err);
  }

  await refreshLinks({ silent: false });

  // Group state is device-scoped: `verifyGroupPermission` binds the
  // [groupId, userId, deviceId] triple, so a session whose Vault enrollment is
  // still in flight answers DEVICE_BINDING_REQUIRED. That is not a dead session
  // and must never be read as one — but it also means these calls cannot simply
  // race the enrollment. Run them, and if the device was not bound yet, wait for
  // the establishment already in flight (bounded) and retry once.
  const loadGroupSurface = async () => {
    await Promise.all([
      groupStore.fetchMyInvites(),
      groupStore.fetchMyJoinRequests(),
      notificationsStore.fetchNotifications(),
      groupStore.fetchGroups(),
      broadcastStore.ensureInit(),
    ]);
    await processPersistedGroupNotifications();
    await restoreSelectionForTab(activeTab.value);
  };

  try {
    await loadGroupSurface();
  } catch (err) {
    const body = (err as { response?: { data?: unknown } })?.response?.data;
    if (!isDeviceBindingRequired(body)) {
      console.error('[MessagingPage] Group surface failed to load', err);
    } else {
      await Promise.race([
        vaultEstablishment,
        new Promise<void>((resolve) => {
          setTimeout(resolve, VAULT_ENROLLMENT_WAIT_MS);
        }),
      ]);
      await loadGroupSurface().catch((retryErr) => {
        console.error('[MessagingPage] Group surface still unavailable after enrollment', retryErr);
      });
    }
  }

  // Close the suite right-click context menu on any outside click.
  const suiteMenuCloseHandler = (e: MouseEvent) => {
    if (suiteMenu.open && !(e.target as HTMLElement)?.closest?.('.suite-ctx-menu')) {
      suiteMenu.open = false;
    }
  };
  listen('document', 'click', suiteMenuCloseHandler as (event: Event) => void);
  timer = setInterval(
    () => {
      now.value = Date.now();
    },
    1 * 60 * 1000,
  );

  // Delivery polling owns its own interval lifetime (audit H3); the returned
  // stop function and the tracker are released in onUnmounted.
  stopDeliveryPolling = startDeliveryPolling(
    {
      selectedLinkId: () => selectedLink.value?.id ?? null,
      vaultMessages: () => vaultMessages.value,
      checkMessageDeliveryStatus: (linkId, ids) =>
        vaultStore.checkMessageDeliveryStatus(linkId, ids),
      updateMessageStatusFromDelivery: (linkId, status) =>
        vaultStore.updateMessageStatusFromDelivery(linkId, status),
      checkForStalledMessages: (linkId) => vaultStore.checkForStalledMessages(linkId),
      log: (message, error) => console.debug(message, error),
    },
    deliveryPollTracker,
  );

  // Auto-focus input on mount
  messageInputRef.value?.focus();

  // Disable Tauri default context menu globally on this page
  listen('document', 'contextmenu', preventDefaultContextMenu as (event: Event) => void);

  const syncAppFocusState = () => {
    vaultStore.setAppFocused(document.visibilityState !== 'hidden' && document.hasFocus());
  };

  syncAppFocusState();
  listen('window', 'focus', syncAppFocusState);
  listen('window', 'blur', syncAppFocusState);
  listen('document', 'visibilitychange', syncAppFocusState);

  // Keyboard shortcut to focus input (safe type checking)
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (target as HTMLElement).isContentEditable) return;

    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        messageInputRef.value?.focus();
      }
      return;
    }

    const key = e.key;
    const shouldType =
      key.length === 1 || key === 'Backspace' || key === 'Delete' || key === 'Enter' || key === ' ';
    if (!shouldType || !selectedLink.value) return;

    e.preventDefault();
    messageInputRef.value?.focus();

    if (key === 'Backspace') {
      draftMessage.value = draftMessage.value.slice(0, -1);
    } else if (key === 'Delete') {
      draftMessage.value = draftMessage.value.slice(0, -1);
    } else if (key === 'Enter') {
      draftMessage.value += '\n';
    } else if (key === ' ') {
      draftMessage.value += ' ';
    } else {
      draftMessage.value += key;
    }
  };

  const handleOpenMessaging = () => {
    const currentRoute = router.currentRoute.value.name;
    if (currentRoute !== 'chains') {
      void router.push({ name: 'chains' });
    }
  };

  // Safely attach scroll listener (released in onUnmounted).
  if (messagesScrollRef.value) {
    try {
      const scrollTarget = (messagesScrollRef.value as QScrollArea).getScrollTarget?.();
      if (scrollTarget) {
        pageScrollTarget = scrollTarget;
        scrollTarget.addEventListener('scroll', onScrollTargetScroll);
      }
    } catch (err) {
      console.error('[Messaging] Failed to attach scroll listener:', err);
    }
  }

  // Attach keyboard listener
  listen('window', 'mourn:open-messaging', handleOpenMessaging);
  listen('window', 'keydown', handleKeyDown as (event: Event) => void);

  // GIF/emoji picker click-outside handler
  const handleClickOutsideGifPicker = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const gifPicker = document.querySelector('.vault-gif-picker');
    const gifBtn = document.querySelector('.vault-gif-btn');
    const emojiPicker = document.querySelector('.vault-emoji-picker');
    const emojiBtn = document.querySelector('.vault-emoji-btn');

    if (gifPicker && target && !gifPicker.contains(target) && !gifBtn?.contains(target)) {
      showGifPicker.value = false;
    }
    if (emojiPicker && target && !emojiPicker.contains(target) && !emojiBtn?.contains(target)) {
      showEmojiPicker.value = false;
    }
  };

  listen('document', 'click', handleClickOutsideGifPicker as (event: Event) => void);
});

onUnmounted(() => {
  // Cleanup timers
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // H3: the delivery poll must not outlive the page. Dispose first so a
  // state change during teardown cannot start a new interval, then drop the watch.
  deliveryPollTracker.dispose();
  stopDeliveryPolling?.();
  stopDeliveryPolling = null;

  // Cleanup resize
  stopResize();

  // A conversation opened on mobile hides the app's bottom nav through this
  // class (see css/mainlayout.scss) — clear it or the nav stays gone after
  // leaving the messaging surface.
  document.body.classList.remove('vault-chat-open');

  disposeMobileBack();

  // Window/document listeners (focus/blur/visibilitychange, keydown,
  // open-messaging, GIF-picker and suite-menu click-outside, contextmenu) are
  // released together — each entry holds the exact handler that was attached.
  releasePageListeners();

  // The scroll target outlives the page element: drop the target's scroll
  // listener explicitly, otherwise it calls checkScrollPosition() after
  // teardown.
  if (pageScrollTarget) {
    pageScrollTarget.removeEventListener('scroll', onScrollTargetScroll);
    pageScrollTarget = null;
  }

  // Cleanup watches
  if (stopWatchMessages) {
    stopWatchMessages();
  }
  stopObservingMessageList();
  if (stopWarmBlobCache) {
    stopWarmBlobCache();
  }

  // Blob URLs retain decoded media until explicitly revoked.
  releaseObjectUrls();
});

//  Computed

const myId = computed(() => authStore.user?.id);

const incomingRequests = computed(() =>
  linksStore.links.filter((l) => l.status === 'PENDING' && l.receiverId === myId.value),
);
const outgoingRequests = computed(() =>
  linksStore.links.filter((l) => l.status === 'PENDING' && l.senderId === myId.value),
);

const incomingCount = computed(
  () =>
    incomingRequests.value.length +
    groupStore.myInvites.length +
    notificationsStore.notifications.filter(
      (notification) => notification.type === 'GROUP_JOIN_REQUEST' && !notification.isRead,
    ).length,
);
const unreadChatCount = computed(() => vaultStore.unreadCount);
const unreadSuiteCount = computed(() => groupStore.unreadCount + broadcastStore.unreadCount);

function suiteUnreadCount(groupId: string): number {
  return isBroadcastId(groupId)
    ? broadcastStore.unreadCount
    : (groupStore.unreadCounts[groupId] ?? 0);
}

// ───── Group / Suites ─────
const groupDiscoverOpen = ref(false);
const groupDiscoverLoading = ref(false);
const groupDiscoverQuery = ref('');
const groupDiscoverResults = ref<PublicGroup[]>([]);
const groupRespondingId = ref<string | null>(null);
const groupInviteRespondingId = ref<string | null>(null);
const requestingGroupIds = ref(new Set<string>());
let groupSearchTimer: ReturnType<typeof setTimeout> | null = null;

// IDs of groups the current user already belongs to (for the discover panel).
const myGroupIds = computed(
  () => new Set(groupStore.myGroups.filter((group) => !group.isLeft).map((group) => group.id)),
);

function joinRequestStatus(groupId: string): 'PENDING' | 'ACCEPTED' | 'REJECTED' | null {
  return groupStore.myJoinRequests[groupId]?.status ?? null;
}

const pendingSentGroupRequests = computed(() =>
  Object.values(groupStore.myJoinRequests).filter((request) => request.status === 'PENDING'),
);

const groupJoinRequests = computed(() =>
  notificationsStore.notifications
    .filter((n) => n.type === 'GROUP_JOIN_REQUEST' && !n.isRead)
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        requestId: String(d.requestId ?? ''),
        groupId: String(d.groupId ?? ''),
        groupName: String(d.groupName ?? 'Unknown suite'),
        username: String(d.username ?? 'user'),
        notificationId: n.id,
      };
    })
    .filter((r) => r.requestId),
);

const hasSignals = computed(
  () =>
    incomingRequests.value.length > 0 ||
    outgoingRequests.value.length > 0 ||
    groupStore.myInvites.length > 0 ||
    pendingSentGroupRequests.value.length > 0 ||
    groupJoinRequests.value.length > 0,
);

async function respondGroupInvite(
  invite: { id: string; groupId: string },
  action: 'ACCEPTED' | 'REJECTED',
) {
  if (groupInviteRespondingId.value) return;
  groupInviteRespondingId.value = invite.id;
  try {
    const ok =
      action === 'ACCEPTED'
        ? await groupStore.acceptInvite(invite.id, invite.groupId)
        : await groupStore.rejectInvite(invite.id, invite.groupId);
    if (!ok) {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Failed to respond to suite invitation',
        position: 'bottom-right',
      });
    }
  } finally {
    groupInviteRespondingId.value = null;
  }
}

async function openGroupDiscover() {
  groupDiscoverOpen.value = true;
  groupDiscoverQuery.value = '';
  await Promise.all([loadTopPublicGroups(), groupStore.fetchMyJoinRequests()]);
}

async function loadTopPublicGroups() {
  groupDiscoverLoading.value = true;
  try {
    groupDiscoverResults.value = await groupStore.fetchPublicTopGroups();
  } finally {
    groupDiscoverLoading.value = false;
  }
}

function onGroupDiscoverSearch(value: string | number | null) {
  const q = String(value ?? '');
  groupDiscoverQuery.value = q;
  if (groupSearchTimer) clearTimeout(groupSearchTimer);
  groupSearchTimer = setTimeout(async () => {
    if (q.trim().length < 3) {
      await loadTopPublicGroups();
      return;
    }
    groupDiscoverLoading.value = true;
    try {
      groupDiscoverResults.value = await groupStore.searchPublicGroups(q.trim());
    } finally {
      groupDiscoverLoading.value = false;
    }
  }, 350);
}

async function requestJoinGroup(groupId: string) {
  if (requestingGroupIds.value.has(groupId) || myGroupIds.value.has(groupId)) return;
  requestingGroupIds.value = new Set(requestingGroupIds.value).add(groupId);
  try {
    const ok = await groupStore.requestToJoinGroup(groupId);
    if (ok) {
      $q.notify({
        type: 'positive',
        message: 'Join request sent to the owner.',
        position: 'bottom',
      });
    } else {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Could not send join request.',
        position: 'bottom',
      });
    }
  } finally {
    const next = new Set(requestingGroupIds.value);
    next.delete(groupId);
    requestingGroupIds.value = next;
  }
}

// ───── Create Suite ─────────────────────────────────────────────
const createSuiteOpen = ref(false);
const createStage = ref<'select' | 'configure'>('select');
const addedMembers = ref<SearchUser[]>([]);
const createSearchQuery = ref('');
const createSearchLoading = ref(false);
const newGroupName = ref('');
const newGroupAvatarUrl = ref('');
const isPublicSuite = ref(false); // default private
const creatingSuite = ref(false);

const ownedSuiteCount = computed(
  () => groupStore.myGroups.filter((group) => group.myRole === 'OWNER' && !group.isLeft).length,
);

function openCreateSuite() {
  if (ownedSuiteCount.value >= 3) {
    $q.notify({
      type: 'warning',
      message: 'You can own a maximum of 3 suites.',
      position: 'bottom',
    });
    return;
  }
  // Reuse the discover popup's open if it's the trigger there
  createSuiteOpen.value = true;
  createStage.value = 'select';
  addedMembers.value = [];
  createSearchQuery.value = '';
  newGroupName.value = '';
  newGroupAvatarUrl.value = '';
  isPublicSuite.value = false;
}

/** Connections = users you have an established/anchored link with. */
const connections = computed<SearchUser[]>(() => {
  const me = authStore.user?.id;
  return (linksStore.chatChains as Link[]).map((l) => {
    const other = l.senderId === me ? l.receiver : l.sender;
    return {
      id: other.id,
      username: other.username,
      isDonator: other.isDonator,
      createdAt: l.createdAt,
      linkStatus: l.status,
      profile: other.profile,
    } as SearchUser;
  });
});

const createCandidateList = computed<SearchUser[]>(() => {
  if (createSearchQuery.value.trim().length >= 1) return linksStore.searchResults;
  return connections.value;
});

function isAdded(id: string): boolean {
  return addedMembers.value.some((m) => m.id === id);
}

function addMember(u: SearchUser) {
  if (isAdded(u.id)) return;
  addedMembers.value = [...addedMembers.value, u];
}

function removeAdded(id: string) {
  addedMembers.value = addedMembers.value.filter((m) => m.id !== id);
}

let createSearchTimer: ReturnType<typeof setTimeout> | null = null;
function onCreateSearch(value: string | number | null) {
  const q = String(value ?? '');
  createSearchQuery.value = q;
  if (createSearchTimer) clearTimeout(createSearchTimer);
  createSearchTimer = setTimeout(async () => {
    if (q.trim().length < 1) {
      linksStore.searchResults = [];
      return;
    }
    createSearchLoading.value = true;
    try {
      await linksStore.searchUsers(q.trim());
    } finally {
      createSearchLoading.value = false;
    }
  }, 300);
}

async function createSuite() {
  if (!newGroupName.value.trim()) return;
  creatingSuite.value = true;
  try {
    const groupId = await groupStore.createGroup({
      name: newGroupName.value,
      avatarUrl: newGroupAvatarUrl.value,
      isPublic: isPublicSuite.value,
    });
    if (!groupId) {
      throw new Error(groupStore.lastError || 'create failed');
    }

    // Send an invite to each added member
    for (const m of addedMembers.value) {
      await groupStore.sendGroupInvite(groupId, m.id);
    }

    createSuiteOpen.value = false;
    $q.notify({
      type: 'positive',
      message: `Suite "${newGroupName.value.trim()}" created — invites sent.`,
      position: 'top',
      timeout: 3000,
    });
    await groupStore.fetchGroups();
    // Land the creator inside the suite they just made: switch to the Suites tab
    // and open it, instead of dropping them back on a list wondering where it went.
    selectMessagingTab('suites');
    openGroupChat(groupId);
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to create suite.',
      position: 'bottom',
    });
  } finally {
    creatingSuite.value = false;
  }
}

async function respondGroupRequest(
  req: { requestId: string; groupId: string; notificationId: string },
  action: 'ACCEPTED' | 'REJECTED',
) {
  groupRespondingId.value = req.requestId;
  try {
    const ok = await groupStore.respondToJoinRequest(req.groupId, req.requestId, action);
    if (ok) {
      await notificationsStore.markAsRead(req.notificationId);
      $q.notify({
        type: action === 'ACCEPTED' ? 'positive' : 'info',
        message: action === 'ACCEPTED' ? 'Request accepted.' : 'Request rejected.',
        position: 'bottom',
      });
    } else {
      $q.notify({ type: 'negative', message: 'Action failed.', position: 'bottom' });
    }
  } finally {
    groupRespondingId.value = null;
  }
}

/**
 * Report a suite from its list context menu.
 *
 * Suite-level only for this cut (§4b): a report about messages INSIDE a suite
 * goes through the Vault message report. The server re-resolves the suite and
 * re-checks membership before writing the ticket, so this is only the client
 * pre-fill.
 */
function reportSuite(groupId: string) {
  if (!groupId || isBroadcastId(groupId)) return;
  const group = groupStore.groups.get(groupId);
  void openTicketReport(router, {
    targetType: 'suite',
    targetRef: groupId,
    label: group?.name ? `Suite "${group.name}"` : 'Suite',
  });
}

/**
 * Open group settings - ensures the full group data (including members) is loaded
 * BEFORE showing the modal, since GroupSettingsModal reads from activeGroup.members.
 */
async function openGroupSettings(groupId: string) {
  settingsGroupId.value = groupId;
  // Load the authoritative roster first so the modal never renders with a
  // partial/empty member list (a concurrent list refresh can otherwise show 0
  // members until details arrive). Show the modal only after details resolve.
  await groupStore.fetchGroupDetails(groupId);
  showGroupSettingsModal.value = true;
}

/** Open a group's chat in the center pane (mutually exclusive with 1:1 chat). */
function openGroupChat(groupId: string) {
  void hapticTap();
  if (isBroadcastId(groupId)) {
    void openBroadcast();
    return;
  }
  const group = groupStore.groups.get(groupId);
  if (!group || group.isLeft) return;
  activeTab.value = 'suites';
  lastSelectedGroupId.value = groupId;
  selectedLink.value = null;
  vaultStore.setActiveLink(null);
  rightPanelOpen.value = canToggleRightPanel.value;
  broadcastActive.value = false;
  groupStore.setActiveGroup(groupId);
  groupStore.markGroupRead(groupId);
}

/** Open the announcement broadcast channel in the center panel. */
async function openBroadcast() {
  activeTab.value = 'suites';
  lastSelectedGroupId.value = BROADCAST_SYNTHETIC_ID;
  selectedLink.value = null;
  vaultStore.setActiveLink(null);
  rightPanelOpen.value = canToggleRightPanel.value;
  groupStore.setActiveGroup(null);
  broadcastActive.value = true;
  await broadcastStore.ensureInit();
}

// Right-click context menu for a suite in the left panel.
const suiteMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  groupId: '' as string,
  name: '',
});
function openSuiteMenu(e: MouseEvent, g: { id: string; name: string }) {
  e.preventDefault();
  suiteMenu.groupId = g.id;
  suiteMenu.name = g.name;
  suiteMenu.x = e.clientX;
  suiteMenu.y = e.clientY;
  suiteMenu.open = true;
}

/** Toggle the announcement channel's mute from the suite context menu. */
async function toggleBroadcastMenuMute() {
  const next = !broadcastStore.muted;
  const ok = await broadcastStore.setMuted(next);
  if (!ok) {
    $q.notify({ type: 'negative', message: 'Failed to update mute state', position: 'bottom' });
    return;
  }
  $q.notify({
    type: 'positive',
    message: next ? 'Announcements muted.' : 'Announcements unmuted.',
    position: 'bottom',
  });
}

/**
 * Broadcast member-picker dialog state. Opens the roster so an admin can pick
 * a member to Remove (rotates the channel key) or Re-add (grants current key).
 */
const broadcastMembersOpen = ref(false);
const broadcastMembersLoading = ref(false);
/** The member currently targeted by an admin Remove/Re-add action. */
const broadcastTargetMember = ref<{
  userId: string;
  username: string | null;
  displayName: string | null;
} | null>(null);

/** Open the broadcast member-picker and load the roster. */
async function openBroadcastMembers() {
  broadcastMembersOpen.value = true;
  broadcastMembersLoading.value = true;
  try {
    await broadcastStore.fetchMembers();
  } finally {
    broadcastMembersLoading.value = false;
  }
}

function isSelfMember(userId: string): boolean {
  return userId === authStore.user?.id || userId === vaultStore.getStorageUid();
}

/** Admin: remove a SELECTED member (server rotates the channel key). */
async function removeBroadcastMember(userId: string) {
  const member = broadcastStore.members.find((m) => m.userId === userId);
  broadcastTargetMember.value = {
    userId,
    username: member?.username ?? null,
    displayName: member?.displayName ?? null,
  };
  openConfirm({
    danger: true,
    title: 'Remove Member',
    message: `Remove ${member?.displayName || member?.username || 'this member'} from the announcement channel? Their access is revoked and the channel key rotates.`,
    confirmLabel: 'Remove',
    onConfirm: async () => {
      try {
        await broadcastStore.removeMember(userId, broadcastStore.isAdmin);
        await broadcastStore.fetchMembers();
        $q.notify({ type: 'positive', message: 'Member removed', position: 'bottom' });
      } catch {
        $q.notify({
          type: 'negative',
          message: broadcastStore.lastError || 'Failed to remove member',
          position: 'bottom',
        });
      }
    },
  });
}

/** Admin: re-add a SELECTED member (grants them the current channel key). */
async function readdBroadcastMember(userId: string) {
  const member = broadcastStore.members.find((m) => m.userId === userId);
  try {
    await broadcastStore.readdMember(userId, broadcastStore.isAdmin);
    await broadcastStore.fetchMembers();
    $q.notify({
      type: 'positive',
      message: `${member?.displayName || member?.username || 'Member'} re-added`,
      position: 'bottom',
    });
  } catch {
    $q.notify({
      type: 'negative',
      message: broadcastStore.lastError || 'Failed to re-add member',
      position: 'bottom',
    });
  }
}

const showGroupSettingsModal = ref(false);
const settingsGroupId = ref<string | null>(null);

function canAddMembersForGroup(groupId: string): boolean {
  const group = groupStore.groups.get(groupId);
  if (!group || group.isLeft) return false;
  const member = group.members.find((item) => item.userId === authStore.user?.id);
  const role = member?.role ?? group.myRole;
  return Boolean(role === 'OWNER' || role === 'ADMIN' || member?.canAddMembers);
}

const activePanelGroup = computed(() => groupStore.activeGroup ?? null);
const panelOwnerMembers = computed(() =>
  (activePanelGroup.value?.members ?? []).filter((member) => member.role === 'OWNER'),
);
const panelAdminMembers = computed(() =>
  (activePanelGroup.value?.members ?? []).filter((member) => member.role === 'ADMIN'),
);
const panelUserMembers = computed(() =>
  (activePanelGroup.value?.members ?? []).filter((member) => member.role === 'USER'),
);

// Invite-to-existing-group dialog (user search → sendGroupInvite).
const groupInviteOpen = ref(false);
const groupInviteTarget = ref('');
const groupInviteLoading = ref(false);
const groupInviteQuery = ref('');
const groupInviteResults = ref<SearchUser[]>([]);
let groupInviteTimer: ReturnType<typeof setTimeout> | null = null;

function openGroupInvite(groupId: string) {
  if (!canAddMembersForGroup(groupId)) {
    $q.notify({ type: 'negative', message: 'You do not have permission to invite members.' });
    return;
  }
  groupInviteTarget.value = groupId;
  groupInviteQuery.value = '';
  groupInviteResults.value = [];
  groupInviteOpen.value = true;
}

function onGroupInviteSearch(value: string | number | null) {
  const q = String(value ?? '').trim();
  groupInviteQuery.value = q;
  if (groupInviteTimer) clearTimeout(groupInviteTimer);
  if (q.length < 1) {
    groupInviteResults.value = [];
    return;
  }
  groupInviteTimer = setTimeout(async () => {
    groupInviteLoading.value = true;
    try {
      await linksStore.searchUsers(q);
      groupInviteResults.value = linksStore.searchResults;
    } finally {
      groupInviteLoading.value = false;
    }
  }, 300);
}

async function inviteUserFromDialog(u: SearchUser) {
  if (!groupInviteTarget.value || !canAddMembersForGroup(groupInviteTarget.value)) {
    groupInviteOpen.value = false;
    return;
  }
  const ok = await groupStore.sendGroupInvite(groupInviteTarget.value, u.id);
  if (ok) {
    groupInviteOpen.value = false;
    $q.notify({ type: 'positive', message: `Invited @${u.username}`, position: 'bottom-right' });
  } else {
    $q.notify({
      type: 'negative',
      message: groupStore.lastError || 'Failed to invite',
      position: 'bottom-right',
    });
  }
}

// Leave-group confirmation.
const leaveConfirmOpen = ref(false);
const groupToLeave = ref('');

// Owner-specific leave state
const ownerLeaveOpen = ref(false);
const groupToOwnerLeave = ref('');
const otherGroupMembers = ref<{ userId: string; displayName: string; username: string }[]>([]);
const selectedNewOwner = ref<string | null>(null);
const isTransferringOwnership = ref(false);

// Delete group state
const deleteGroupOpen = ref(false);
const groupToDelete = ref('');

function confirmLeaveGroup(groupId: string) {
  const group = groupStore.groups.get(groupId);
  if (!group) return;

  // Check if user is owner
  if (group.myRole === 'OWNER') {
    // For owners, show the special dialog
    confirmOwnerLeave(groupId);
  } else {
    // For non-owners, show regular leave dialog
    groupToLeave.value = groupId;
    leaveConfirmOpen.value = true;
  }
}

async function confirmOwnerLeave(groupId: string) {
  // First fetch full group details to get members
  await groupStore.fetchGroupDetails(groupId);
  const group = groupStore.groups.get(groupId);
  if (!group) return;

  groupToOwnerLeave.value = groupId;

  // Get other members (exclude self) - use auth store user ID
  const authStore = useAuthStore();
  otherGroupMembers.value = group.members
    .filter((m) => m.userId !== authStore.user?.id) // Exclude self
    .map((m) => ({
      userId: m.userId,
      displayName: m.profile?.displayName || m.username || m.userId.slice(0, 8),
      username: m.username || 'user',
    }));

  selectedNewOwner.value = null;
  ownerLeaveOpen.value = true;
}

async function handleOwnerLeave() {
  const groupId = groupToOwnerLeave.value;
  const memberCount = otherGroupMembers.value.length;

  if (memberCount === 0) {
    // No other members - offer delete option
    groupToDelete.value = groupId;
    deleteGroupOpen.value = true;
    ownerLeaveOpen.value = false;
  } else if (memberCount === 1) {
    // Only one other member - auto-transfer to them
    const targetMember = otherGroupMembers.value[0];
    if (!targetMember) {
      $q.notify({ type: 'negative', message: 'No other members found', position: 'bottom-right' });
      return;
    }
    isTransferringOwnership.value = true;
    const ok = await groupStore.transferOwnership(groupId, targetMember.userId);
    isTransferringOwnership.value = false;

    if (ok) {
      // Now leave the group
      await groupStore.leaveGroup(groupId);
      $q.notify({
        type: 'positive',
        message: `Left suite. Ownership transferred to ${targetMember.displayName}`,
        position: 'bottom-right',
      });
    } else {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Failed to transfer ownership',
        position: 'bottom-right',
      });
    }
    ownerLeaveOpen.value = false;
  } else {
    // Multiple members - require selection
    if (!selectedNewOwner.value) {
      $q.notify({
        type: 'warning',
        message: 'Please select a new owner',
        position: 'bottom-right',
      });
      return;
    }

    const targetMember = otherGroupMembers.value.find((m) => m.userId === selectedNewOwner.value);
    isTransferringOwnership.value = true;
    const ok = await groupStore.transferOwnership(groupId, selectedNewOwner.value);
    isTransferringOwnership.value = false;

    if (ok) {
      await groupStore.leaveGroup(groupId);
      $q.notify({
        type: 'positive',
        message: `Left suite. Ownership transferred to ${targetMember?.displayName || 'selected member'}`,
        position: 'bottom-right',
      });
    } else {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Failed to transfer ownership',
        position: 'bottom-right',
      });
    }
    ownerLeaveOpen.value = false;
  }
}

async function handleDeleteGroup() {
  const groupId = groupToDelete.value;
  const ok = await groupStore.deleteGroup(groupId);

  deleteGroupOpen.value = false;

  if (ok) {
    $q.notify({ type: 'positive', message: 'Suite deleted', position: 'bottom-right' });
  } else {
    $q.notify({
      type: 'negative',
      message: groupStore.lastError || 'Failed to delete suite',
      position: 'bottom-right',
    });
  }
}

// Check if a group is in "left" state
function isLeftGroup(groupId: string): boolean {
  const group = groupStore.groups.get(groupId);
  return group?.isLeft === true;
}

// Confirm delete a left group from device (removes locally only)
function confirmDeleteLeftGroup(groupId: string) {
  groupStore.groups.delete(groupId);
  $q.notify({ type: 'positive', message: 'Suite removed from device', position: 'bottom-right' });
}
async function leaveGroupConfirmed() {
  const ok = await groupStore.leaveGroup(groupToLeave.value);
  leaveConfirmOpen.value = false;
  if (ok) {
    $q.notify({ type: 'positive', message: 'Left suite', position: 'bottom-right' });
  } else {
    $q.notify({
      type: 'negative',
      message: groupStore.lastError || 'Failed to leave',
      position: 'bottom-right',
    });
  }
}
const viewportWidth = computed(
  () => $q?.screen?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0),
);

/**
 * Height of the ACTUALLY visible viewport.
 *
 * Android 15+/16 draws the app edge-to-edge, so `innerHeight` can stay at full
 * screen height while the IME covers the bottom — the chat pane is a fixed
 * layer, so it kept its full height and the composer ended up underneath the
 * keyboard. `visualViewport` reports what the user can actually see; the pane
 * is pinned to it while a conversation is open on mobile.
 */
const visibleViewportHeight = ref<number | null>(null);
function syncVisibleViewport(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  visibleViewportHeight.value = Math.round(vv.height);
}
const chatPaneStyle = computed(() =>
  isMobile.value && mobileChatOpen.value && visibleViewportHeight.value
    ? { height: `${visibleViewportHeight.value}px` }
    : {},
);

// The IME opening is what changes the visible height; `scroll` is included
// because Android also shifts the visual viewport when it pans to the caret.
let visibleViewportCleanup: (() => void) | null = null;
onMounted(() => {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  syncVisibleViewport();
  vv.addEventListener('resize', syncVisibleViewport);
  vv.addEventListener('scroll', syncVisibleViewport);
  visibleViewportCleanup = () => {
    vv.removeEventListener('resize', syncVisibleViewport);
    vv.removeEventListener('scroll', syncVisibleViewport);
  };
});
onUnmounted(() => {
  visibleViewportCleanup?.();
  visibleViewportCleanup = null;
});
const canToggleRightPanel = computed(() => viewportWidth.value > RIGHT_PANEL_AUTO_HIDE_WIDTH);
const isRateLimited = computed(() => vaultStore.isRateLimited());

function sortLinksForDisplay(links: Link[]): Link[] {
  return [...links].sort((left, right) => {
    const leftMessages = vaultStore.messages[left.id] || [];
    const rightMessages = vaultStore.messages[right.id] || [];
    const leftLastMessageAt = leftMessages[leftMessages.length - 1]?.timestamp ?? 0;
    const rightLastMessageAt = rightMessages[rightMessages.length - 1]?.timestamp ?? 0;
    // `Link.updatedAt` is NOT bumped when a message is sent, so it is only a
    // fallback. `linkLastActivity` is our own persisted per-link activity, which
    // is correct even for conversations whose messages are not loaded yet.
    const leftUpdatedAt = Math.max(
      new Date(left.updatedAt || left.createdAt || 0).getTime(),
      leftLastMessageAt,
      vaultStore.linkLastActivity[left.id] ?? 0,
    );
    const rightUpdatedAt = Math.max(
      new Date(right.updatedAt || right.createdAt || 0).getTime(),
      rightLastMessageAt,
      vaultStore.linkLastActivity[right.id] ?? 0,
    );
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return left.id.localeCompare(right.id);
  });
}

/** Chat-list filters — these replace the old PINNED / ACTIVE / CLOSED sections. */
const CHAT_FILTERS = [
  { key: 'all', label: 'ALL' },
  { key: 'unread', label: 'UNREAD' },
  { key: 'pinned', label: 'PINNED' },
  { key: 'unpinned', label: 'UNPINNED' },
] as const;
type ChatFilterKey = (typeof CHAT_FILTERS)[number]['key'];
const chatFilter = ref<ChatFilterKey>('all');

/** Every chat, before filtering. */
const allChatLinks = computed(() => [
  ...linksStore.anchoredLinks,
  ...linksStore.decayingLinks,
  ...linksStore.severedLinks,
]);

/**
 * One flat list, newest conversation first — sortLinksForDisplay orders by last
 * activity, which is the WhatsApp behaviour that was asked for.
 *
 * Pinned chats stay in place and keep their red left border; only the CATEGORIES
 * are gone. Previously pinned chats had their own section that could fill the whole
 * pane, so an unpinned conversation (and its notification) was simply invisible.
 */
const visibleChatLinks = computed(() => {
  const filtered = allChatLinks.value.filter((link) => {
    if (chatFilter.value === 'pinned') return link.status === 'ANCHORED';
    if (chatFilter.value === 'unpinned') return link.status !== 'ANCHORED';
    if (chatFilter.value === 'unread') return vaultStore.unreadLinks[link.id] === true;
    return true;
  });
  return sortLinksForDisplay(filtered);
});

watch(activeTab, async (tab: MessagingTab) => {
  const transitionVersion = ++tabTransitionVersion;
  const isCurrentTransition = () =>
    transitionVersion === tabTransitionVersion && activeTab.value === tab;

  if (tab === 'signals') {
    closeConversation();
    await Promise.all([
      refreshLinks({ silent: true }),
      groupStore.fetchMyInvites(),
      groupStore.fetchMyJoinRequests(),
      notificationsStore.fetchNotifications(),
    ]);
    return;
  }

  if (tab === 'chats') {
    groupStore.setActiveGroup(null);
    await refreshLinks({ silent: true });
    if (!isCurrentTransition()) return;
    await restoreSelectionForTab('chats');
    return;
  }

  selectedLink.value = null;
  vaultStore.setActiveLink(null);
  rightPanelOpen.value = false;
  await groupStore.fetchGroups();
  if (!isCurrentTransition()) return;
  await restoreSelectionForTab('suites');
});

watch(
  () => linksStore.links.map((link) => `${link.id}:${link.status}:${link.updatedAt}`).join('|'),
  () => {
    syncSelectedLinkFromStore();
  },
);

watch(
  () => viewportWidth.value,
  (width) => {
    if (width <= RIGHT_PANEL_AUTO_HIDE_WIDTH) {
      rightPanelOpen.value = false;
    }
  },
  { immediate: true },
);

// Ensure initial badge display is updated
watch(
  () => incomingCount.value,
  (count) => {
    // Just watching for reactive updates to ensure badge shows
    if (count > 0) {
      console.debug('Incoming link requests:', count);
    }
  },
);

watch(
  () => ({
    linkId: selectedLink.value?.id,
    count: selectedLink.value ? vaultStore.messages[selectedLink.value.id]?.length || 0 : 0,
  }),
  (curr) => {
    if (curr.linkId && vaultStore.appFocused) {
      console.log('[MessagingPage] Link selected watch fired', {
        linkId: curr.linkId,
        messageCount: curr.count,
      });
      vaultStore.markLinkRead(curr.linkId);
    }
  },
);

watch(
  () => vaultStore.appFocused,
  (focused) => {
    if (focused && selectedLink.value) {
      vaultStore.markLinkRead(selectedLink.value.id);
    }
  },
);

// Additional watch to catch when selectedLink changes and force message load
watch(
  () => selectedLink.value?.id,
  async (newLinkId) => {
    if (newLinkId) {
      console.log('[MessagingPage] Selected link changed, loading messages', { linkId: newLinkId });
      // Ensure messages are loaded for this link
      if (!vaultStore.messages[newLinkId] || vaultStore.messages[newLinkId].length === 0) {
        await vaultStore.loadMessages(newLinkId);
      }
    }
  },
);

watch(
  () => vaultStore.activeLinkId,
  async (linkId) => {
    if (!linkId) return;
    if (selectedLink.value?.id === linkId) return;
    if (chatOpener.isOpening(linkId)) return;
    const link = linksStore.links.find((l) => l.id === linkId);
    if (link) {
      await openChat(link);
    }
  },
);

const myUsername = computed(() => authStore.user?.username || 'me');

function normalizeProfilePicture(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) return trimmed;

  // Only treat absolute or media-like relative paths as backend assets.
  // This avoids accidental requests like "chains" when bad profile data exists.
  if (trimmed.startsWith('/')) return resolveApiUrl(trimmed);
  if (
    trimmed.startsWith('media/') ||
    trimmed.startsWith('uploads/') ||
    trimmed.startsWith('public/')
  ) {
    return resolveApiUrl(`/${trimmed}`);
  }

  return null;
}

const myAvatar = computed(() => {
  if (!selectedLink.value || !myId.value) {
    return `https://ui-avatars.com/api/?background=222&color=fff&name=${myUsername.value}`;
  }
  const me =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.sender
      : selectedLink.value.receiver;
  if (!me) {
    return `https://ui-avatars.com/api/?background=222&color=fff&name=${myUsername.value}`;
  }
  const f = normalizeProfilePicture(me?.profile?.profilePicture);
  if (f) {
    return f;
  }
  return `https://ui-avatars.com/api/?background=222&color=fff&name=${myUsername.value}`;
});

// The documented fingerprint is the peer's device public key, not a derived hash.
const peerDevicePub = computed(() => peerDevices.value[0]?.devicePub || '');

const peerDevices = computed(() => {
  if (!selectedLink.value) return [];
  const peer =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.receiver
      : selectedLink.value.sender;
  if (!peer) return [];
  return peer?.devices || [];
});

const partnerUsername = computed(() => {
  if (!selectedLink.value) return 'user';
  const other =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.receiver
      : selectedLink.value.sender;
  return other?.username ?? 'user';
});

const partnerAvatar = computed(() => {
  if (!selectedLink.value) return 'https://ui-avatars.com/api/?background=222&color=fff&name=?';
  const other =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.receiver
      : selectedLink.value.sender;
  if (!other) return 'https://ui-avatars.com/api/?background=222&color=fff&name=?';
  const f = normalizeProfilePicture(other?.profile?.profilePicture);
  if (f) {
    return f;
  }
  return 'https://ui-avatars.com/api/?background=222&color=fff&name=' + (other?.username ?? '?');
});

// ── Day-separator helpers ────────────────────────────────────────────────
function isDifferentDay(prevTs: number | undefined, ts: number): boolean {
  if (prevTs === undefined || prevTs === null) return true; // first message always shows separator
  const a = new Date(prevTs);
  const b = new Date(ts);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

/**
 * WhatsApp-style runs: the avatar + name are only drawn on the FIRST message of a
 * consecutive block from the same sender. A block breaks when the other side
 * speaks, or when the day rolls over (which is also where the day separator is
 * drawn, so the two always agree).
 */
function isStreakStart(idx: number): boolean {
  if (idx <= 0) return true;
  const current = vaultMessages.value[idx];
  const prev = vaultMessages.value[idx - 1];
  if (!current || !prev) return true;
  if (prev.isSender !== current.isSender) return true;
  return isDifferentDay(prev.timestamp, current.timestamp);
}

function formatDaySeparator(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
    return 'Today';
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  )
    return 'Yesterday';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDiscordLikeTimestamp(ts: number): string {
  const d = new Date(ts);
  const nowDate = new Date();
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const hourPeriod = d.toLocaleString([], { hour: 'numeric', hour12: true }).split(' ')[1]; // AM/PM

  if (targetDay.getTime() === today.getTime()) {
    return `${hour}:${min} ${hourPeriod}`;
  }

  if (targetDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${hour}:${min} ${hourPeriod}`;
  }

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy} ${hour}:${min} ${hourPeriod}`;
}

const chatPartnerName = computed(() => {
  if (!selectedLink.value) return '';
  const other =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.receiver
      : selectedLink.value.sender;
  if (!other) return '';
  return other?.profile?.displayName || other?.username || 'Unknown';
});

const chatMsRemaining = computed(() => {
  if (!selectedLink.value?.expiresAt) return Infinity;
  return new Date(selectedLink.value.expiresAt).getTime() - now.value;
});

const isChatExpired = computed(
  () =>
    selectedLink.value?.status === 'ESTABLISHED' &&
    selectedLink.value?.expiresAt &&
    chatMsRemaining.value <= 0,
);

const isSevered = computed(() => selectedLink.value?.status === 'SEVERED');
const canExchangeMessages = computed(
  () => selectedLink.value?.status === 'ESTABLISHED' || selectedLink.value?.status === 'ANCHORED',
);

const chatTimeRemaining = computed(() => {
  const ms = chatMsRemaining.value;
  if (ms <= 0) return 'EXPIRED';
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
});

const isCompromised = computed(() => {
  if (!selectedLink.value) return false;
  return vaultStore.compromisedLinks[selectedLink.value.id] === true;
});

const tempSafetyActive = computed(() => {
  if (!selectedLink.value) return false;
  const until = vaultStore.tempSafetyUntil[selectedLink.value.id] ?? 0;
  return until > now.value;
});

/**
 * Hard blocks — the chat itself cannot send at all. Deliberately EXCLUDES the
 * "vault still establishing" state: gating the textarea on `isInitialized` made
 * the composer un-clickable when the secure channel was slow to come up (users
 * reported "I opened a chat and couldn't click the input"). The input stays
 * usable so the user can type; only the send BUTTON waits for readiness, and
 * `sendVaultMessage` awaits `initialize()` before sending.
 */
const isChatUnavailable = computed(
  () =>
    (isCompromised.value && !tempSafetyActive.value) ||
    isSevered.value ||
    !canExchangeMessages.value,
);

const isSendBlocked = computed(() => isChatUnavailable.value || !vaultStore.isInitialized);

/**
 * "Sending is disabled and nothing tells me why" guard.
 *
 * The vault store initialises on session restore WITHOUT a password, and a device
 * that isn't enrolled yet rejects registration with "Current password is required to
 * enroll a new device". The store then sets `connectionError` and returns, leaving
 * `isInitialized` false — so the composer renders normally with a permanently
 * disabled send button and no user-visible cause.
 */
const vaultEnroll = useVaultEnrollment();
const vaultEnrollmentNeeded = vaultEnroll.vaultEnrollmentNeeded;
const isEnrolling = vaultEnroll.enrolling;

async function startVaultEnrollment(): Promise<void> {
  const ok = await vaultEnroll.promptVaultEnrollment();
  if (ok && selectedLink.value) void vaultStore.loadMessages(selectedLink.value.id);
}

watch(
  () => selectedLink.value?.id ?? null,
  (linkId) => {
    vaultStore.setActiveLink(linkId);
    if (!linkId) {
      try {
        localStorage.removeItem('active_chat_link_id');
      } catch (err) {
        console.warn('[Messaging] Could not clear active chat id', err);
      }
    }
  },
  { immediate: true },
);

const quarantinedQueue = computed(() => {
  if (!selectedLink.value) return [];
  return vaultStore.quarantinedMessages[selectedLink.value.id] || [];
});

//  Actions

// M5: openChat() writes the store's active link, and the activeLinkId watcher
// below opens chats the same way. The watcher's `selectedLink` guard only covers
// sequential re-entry, so a second caller arriving while the first open is still
// awaiting loadMessages() loaded the same conversation twice. The keyed opener
// coalesces concurrent opens per link; the watcher additionally skips ids whose
// open is in flight.
const chatOpener = createKeyedOpener<Link>((link) => openChatNow(link));

function openChat(link: Link): Promise<void> {
  // User-initiated only (mobile auto-open is disabled), so this is a safe place
  // for the tap feedback. Never call it from a store watcher.
  void hapticTap();
  if (link.status === 'PENDING') {
    selectMessagingTab('signals');
    return Promise.resolve();
  }
  return chatOpener.open(link);
}

async function openChatNow(link: Link) {
  console.log('[MessagingPage] openChat called for link', { linkId: link.id });
  activeTab.value = 'chats';
  lastSelectedLinkId.value = link.id;
  groupStore.setActiveGroup(null);
  selectedLink.value = link;
  vaultStore.setActiveLink(link.id);
  notificationsStore.removeNotificationByLinkId(link.id);

  // Safely store active chat ID (with error handling)
  try {
    if (link.id) {
      localStorage.setItem('active_chat_link_id', link.id);
    }
  } catch (err) {
    console.error('[Messaging] Failed to save active chat to localStorage:', err);
  }

  vaultStore.markLinkRead(link.id);

  // CRITICAL: Always load messages first to ensure conversation is visible
  // even if settings need to be configured
  console.log('[MessagingPage] Loading messages for link', { linkId: link.id });
  await vaultStore.loadMessages(link.id);

  // Force Vue to re-evaluate the computed property
  await nextTick();
  // Keep the thread pinned to the newest message as media previews resolve.
  observeMessageList();
  // Opening a chat must land on the NEWEST message. It previously opened at
  // scrollTop 0 (verified on device: scrollRange 0/211), so an active
  // conversation opened at its oldest message.
  pinToBottom();
  console.log('[MessagingPage] Messages loaded, current count:', {
    linkId: link.id,
    messageCount: vaultStore.messages[link.id]?.length || 0,
    vaultMessagesLength: vaultMessages.value.length,
  });

  // Account-level decay timer: only prompt when NO account default exists yet.
  // loadChatSettings falls back to the shared account default, so this fires at
  // most once per account (never again on a fresh device). If the account
  // default hasn't loaded yet, fetch it before deciding.
  if (!vaultStore.accountRetention) {
    try {
      vaultStore.accountRetention = await vaultStore.loadAccountSettings();
    } catch (err) {
      console.warn('[MessagingPage] Could not refresh account retention', err);
    }
  }
  const settings = await vaultStore.loadChatSettings(link.id);
  if (!settings) {
    showSettingsModal.value = true;
  }
}

async function saveSettingsAndInit() {
  if (!selectedLink.value) return;
  try {
    const linkId = selectedLink.value.id;

    // If there was NO account-level retention default yet, this confirmation
    // establishes the account-wide decay timer (shared across all devices),
    // not just this link/device.
    const hadAccountSetting = !!vaultStore.accountRetention;
    await vaultStore.saveChatSettings(linkId, settingsForm.value);
    if (!hadAccountSetting) {
      try {
        await vaultStore.saveAccountSettings(
          settingsForm.value.mode,
          settingsForm.value.retainHours,
        );
        vaultStore.accountRetention = { ...settingsForm.value };
      } catch (err) {
        console.warn('[MessagingPage] Could not save account retention', err);
      }
    }

    await refreshLinks();
    const freshLink = syncSelectedLinkFromStore();
    await vaultStore.loadMessages(freshLink?.id ?? linkId);
  } catch (err) {
    console.error('Failed to save settings:', err);
  } finally {
    showSettingsModal.value = false;
  }
}

async function respond(linkId: string, action: 'accept' | 'reject') {
  respondingId.value = linkId;
  try {
    await linksStore.respondToLink(linkId, action);
    await refreshLinks(); // Refresh to update signals tab
    // Remove the notification for this link request
    notificationsStore.removeNotificationByLinkId(linkId);
    $q.notify({
      type: action === 'accept' ? 'positive' : 'info',
      message: action === 'accept' ? 'Link established  72h timer started' : 'Link rejected',
      position: 'bottom',
      timeout: 2000,
    });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to respond', position: 'bottom' });
  } finally {
    respondingId.value = null;
  }
}

/**
 * Cancel an outgoing (pending) link request the user sent. The sender cannot
 * use the /respond route (receiver-only), so this calls the dedicated
 * sender-cancel endpoint (linksStore.cancelLinkRequest) which deletes the
 * PENDING link and drops its notification server + client side.
 */
async function cancelOutgoingLink(linkId: string) {
  if (cancellingLinkId.value || respondingId.value) return;
  cancellingLinkId.value = linkId;
  try {
    await linksStore.cancelLinkRequest(linkId);
    $q.notify({
      type: 'info',
      message: 'Link request cancelled',
      position: 'bottom',
      timeout: 2000,
    });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to cancel request', position: 'bottom' });
  } finally {
    cancellingLinkId.value = null;
  }
}

/**
 * Cancel a suite join request the user sent (requester-cancels-own-request).
 */
async function cancelJoinRequest(groupId: string) {
  if (cancellingGroupId.value) return;
  cancellingGroupId.value = groupId;
  try {
    const ok = await groupStore.cancelJoinRequest(groupId);
    if (!ok) {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Failed to cancel request',
        position: 'bottom',
      });
      return;
    }
    await groupStore.fetchMyJoinRequests();
    $q.notify({
      type: 'info',
      message: 'Suite request cancelled',
      position: 'bottom',
      timeout: 2000,
    });
  } finally {
    cancellingGroupId.value = null;
  }
}

async function anchorCurrentChat() {
  if (!selectedLink.value) return;
  anchoringId.value = selectedLink.value.id;
  try {
    await linksStore.anchorLink(selectedLink.value.id);
    const updated = linksStore.links.find((l) => l.id === selectedLink.value?.id);
    if (updated) selectedLink.value = updated;
    $q.notify({
      type: 'positive',
      message: 'Link anchored permanently',
      position: 'bottom',
      timeout: 2000,
    });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to anchor', position: 'bottom' });
  } finally {
    anchoringId.value = null;
  }
}

async function unanchorCurrentChat() {
  if (!selectedLink.value) return;
  try {
    await vaultStore.unanchorLink(selectedLink.value.id);
    await refreshLinks();
    const updated = linksStore.links.find((l) => l.id === selectedLink.value?.id);
    if (updated) selectedLink.value = updated;
    $q.notify({ type: 'info', message: 'Link unanchored', timeout: 2000 });
  } catch (err) {
    console.error('Failed to unanchor link', err);
    $q.notify({ type: 'negative', message: 'Failed to unanchor', timeout: 2500 });
  }
}

async function markSafeCurrentChat() {
  if (!selectedLink.value) return;
  const link = selectedLink.value;
  await vaultStore.markLinkSafe(link.id);
  showCompromiseModal.value = false;
  $q.notify({ type: 'positive', message: 'Link marked safe', timeout: 2000 });
}

async function allowMessagingForNow() {
  if (!selectedLink.value) return;
  await vaultStore.allowMessagingTemp(selectedLink.value.id);
  showCompromiseModal.value = false;
  $q.notify({ type: 'warning', message: 'Unsafe window open for 5 minutes', timeout: 2500 });
}

async function severLinkKeepHistory() {
  if (!selectedLink.value) return;
  openConfirm({
    title: 'CLOSE CONNECTION',
    message: 'This will close the connection. Your message history will be kept on this device.',
    confirmLabel: 'CLOSE',
    danger: false,
    onConfirm: async () => {
      const linkId = selectedLink.value!.id;
      try {
        await vaultStore.closeLinkRemote(linkId, false);
        await refreshLinks();
        const updated = linksStore.links.find((l) => l.id === linkId);
        if (updated) selectedLink.value = updated;
        $q.notify({ type: 'warning', message: 'Connection closed (history kept)', timeout: 2000 });
      } catch (err) {
        console.error('Failed to close link', err);
        $q.notify({ type: 'negative', message: 'Failed to close connection', timeout: 2500 });
      } finally {
        showCompromiseModal.value = false;
      }
    },
  });
}

async function severLinkAndPurge() {
  if (!selectedLink.value) return;
  openConfirm({
    title: 'CLOSE & CLEAR',
    message:
      'This will close the connection AND delete all messages from this device. This cannot be undone.',
    confirmLabel: 'CLOSE & CLEAR',
    danger: true,
    onConfirm: async () => {
      const linkId = selectedLink.value!.id;
      try {
        await vaultStore.closeLinkRemote(linkId, true);
        await refreshLinks();
        selectedLink.value = null;
        vaultStore.setActiveLink(null);
        try {
          localStorage.removeItem('active_chat_link_id');
        } catch {
          /* ignore */
        }
        $q.notify({
          type: 'positive',
          message: 'Connection closed and chat cleared.',
          timeout: 2500,
        });
      } catch (err) {
        console.error('Failed to close / clear local chat', err);
        $q.notify({ type: 'negative', message: 'Failed to complete action', timeout: 2500 });
      } finally {
        showCompromiseModal.value = false;
      }
    },
  });
}

async function deleteChatLocal() {
  if (!selectedLink.value) return;
  const linkId = selectedLink.value.id;
  await vaultStore.deleteChatLocal(linkId);
  $q.notify({ type: 'info', message: 'Local chat deleted', timeout: 2000 });
  showDeleteModal.value = false;
}

async function copyDeviceFingerprint() {
  const fingerprint = peerDevicePub.value;
  if (!fingerprint) {
    $q.notify({ type: 'warning', message: 'No peer device fingerprint available', timeout: 1500 });
    return;
  }
  try {
    await navigator.clipboard.writeText(fingerprint);
    $q.notify({ type: 'positive', message: 'Fingerprint copied to clipboard', timeout: 1500 });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to copy fingerprint', timeout: 1500 });
  }
}

async function requestRelink() {
  if (!selectedLink.value || !myId.value) return;
  const partnerId =
    selectedLink.value.senderId === myId.value
      ? selectedLink.value.receiverId
      : selectedLink.value.senderId;
  try {
    await linksStore.requestLink(partnerId, false);
    await refreshLinks();
    const pending = linksStore.links.find(
      (l) => l.status === 'PENDING' && l.senderId === myId.value && l.receiverId === partnerId,
    );
    if (pending) {
      await openChat(pending);
    }
    $q.notify({ type: 'positive', message: 'Link request sent', timeout: 2000 });
  } catch (err) {
    console.error('Failed to request link', err);
    $q.notify({ type: 'negative', message: 'Failed to send link request', timeout: 2500 });
  }
}

/**
 * Ask the vault to pull pending ciphertext / request a history backfill.
 *
 * Returns whether the request was accepted instead of throwing, and stays quiet
 * when the caller owns the messaging. The previous version caught its own error
 * and only notified, so `onNavSync` saw a resolved promise, printed "Synced —
 * pulled the latest history from your other devices" *on top of* this function's
 * "Vault sync request failed" — success and failure in the same breath.
 */
async function requestVaultSync(opts: { notify?: boolean } = {}): Promise<boolean> {
  const notify = opts.notify !== false;
  try {
    await vaultStore.requestVaultSync();
    if (notify) {
      $q.notify({
        type: 'positive',
        message: 'Vault sync requested across your devices.',
        timeout: 2000,
        classes: 'font-mono bg-black text-white border border-dash-border',
      });
    }
    return true;
  } catch (err) {
    console.error('Vault sync failed', err);
    if (notify) {
      $q.notify({
        type: 'negative',
        message: 'Vault sync request failed',
        timeout: 2500,
        classes: 'font-mono bg-black text-white border border-negative/40',
      });
    }
    return false;
  }
}

/**
 * Manual "sync devices" — close the popup and run a full cross-device sync.
 * stack two full syncs (each pulling pending ciphertext + a forced history
 * backfill), which is what made the list look like it was reloading on a loop
 * while giving no indication of whether anything happened.
 */
const vaultSyncing = ref(false);
async function onNavSync(): Promise<void> {
  navMenuOpen.value = false;
  if (vaultSyncing.value) return;
  vaultSyncing.value = true;
  try {
    const accepted = await requestVaultSync({ notify: false });
    if (accepted) {
      $q.notify({
        type: 'positive',
        // The request is accepted here; the pull itself lands asynchronously, so
        // don't claim the history has already arrived.
        message: 'Sync requested — history will arrive from your other devices.',
        timeout: 2000,
      });
    } else {
      $q.notify({
        type: 'negative',
        message: 'Sync failed — check your connection.',
        timeout: 3500,
      });
    }
  } finally {
    vaultSyncing.value = false;
  }
}

/** Open the chat partner's public profile page. */
function openPartnerProfile() {
  const username = partnerUsername.value;
  if (!username || username === 'user') return;
  void router.push(`/${username}`);
}

// ── Context Menu Action Handlers (from ChatListItem) ────────────────────

async function handleChatVaultSync(link: Link) {
  selectedLink.value = link;
  await requestVaultSync();
}

/** Mark a chat as read from the right-click menu. */
function handleChatMarkRead(link: Link) {
  vaultStore.markLinkRead(link.id);
}

/** Toggle a chat's mute flag from the right-click menu. */
async function handleChatToggleMute(link: Link) {
  const muted = (await vaultStore.isChatMuted(link.id)) === true;
  await vaultStore.setChatMuted(link.id, !muted);
  $q.notify({
    type: 'info',
    message: muted ? 'Chat unmuted — sounds restored.' : 'Chat muted — no notification sounds.',
    position: 'bottom',
    timeout: 1800,
    classes: 'font-mono bg-black text-white border border-dash-border',
  });
}

async function handleChatUnanchor(link: Link) {
  selectedLink.value = link;
  await unanchorCurrentChat();
}

async function handleChatAnchor(link: Link) {
  selectedLink.value = link;
  if (link.status === 'ESTABLISHED') {
    anchoringId.value = link.id;
    try {
      await linksStore.anchorLink(link.id);
      const updated = linksStore.links.find((l) => l.id === link.id);
      if (updated) selectedLink.value = updated;
      $q.notify({
        type: 'positive',
        message: 'Link anchored permanently',
        position: 'bottom',
        timeout: 2000,
      });
    } catch {
      $q.notify({ type: 'negative', message: 'Failed to anchor', position: 'bottom' });
    } finally {
      anchoringId.value = null;
    }
  }
}

async function handleChatSever(link: Link) {
  selectedLink.value = link;
  openConfirm({
    title: 'CLOSE CONNECTION',
    message:
      'This will close the connection with this contact. Your message history will be kept on this device.',
    confirmLabel: 'CLOSE',
    danger: false,
    onConfirm: async () => {
      const linkId = link.id;
      try {
        await vaultStore.closeLinkRemote(linkId, false);
        await refreshLinks();
        const updated = linksStore.links.find((l) => l.id === linkId);
        if (updated) selectedLink.value = updated;
        $q.notify({ type: 'warning', message: 'Connection closed (history kept)', timeout: 2000 });
      } catch (err) {
        console.error('Failed to close link', err);
        $q.notify({ type: 'negative', message: 'Failed to close connection', timeout: 2500 });
      }
    },
  });
}

async function handleChatPurge(link: Link) {
  selectedLink.value = link;
  const linkId = link.id;

  if (link.status === 'SEVERED') {
    try {
      await vaultStore.purgeLinkLocal(linkId);
      linksStore.markLinkPurgedLocally(linkId);
      await refreshLinks();
      if (selectedLink.value?.id === linkId) {
        selectedLink.value = null;
        vaultStore.setActiveLink(null);
        try {
          localStorage.removeItem('active_chat_link_id');
        } catch {
          /* ignore */
        }
      }
      $q.notify({ type: 'positive', message: 'Chat removed from this device', timeout: 2000 });
    } catch (err) {
      console.error('Failed to purge local chat', err);
      $q.notify({ type: 'negative', message: 'Failed to purge local chat', timeout: 2500 });
    }
    return;
  }

  if (link.status === 'ESTABLISHED' || link.status === 'ANCHORED') {
    try {
      await vaultStore.deleteChatLocal(linkId);
      if (selectedLink.value?.id === linkId) {
        await vaultStore.loadMessages(linkId);
      }
      $q.notify({ type: 'info', message: 'Local messages cleared on this device', timeout: 2000 });
    } catch (err) {
      console.error('Failed to clear local messages', err);
      $q.notify({ type: 'negative', message: 'Failed to clear local messages', timeout: 2500 });
    }
    return;
  }

  try {
    await vaultStore.deleteChatLocal(linkId);
    $q.notify({ type: 'info', message: 'Local messages cleared', timeout: 2000 });
  } catch (err) {
    console.error('Failed to clear local messages', err);
    $q.notify({ type: 'negative', message: 'Failed to clear local messages', timeout: 2500 });
  }
}

async function handleChatRequestRelink(link: Link) {
  selectedLink.value = link;
  await requestRelink();
}

async function purgeCurrentSeveredFromHeader() {
  if (!selectedLink.value || selectedLink.value.status !== 'SEVERED') return;
  await handleChatPurge(selectedLink.value);
}

async function purgeOpenLinkLocalFromHeader() {
  if (!selectedLink.value) return;
  const st = selectedLink.value.status;
  if (st !== 'ESTABLISHED' && st !== 'ANCHORED') return;
  const linkId = selectedLink.value.id;
  try {
    await vaultStore.deleteChatLocal(linkId);
    await vaultStore.loadMessages(linkId);
    $q.notify({ type: 'info', message: 'Local messages cleared on this device', timeout: 2000 });
  } catch (err) {
    console.error('Failed to clear local messages', err);
    $q.notify({ type: 'negative', message: 'Failed to clear local messages', timeout: 2500 });
  }
}

async function handleChatDeleteLocal(link: Link) {
  selectedLink.value = link;
  const linkId = link.id;
  try {
    await vaultStore.deleteChatLocal(linkId);
    $q.notify({ type: 'info', message: 'Local chat deleted', timeout: 2000 });
  } catch (err) {
    console.error('Failed to delete local chat', err);
    $q.notify({ type: 'negative', message: 'Failed to delete local chat', timeout: 2500 });
  }
}

async function allowQuarantine() {
  if (!selectedLink.value) return;
  await vaultStore.allowQuarantinedMessages(selectedLink.value.id);
  showCompromiseModal.value = false;
}

function rejectQuarantine() {
  if (!selectedLink.value) return;
  vaultStore.rejectQuarantinedMessages(selectedLink.value.id);
  showCompromiseModal.value = false;
}
</script>

<style scoped lang="scss">
/* ═══════════════════════════════════════════════════════════════════════════
   VAULT — Messenger UI
   Three-panel layout: Left (channels) | Center (chat) | Right (profile)
   ═══════════════════════════════════════════════════════════════════════════ */

$vault-bg: #000000;
$vault-surface: #080808;
$vault-card: #0c0c0c;
$vault-border: rgb(var(--m-border-rgb, 26 26 26));
$vault-border-hi: rgb(var(--m-borderStrong-rgb, 42 42 42));
$vault-text: rgb(var(--m-text-rgb, 238 238 238));
$vault-muted: rgb(var(--m-legacyVaultMuted-rgb, 119 119 119));
$vault-accent: rgb(var(--m-accent-rgb, 255 0 0));
$vault-accent-lo: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
$vault-accent-faint: rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
$vault-accent-strong: rgb(var(--m-accent-rgb, 255 0 0) / 0.35);
// Security and destructive states must not inherit a decorative client accent.
$vault-danger: #ff0000;
$vault-danger-lo: rgba(255, 0, 0, 0.12);
$vault-danger-faint: rgba(255, 0, 0, 0.08);
$vault-success: #00cc55;
$vault-warning: #ffaa00;

// Preserve legacy picker, loading and pull-indicator colors in default crimson.
:global(html[data-client-theme='on']:is(:not([data-theme='crimson']), [data-theme-accent]) .messaging-page-root) {
  --vault-picker-accent-rgb: var(--m-accent-rgb, 255 0 0);
  --vault-picker-border: rgb(var(--m-accent-rgb, 255 0 0));
  --vault-pull-muted: rgb(var(--m-accent-rgb, 255 0 0) / 0.48);
}

:global(html[data-client-theme='on']:is(:not([data-theme='crimson']), [data-theme-accent]) .messaging-page-root :is(.vault-accent-spinner, .vault-accent-progress)) {
  color: rgb(var(--m-accent-rgb, 255 0 0)) !important;
}

.vault-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: $vault-bg;
  color: $vault-text;
}

/* Single root wrapper (required for Vue <Transition> inside MainLayout).
   Needs explicit full-height so the inner q-page's height:100% doesn't collapse. */
.messaging-page-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.vault-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

/* Offline messages badge — red mono, matches the other offline surfaces. */
.vault-offline-badge {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 9px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  background: rgba(0, 0, 0, 0.55);
  border-left: 2px solid rgb(var(--m-accent-rgb, 255 0 0));
  padding: 4px 8px;
  text-shadow: 0 0 12px rgb(var(--m-accent-rgb, 255 0 0) / 0.5);
}

/* ─── LEFT PANEL ───────────────────────────────────────────────────────── */

.vault-left {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;
  /* Desktop split view. It used to be capped at min(42vw, 360px) with no width
     of its own, which squeezed the row — the decay timer on the right of a chat
     row got clipped at the panel edge in narrower windows. A clamp() floor keeps
     avatar + name/handle + timer readable at any window size, and it still grows
     on wide screens instead of wasting space. */
  width: clamp(320px, 30vw, 420px);
  max-width: none;
  overflow: hidden;
  background: $vault-surface;
  border-right: 1px solid $vault-border;
}

.vault-left-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 12px 16px;
  flex-shrink: 0;
}

/* Right-aligned icon-button group so Discover + Coms Settings sit adjacent
   with a small gap (space-between on the parent kept them far apart). */
.vault-left-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.vault-logo-glyph {
  font-family: monospace;
  font-size: 16px;
  font-weight: 900;
  color: $vault-accent;
  letter-spacing: -0.05em;
  margin-right: 4px;
}

.vault-logo-text {
  font-family: monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: $vault-text;
}

.vault-icon-btn {
  color: $vault-muted !important;
  transition: color 0.15s;
  /* Comfortable touch target — these are the Discover and Coms Settings controls. */
  min-width: 40px;
  min-height: 40px;

  &:hover {
    color: $vault-text !important;
  }
}

/* ─── SUITES TAB (was rendering unstyled — undefined classes) ─── */
.vault-suites-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $vault-border;
}

.vault-suites-title {
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  color: $vault-text;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.vault-discover-btn {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: $vault-accent !important;
  border: 1px solid $vault-accent-lo !important;
  border-radius: 0; /* Mourn: square */
}

.vault-suite-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid $vault-border;
  cursor: pointer;
  background: $vault-surface;
  transition:
    background 0.15s,
    border-color 0.15s;
  border-left: 2px solid transparent;
}

.vault-suite-item:hover {
  background: $vault-card;
  border-left-color: $vault-accent;
}

.vault-suite-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 50%; /* rounded like 1:1 chat avatars */
}
.vault-suite-mourn-logo {
  width: 70%;
  color: $vault-accent;
}

.vault-suite-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vault-suite-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 500;
  color: $vault-text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-suite-sub {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Navigation */
.vault-nav {
  display: flex;
  gap: 2px;
  /* Top padding is the gap between the app header and this tab row. */
  padding: 4px 8px 0;
  flex-shrink: 0;
}

/* ── (⋮) on the tab row ────────────────────────────────────────────────────────
   Global (not mobile-only): it carries Discover + Com settings for desktop too,
   since the brand row those used to live in was removed. */
.vault-nav-more {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: 2px;
}
.vault-nav-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: $vault-muted;
  cursor: pointer;
}
.vault-nav-more-btn.is-open,
.vault-nav-more-btn:active {
  color: $vault-accent;
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.1);
}
.vault-conn-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: center;
  padding: 2px 7px;
  margin-left: 2px;
  border: 1px solid $vault-accent-strong;
  border-radius: 6px;
  font: 600 9px monospace;
  letter-spacing: 0.08em;
  color: $vault-accent;
  background: $vault-accent-faint;
  white-space: nowrap;
}
.vault-nav-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4000;
}
.vault-nav-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 4001;
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 4px;
  border: 1px solid $vault-border;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
}
.vault-nav-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: #d8d8d8;
  font-family: monospace;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.vault-nav-menu-item:active {
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  color: $vault-accent;
}

/* (+) on the chat-filter row + the popup it opens. The popup is a <q-menu>, so it
   is portalled to the body and escapes this row's overflow-x:auto clipping. */
.vault-filter-add-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
.vault-filter-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid $vault-border-hi;
  border-radius: 999px;
  background: none;
  color: $vault-muted;
  cursor: pointer;
}
.vault-filter-add.is-open,
.vault-filter-add:active {
  color: $vault-accent;
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.5);
}
.vault-new-menu {
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 4px;
  border: 1px solid $vault-border;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
}

/* ── New Chat dialog ────────────────────────────────────────────────────────── */
.new-chat-card {
  width: min(420px, calc(100vw - 24px));
}
.new-chat-search {
  margin-bottom: 6px;
}
.new-chat-list {
  height: min(46vh, 360px);
}
.new-chat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid #141414;
}
.new-chat-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.new-chat-name {
  font-size: 12px;
  color: #e6e6e6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.new-chat-handle {
  font-size: 10px;
  color: $vault-muted;
}
.new-chat-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid $vault-border-hi;
  border-radius: 8px;
  background: none;
  color: $vault-muted;
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
}
.new-chat-action.is-goto {
  color: $vault-accent;
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.45);
}
.new-chat-action:disabled {
  opacity: 0.5;
}

.vault-nav-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 4px;
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: $vault-muted;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;

  &:hover {
    color: $vault-text;
    background: rgba(255, 255, 255, 0.03);
  }

  &.active {
    color: $vault-text;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid $vault-accent;
  }
}

.vault-badge {
  font-family: monospace;
  font-size: 8px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: $vault-accent;
  color: #fff;
  border-radius: 2px;
}

.vault-left-divider {
  height: 1px;
  background: $vault-border;
  margin: 4px 0;
  flex-shrink: 0;
}

.vault-left-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Chat-list filter chips (All / Unread / Pinned / Unpinned). */
/* Row wrapper: the chips scroll, the (+) does not. Keeping the (+) out of the
   scroller is what lets its popup anchor to it instead of being clipped. */
.vault-chat-filters-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  flex-shrink: 0;
}

.vault-chat-filters {
  display: flex;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
}

.vault-filter-chip {
  border: 1px solid #1f1f1f;
  background: transparent;
  color: $vault-muted;
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 5px 10px;
  min-height: 30px;
  cursor: pointer;
  white-space: nowrap;
}

.vault-filter-chip.is-active {
  border-color: rgb(var(--m-accent-rgb, 255 0 0));
  color: rgb(var(--m-accent-rgb, 255 0 0));
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.07);
}

.vault-filter-count {
  margin-left: 4px;
  color: rgb(var(--m-accent-rgb, 255 0 0));
}

/* ── Vault tab pager ──────────────────────────────────────────────────────────
   The viewport clips; the track holds one pane per tab side by side and is
   translated by the active tab index plus the live finger offset. Every pane stays
   in the DOM, which is what makes a swipe read as sliding rather than swapping. */
.vault-tabs-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.vault-tabs-track {
  flex: 1;
  min-height: 0;
  display: flex;
  transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

.vault-tabs-track.is-dragging {
  transition: none;
}

.vault-tabs-pane {
  flex: 0 0 100%;
  width: 100%;
  min-width: 100%;
  height: 100%;
}

.vault-pull-indicator {
  flex: 0 0 auto;
  height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vault-pull-muted, #7a3b36);
}

.vault-pull-indicator.is-armed {
  color: rgb(var(--m-accent-rgb, 255 0 0));
}

.vault-scroll {
  flex: 1;
  min-height: 0;
  height: 100%;
}

/* A conversation that moves to the top must SNAP. This used to be a FLIP `move`
   transition, so every row in the list animated whenever ONE chat changed
   position — incoming messages read as the whole chats tab reloading instead of
   just re-ordering. Enter/leave keep their small fade for genuinely new rows. */
.vault-chat-list-move {
  transition: none;
}

.vault-chat-list-enter-active,
.vault-chat-list-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.vault-chat-list-enter-from,
.vault-chat-list-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* Category headers */
.vault-cat {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 4px;
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: $vault-muted;
  user-select: none;

  &--severed {
    color: $vault-danger;
  }
  &--pending {
    color: $vault-warning;
  }
  &--incoming {
    color: $vault-success;
  }
}

.vault-cat-count {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.25);
  margin-left: auto;
}

/* Empty states */
.vault-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px 16px;
  gap: 8px;
}

.vault-empty-icon {
  color: rgba(255, 255, 255, 0.1);
}

.vault-empty-label {
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: $vault-muted;
}

.vault-empty-sub {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
}

.vault-empty-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 14px;
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: $vault-accent;
  background: $vault-accent-lo;
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.25);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
  }
}

/* Signal items */
.vault-signal-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.12s;

  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
}

.vault-signal-avatar {
  border: 1px solid $vault-border;
  border-radius: 50%;
  flex-shrink: 0;
}

.vault-signal-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-signal-name {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: $vault-text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-signal-sub {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
}

.vault-signal-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.vault-signal-accept {
  color: $vault-success !important;

  &:hover {
    background: rgba(0, 204, 85, 0.15) !important;
  }
}

.vault-signal-reject {
  color: $vault-danger !important;

  &:hover {
    background: $vault-danger-lo !important;
  }
}

.vault-pending-badge {
  font-family: monospace;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  background: rgba(255, 170, 0, 0.15);
  color: $vault-warning;
  border: 1px solid rgba(255, 170, 0, 0.3);
  flex-shrink: 0;
}

/* ─── RESIZE HANDLE ────────────────────────────────────────────────────── */

.vault-resize {
  width: 3px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  position: relative;
  z-index: 10;

  &:hover,
  &:active {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
  }
}

/* ─── CENTER PANEL ─────────────────────────────────────────────────────── */

.vault-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: $vault-bg;
}

.vault-center-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.vault-center-empty-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.vault-hex-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid $vault-border;
  color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.02);
}

.vault-center-empty-title {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: $vault-muted;
}

.vault-center-empty-sub {
  font-family: monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
  text-align: center;
  line-height: 1.6;
}

/* Chat header */
.vault-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid $vault-border;
  flex-shrink: 0;
  background: $vault-card;
}

/* In a mobile conversation the global brand header is hidden (mainlayout.scss),
   so this header is the topmost chrome and clears the status bar itself. */
@media (max-width: 1023px) {
  body.vault-chat-open .vault-chat-head {
    padding-top: calc(8px + env(safe-area-inset-top, 0px));
  }
}

.vault-chat-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vault-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: $vault-muted;
  background: transparent;
  border: 1px solid $vault-border;
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    color: $vault-text;
    border-color: $vault-border-hi;
    background: rgba(255, 255, 255, 0.04);
  }
}

.vault-head-avatar {
  border: 1px solid $vault-border;
  border-radius: 50%;
}

.vault-head-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-head-name {
  font-family: monospace;
  font-size: 14px;
  font-weight: 700;
  color: $vault-text;
}

.vault-head-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: $vault-muted;
}

.vault-chat-head-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.vault-anchor-btn {
  font-family: monospace !important;
  font-size: 9px !important;
  letter-spacing: 0.06em !important;
  color: $vault-accent !important;
  padding: 4px 10px !important;
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.3) !important;
  background: $vault-accent-lo !important;

  &:hover {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.2) !important;
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.5) !important;
  }
}

.vault-dropdown-menu {
  background: $vault-card !important;
  border: 1px solid $vault-border;
  font-family: monospace;
  font-size: 12px;
  color: $vault-text;

  :deep(.q-item) {
    min-height: 36px;
    padding: 4px 12px;

    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

.vault-dropdown-sep {
  background: $vault-border !important;
}

/* ─── Message Search Bar ───────────────────────────────────────────────── */

.vault-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid $vault-border;
  background: $vault-card;
  flex-shrink: 0;
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.vault-search-input {
  flex: 1;
  min-width: 0;

  :deep(.q-field__control) {
    display: flex;
    align-items: center;
    font-family: monospace;
    font-size: 12px;
    padding: 4px 8px;
    background: transparent;
    color: $vault-text;
    height: 32px;
  }

  :deep(.q-field__native) {
    background: transparent;
    border: none;
    padding: 0;
    min-height: auto;

    &::placeholder {
      color: $vault-muted;
    }
  }

  &:deep(.q-field--focused) {
    .q-field__native {
      outline: none;
      border-bottom: 2px solid $vault-accent;
    }
  }
}

.vault-search-counter {
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  white-space: nowrap;
  padding: 0 4px;
}

/* Security banners */
.vault-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-family: monospace;
  font-size: 11px;
  flex-shrink: 0;

  &--danger {
    background: $vault-danger-faint;
    border-bottom: 1px solid rgba(255, 0, 0, 0.2);
    color: $vault-danger;
  }

  &--warning {
    background: rgba(255, 170, 0, 0.06);
    border-bottom: 1px solid rgba(255, 170, 0, 0.2);
    color: $vault-warning;
  }
}

.vault-banner-action {
  font-family: monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  cursor: pointer;
  border: 1px solid rgba(255, 0, 0, 0.3);
  background: $vault-danger-lo;
  color: $vault-danger;
  transition: all 0.12s;

  &:hover {
    background: rgba(255, 0, 0, 0.2);
  }

  &--allow {
    border-color: rgba(0, 204, 85, 0.3);
    background: rgba(0, 204, 85, 0.1);
    color: $vault-success;

    &:hover {
      background: rgba(0, 204, 85, 0.2);
    }
  }

  &--reject {
    border-color: rgba(255, 0, 0, 0.3);
    background: $vault-danger-lo;
    color: $vault-danger;
  }
}

/* Messages area */
.vault-messages {
  flex: 1;
  min-height: 0;
  height: 100%;
  position: relative;
}

.vault-messages-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.vault-messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  gap: 12px;
  padding: 40px;
}

.vault-lock-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
  animation: vault-lock-pulse 3s ease-in-out infinite;
}

@keyframes vault-lock-pulse {
  0%,
  100% {
    border-color: rgba(255, 255, 255, 0.05);
  }
  50% {
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  }
}

.vault-messages-empty-title {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: $vault-muted;
}

.vault-messages-empty-sub {
  font-family: monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.2);
  text-align: center;
  line-height: 1.7;
}

/* Message list */
.vault-message-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 16px 20px 8px;
}

.vault-day-sep {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 6px;
  user-select: none;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.07);
  }
}

.vault-day-sep-label {
  font-family: 'Courier New', monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.25);
  white-space: nowrap;
  padding: 0 4px;
}

/* Telegram-style appear for a message entering the DOM (a send, or a new
   arrival). Runs on mount only, so messages already on screen do not re-animate. */
@keyframes vault-msg-appear {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.vault-msg {
  animation: vault-msg-appear 0.16s ease-out;
  position: relative;
  display: flex;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 0;
  transition: background 0.12s;
  margin: 1px 0;

  &:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  &--sent {
    flex-direction: row-reverse;

    .vault-msg-body {
      align-items: flex-end;
    }
    .vault-msg-meta {
      flex-direction: row-reverse;
    }
  }

  &--failed {
    background: rgba(220, 20, 60, 0.1);
    border-left: 2px solid rgba(220, 20, 60, 0.5);
  }
}

.vault-msg-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 50%;
  margin-top: 2px;

  &--unsafe {
    border-color: rgba(255, 0, 0, 0.5) !important;
  }
}

.vault-msg-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 70%;
  min-width: 0;
  width: fit-content;
}

.vault-msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vault-msg-sender {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: $vault-muted;
  letter-spacing: 0.04em;
}

.vault-msg-time {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
  letter-spacing: 0.02em;
}

.vault-msg-bubble {
  font-family: monospace;
  font-size: 13px;
  line-height: 1.55;
  padding: 8px 12px;
  word-break: break-word;
  border: 1px solid $vault-border;
  width: fit-content;
  max-width: 100%;

  &--sent {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.06);
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.15);
    color: $vault-text;
  }

  &--recv {
    background: $vault-card;
    border-color: $vault-border;
    color: $vault-text;
  }

  &--unsafe {
    border-color: rgba(255, 0, 0, 0.5) !important;
    background: $vault-danger-faint !important;
  }

  &--failed {
    background: rgba(220, 20, 60, 0.15);
    border-color: rgba(220, 20, 60, 0.4);
  }
}

/* Mobile rails: the desktop list padding (20px) plus a 40px avatar and 10px gap
   left each bubble ~78px in from the edge — a wide, uneven gutter. Tighten the
   list gutter and the row so incoming and outgoing bubbles sit on even rails;
   the avatar resize mirrors css/messaging-shared.scss (Quasar sizes QAvatar via
   an inline font-size, so the override needs !important). Placed after the base
   rules above so it wins on source order at equal specificity. */
@media (max-width: 1023px) {
  .vault-message-list {
    padding: 12px 10px 10px;
  }

  .vault-msg {
    gap: 8px;
    padding: 3px 4px;
  }

  .vault-msg-avatar {
    font-size: 30px !important;
  }

  .vault-msg-body {
    max-width: 82%;
  }
}

/* Jump to latest */
.vault-jump-btn-wrap {
  position: absolute;
  bottom: 12px;
  right: 20px;
  z-index: 10;
}

.vault-jump-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $vault-card;
  border: 1px solid $vault-border;
  color: $vault-muted;
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    color: $vault-text;
    border-color: $vault-accent;
    background: $vault-accent-lo;
  }
}

.vault-fade-up-enter-active,
.vault-fade-up-leave-active {
  transition: all 0.2s ease;
}

.vault-fade-up-enter-from,
.vault-fade-up-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* Input area */
.vault-input-area {
  --vault-composer-height: 44px;
  flex-shrink: 0;
  padding: 10px 16px 14px;
  border-top: 1px solid $vault-border;
  background: $vault-card;
  position: relative;
}

.vault-input-form {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: var(--vault-composer-height);
}

.vault-input-action-btn {
  width: var(--vault-composer-height);
  height: var(--vault-composer-height);
  min-height: var(--vault-composer-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid $vault-border;
  color: $vault-muted;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;

  &:hover:not(:disabled) {
    color: $vault-accent;
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
    background: $vault-accent-lo;
  }

  &:active:not(:disabled) {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.vault-gif-btn {
  &:hover:not(:disabled) {
    border-color: var(--vault-picker-border, rgb(255 0 0)) !important;
    background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.15) !important;
  }

  &:active:not(:disabled) {
    background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.25) !important;
  }
}

.vault-gif-btn--active:not(:disabled) {
  color: $vault-accent;
  border-color: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.45) !important;
  background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.16) !important;
}

.vault-input-field {
  flex: 1;
  min-width: 0;

  :deep(.q-field__control) {
    font-family: monospace;
    font-size: 14px;
    background: rgba(255, 255, 255, 0.03) !important;
    border: 1px solid $vault-border !important;
    border-radius: 0 !important;
    min-height: var(--vault-composer-height) !important;
    padding: 0 12px !important;
    transition: border-color 0.15s;

    &:focus-within {
      border-color: $vault-accent-strong !important;
    }
  }

  :deep(.q-field__native) {
    color: $vault-text;
    caret-color: $vault-accent;
    box-sizing: border-box;
    min-height: calc(var(--vault-composer-height) - 2px) !important;
    padding-top: 10px !important;
    padding-bottom: 10px !important;
    line-height: 20px;
  }

  :deep(textarea.q-field__native) {
    // Quasar autogrow owns the textarea's inline height after the first line.
    // A border-box 42px base gives the control an exact 44px empty state while
    // still allowing the inline height (and its parent) to grow with content.
    min-height: calc(var(--vault-composer-height) - 2px) !important;
  }

  :deep(.q-field__control::before),
  :deep(.q-field__control::after) {
    display: none;
  }
}

.vault-send-btn {
  width: var(--vault-composer-height);
  height: var(--vault-composer-height);
  min-height: var(--vault-composer-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid $vault-border;
  color: $vault-muted;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    color: $vault-accent;
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
    background: $vault-accent-lo;
  }

  &:active:not(:disabled) {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.15);
    transform: scale(0.95);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

/* Severed input state */
.vault-severed-input {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  font-family: monospace;
  font-size: 12px;
  color: $vault-muted;
}

.vault-severed-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.vault-severed-note {
  font-size: 10px;
  opacity: 0.7;
  font-style: italic;
}

.vault-relink-btn {
  font-family: monospace;
  font-size: 12px;
  color: $vault-accent;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0)) 73.3333333333%, white);
  }
}

/* Expired overlay */
.vault-expired-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 50;
}

.vault-expired-icon {
  color: rgba(255, 0, 0, 0.5);
}

.vault-expired-title {
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $vault-danger;
}

.vault-expired-sub {
  font-family: monospace;
  font-size: 12px;
  color: $vault-muted;
}

.vault-expired-close {
  margin-top: 16px;
  padding: 6px 20px;
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: $vault-accent;
  background: $vault-accent-lo;
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.3);
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
  }
}

/* ─── RIGHT PANEL ──────────────────────────────────────────────────────── */

.vault-right {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: $vault-surface;
  border-left: 1px solid $vault-border;
  transition: width 0.3s ease;
  overflow: hidden;

  &.vault-right--closed {
    width: 0;
    border-left: none;
  }
}

@media (max-width: 1280px) {
  .vault-right {
    display: none;
  }
}

/* ── Mobile composer (WhatsApp/Telegram shape) ────────────────────────────
   Order: [emoji] [input] [+ attach] [send]. No borders and no extra padding on
   the buttons — they are bare glyphs in a tight row, and the input is a
   borderless pill, so the strip reads spacious instead of crowded. Desktop
   keeps the framed composer (these rules are mobile-only). */
@media (max-width: 1023px) {
  /* Single source of truth for the mobile composer padding.
     The bottom number is gesture-pill clearance. Android DOES report a real
     env(safe-area-inset-bottom) here (measured 24px on the test device — the actual
     gesture bar), so the inset alone does the work; the extra 28px that used to sit
     on top of it was pure padding and is what made the strip look blown out. */
  .vault-input-area {
    padding: 4px 6px;
    padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
  }

  /* Keyboard open: the keyboard covers the gesture bar, so that clearance becomes
     dead space above the keys. Capacitor resizes the WebView rather than overlaying
     it, so a short viewport is a reliable "keyboard is up" signal. Keep a small
     but real gap so the composer never sits flush against the keys. */
  @media (max-height: 660px) {
    .vault-input-area {
      padding-bottom: 10px;
    }
  }

  .vault-input-form {
    align-items: flex-end;
    gap: 4px;
  }

  /* Reorder to emoji | input | attach | send without touching the markup, so
     the desktop order is untouched. */
  .vault-input-form > .vault-emoji-btn {
    order: 1;
  }
  .vault-input-form > .vault-input-field {
    order: 2;
  }
  /* (+) now lives inside .vault-attach-wrap so its popup can anchor to it, which
     makes the WRAPPER the flex child — the order has to be set on the wrapper, and
     the sizing rules below must reach through it, or the button falls back to the
     desktop frame (44px boxed) and lands left of the emoji. */
  .vault-input-form > .vault-attach-wrap {
    order: 3;
  }
  .vault-input-form > .vault-send-btn {
    order: 4;
  }
  /* GIF moved into the unified picker's GIF tab on mobile. */
  .vault-input-form > .vault-gif-btn {
    display: none;
  }

  .vault-input-form > .vault-input-action-btn,
  .vault-input-form > .vault-send-btn,
  .vault-input-form > .vault-attach-wrap > .vault-input-action-btn {
    width: 40px;
    height: 40px;
    min-height: 40px;
    border: 0;
    background: transparent;
  }

  .vault-input-field :deep(.q-field__control) {
    border: 0 !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border-radius: 20px !important;
    min-height: 38px !important;
    padding: 0 14px !important;
  }

  .vault-input-field :deep(.q-field__native),
  .vault-input-field :deep(textarea.q-field__native) {
    min-height: 34px !important;
    padding-top: 7px !important;
    padding-bottom: 7px !important;
  }

  /* ── Attach sheet (+) ──────────────────────────────────────────────────────
     Anchored to the (+) button and growing LEFTWARD from it. It used to be
     `left: 0`, which pushed the panel off the right edge of the screen — the
     panel was clipped (squared-off right corners) and the labels were pressed
     against the frame. `right: 0` on the wrapper makes the sheet's right edge
     coincide with the (+) button's right edge, so it always has the send
     button's width as a right-hand margin and can never overhang.
     The backdrop is now a dimming scrim (with a touch of blur) so the sheet
     reads as elevated above the thread instead of floating on live content. */
  .vault-attach-wrap {
    position: relative;
    display: flex;
    flex-shrink: 0;
  }
  .vault-attach-backdrop {
    position: fixed;
    inset: 0;
    z-index: 4000;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    animation: vault-attach-scrim-in 0.14s ease-out;
  }
  .vault-attach-sheet {
    position: absolute;
    bottom: calc(100% + 8px);
    left: auto;
    right: 0;
    transform-origin: bottom right;
    z-index: 4001;
    display: flex;
    flex-direction: column;
    min-width: 152px;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    /* Elevation: a tall soft shadow for lift + a tight contact shadow so the
       sheet separates from the composer it sits on. */
    box-shadow:
      0 14px 40px rgba(0, 0, 0, 0.85),
      0 2px 8px rgba(0, 0, 0, 0.6);
    animation: vault-attach-sheet-in 0.16s cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes vault-attach-scrim-in {
    from {
      opacity: 0;
    }
  }

  @keyframes vault-attach-sheet-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
  }
  .vault-attach-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: 0;
    border-radius: 8px;
    color: #d8d8d8;
    font-family: monospace;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .vault-attach-option:active {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
    color: $vault-accent;
  }

  /* Unified picker: tab bar makes the one panel serve emoji + GIF. */
  .vault-picker-tabs {
    display: flex;
    gap: 4px;
  }
  .vault-picker-tab {
    background: none;
    border: 0;
    padding: 2px 8px;
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: $vault-muted;
    cursor: pointer;
  }
  .vault-picker-tab--active {
    color: $vault-accent;
    border-bottom: 1px solid $vault-accent;
  }
  /* The redundant word-mark would fight the tabs for the same space. */
  .vault-emoji-header .vault-emoji-title {
    display: none;
  }

  /* The picker occupies the keyboard's place: full width, anchored to the
     composer, so opening it reads as replacing the keyboard. */
  .vault-emoji-picker {
    left: 0;
    right: 0;
    width: 100%;
    max-height: 46vh;
    border-left: 0;
    border-right: 0;
  }
}

@media (max-width: 760px) {
  .vault-nav-btn span:not(.vault-badge),
  .vault-logo-text {
    display: none;
  }

  /* NOTE: the composer padding is intentionally NOT set here. A second rule with
     the same specificity later in the file used to override the mobile composer
     padding with 8px + a 28px gesture allowance, which is what made the strip look
     padded out; the padding now lives in one place (the <=1023px block above). */

  .vault-gif-picker {
    right: 8px;
    width: min(340px, calc(100vw - 16px));
    height: min(380px, 58vh);
  }
}

/* Mobile layout = ONE pane at a time, the WhatsApp/Telegram shape. The base
   `.vault-left` is capped at min(42vw, 360px) for the desktop split view, which
   squeezes the list and the chat side by side on a phone; here the list takes
   the full viewport until a conversation is opened, and then yields to it
   entirely — the chat header's back button returns to the list. */
@media (max-width: 1023px) {
  .vault-left {
    width: 100%;
    max-width: none;
  }

  /* Steady state: the list is not rendered at all, so nothing of it can show through
     the conversation (its row borders used to peek past the left edge). */
  .vault-shell.is-mobile-chat-open .vault-left {
    display: none;
  }

  /* Only while the conversation is actually being swiped away is the list rendered
     behind it — that is what makes the exit a reveal instead of a swap. */
  .vault-shell.is-chat-revealing .vault-left {
    display: flex;
    position: absolute;
    inset: 0 auto 0 0;
    width: 100%;
    max-width: none;
    z-index: 0;
  }

  /* Everything that is not the list is the conversation surface on mobile. It slides
     over the list (which stays rendered above) and off again on the way out, so the
     transition reads as sliding rather than swapping. */
  /* The conversation is a full-viewport layer, not a flex sibling.
     As a flex item it had no width of its own (`flex-basis: auto`, no content
     constraint), so it collapsed to a few px and Quasar's scroll-area content
     sized itself to max-content — a 624px-wide thread on a 411px screen, which
     is the "chat expands horizontally" bug. Fixed positioning also means the
     global header/nav no longer have to be display:none'd, so closing a chat
     cannot reflow the app by the header's height (that was the "whole UI slides
     down" jolt). z-index clears Quasar's q-header/q-footer (2000). */
  .vault-shell.is-mobile-chat-open > :not(.vault-left) {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: 100vw;
    z-index: 6000;
    background: $vault-bg;
    transform: translateX(var(--chat-drag, 0px));
    transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  /* Quasar's scroll-area content is absolutely positioned with `min-width: 100%`
     and shrink-to-fit width; left alone it takes the thread's max-content width
     and drags every bubble wider than the viewport. Pin it to the pane.
     `:deep()` is required: the node belongs to the QScrollArea component, so it
     never carries this page's scoped-CSS data attribute. */
  .vault-shell.is-mobile-chat-open .vault-center :deep(.q-scrollarea__content),
  .vault-shell.is-mobile-chat-open .vault-message-list {
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .vault-shell.is-chat-dragging > :not(.vault-left) {
    transition: none;
  }

  /* The 28px back button is a desktop-sized affordance. On touch the *target*
     has to be ~44px, but the visual box must not change — so grow the hit area
     with an overlay instead of the button. */
  .vault-back-btn {
    position: relative;
  }

  .vault-back-btn::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
}

.vault-right-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
}

.vault-right-scroll {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
}

.vault-right-divider {
  height: 1px;
  background: $vault-border;
  margin: 12px 0;
}

/* Panel Sections */
.vault-panel-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  width: 100%;
}

.vault-panel-section-title {
  font-family: monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: $vault-muted;
  margin-bottom: 2px;
}

.vault-panel-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  color: $vault-text;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid $vault-border;
  cursor: pointer;
  transition: all 0.12s;

  span {
    flex: 1;
    text-align: left;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: $vault-border-hi;
  }

  &--danger {
    color: $vault-danger;
    border-color: rgba(255, 0, 0, 0.2);
    background: $vault-danger-lo;

    &:hover {
      background: rgba(255, 0, 0, 0.12);
      border-color: rgba(255, 0, 0, 0.4);
    }
  }
}

/* Session Entropy */
.vault-entropy-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.vault-entropy-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  font-family: monospace;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid $vault-border;
}

.vault-entropy-label {
  color: $vault-muted;
  font-weight: 600;
}

.vault-entropy-value {
  color: $vault-text;
  font-weight: 700;
}

.vault-health-bar {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid $vault-border;
  overflow: hidden;
  margin-bottom: 6px;
}

.vault-health-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #00cc55 0%, $vault-danger 100%);
  transition: width 0.3s ease;
}

.vault-health-label {
  font-family: monospace;
  font-size: 9px;
  color: $vault-muted;
}

/* Verification */
.vault-verify-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  color: $vault-text;
  background: rgba(0, 204, 85, 0.1);
  border: 1px solid rgba(0, 204, 85, 0.3);
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    background: rgba(0, 204, 85, 0.15);
    border-color: $vault-success;
  }

  span {
    flex: 1;
    text-align: left;
  }
}

.vault-verify-hint {
  font-family: monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
}

/* Device List */
.vault-device-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vault-device-item {
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.vault-device-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.vault-device-label {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.vault-device-lastseen {
  font-family: monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.4);
}

.vault-device-fp {
  margin: 2px 0;
}

.vault-empty-devices {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

/* Link Health Info */
.vault-health-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.vault-health-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vault-health-key {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.vault-health-value {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.vault-health-value.status-established {
  color: #00cc55;
}

.vault-health-value.status-anchored {
  color: var(--dash-accent);
}

.vault-health-value.status-pending {
  color: rgb(var(--m-warning-rgb, 255 170 0));
}

.vault-health-value.status-severed {
  color: #cc3333;
}

.vault-health-value.status-unknown {
  color: rgba(255, 255, 255, 0.4);
}

/* Fingerprint Modal */
.vault-fingerprint-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid $vault-border;
  font-family: 'Cascadia Code', 'Courier New', monospace;
}

.vault-fingerprint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.vault-fingerprint-label {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: $vault-muted;
}

.vault-fingerprint-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: $vault-accent-faint;
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
  color: $vault-muted;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;

  &:hover {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.15);
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
    color: $vault-text;
  }
}

.vault-fingerprint-value {
  font-family: 'Cascadia Code', 'Courier New', monospace;
  font-size: 10px;
  color: $vault-text;
  word-break: break-all;
  line-height: 1.4;
}

/* Profile card */
.vault-profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 16px;
  gap: 4px;
}

.vault-profile-pic-wrap {
  position: relative;
  margin-bottom: 8px;
}

.vault-profile-pic {
  border: 2px solid $vault-border;
  border-radius: 50%;
}

.vault-profile-status-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border: 2px solid $vault-surface;
  border-radius: 50%;
  background: $vault-success;

  &--anchored {
    background: $vault-accent;
  }
  &--severed {
    background: $vault-muted;
  }
}

.vault-profile-display {
  font-family: monospace;
  font-size: 14px;
  font-weight: 700;
  color: $vault-text;
  text-align: center;
}

.vault-profile-username {
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
}

.vault-profile-divider {
  width: 100%;
  height: 1px;
  background: $vault-border;
  margin: 12px 0;
}

.vault-profile-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 4px;
}

.vault-profile-section-title {
  font-family: monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: $vault-muted;
  margin-bottom: 2px;
}

.vault-profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);

  &--danger {
    color: $vault-danger;
  }
}

.vault-profile-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    color: $vault-text;
    background: rgba(255, 255, 255, 0.04);
    border-color: $vault-border;
  }

  &--danger {
    color: rgba(255, 0, 0, 0.6);

    &:hover {
      color: $vault-danger;
      background: $vault-danger-lo;
      border-color: rgba(255, 0, 0, 0.2);
    }
  }
}

/* ─── MODALS ───────────────────────────────────────────────────────────── */

.vault-modal {
  background: $vault-card !important;
  border: 1px solid $vault-border;
  color: $vault-text;
  width: 420px;
  max-width: 95vw;
  font-family: monospace;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
}

.vault-modal-head {
  border-bottom: 1px solid $vault-border;
  background: rgba(0, 0, 0, 0.4);
  padding: 14px 20px;

  &--danger {
    border-bottom-color: rgba(255, 0, 0, 0.2);
  }
}

.vault-modal-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $vault-text;

  .vault-modal-head--danger & {
    color: $vault-danger;
  }
}

.vault-modal-body {
  padding: 20px;
}

.vault-modal-desc {
  font-size: 12px;
  line-height: 1.6;
  color: $vault-muted;
  margin-bottom: 16px;
}

.vault-modal-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vault-radio {
  font-size: 11px !important;
}

.vault-hours-input {
  margin-left: 32px;
  max-width: 120px;

  :deep(.q-field__control) {
    font-family: monospace;
    font-size: 11px;
    border-radius: 0 !important;
  }
}

.vault-modal-actions {
  border-top: 1px solid $vault-border;
  background: rgba(0, 0, 0, 0.4);
  padding: 10px 16px;
}

.vault-modal-btn {
  font-family: monospace !important;
  font-size: 10px !important;
  letter-spacing: 0.08em !important;
  color: $vault-muted !important;

  &--primary {
    color: $vault-accent !important;
  }

  &--danger {
    color: $vault-danger !important;
  }
}

/* Compromise modal actions */
.vault-compromise-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vault-compromise-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  background: transparent;
  border: 1px solid $vault-border;
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: $vault-border-hi;
  }

  &--safe {
    border-color: rgba(0, 204, 85, 0.3);
    color: $vault-success;

    &:hover {
      background: rgba(0, 204, 85, 0.1);
    }
  }

  &--temp {
    border-color: rgba(255, 170, 0, 0.3);
    color: $vault-warning;

    &:hover {
      background: rgba(255, 170, 0, 0.08);
    }
  }

  &--danger {
    border-color: rgba(255, 0, 0, 0.3);
    color: $vault-danger;

    &:hover {
      background: $vault-danger-lo;
    }
  }
}

/* ─── REPLY BAR ────────────────────────────────────────────────────────── */

.vault-reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid $vault-border;
  border-left: 2px solid $vault-accent;
}

.vault-reply-bar-icon {
  color: $vault-accent;
  flex-shrink: 0;
}

.vault-reply-bar-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-reply-bar-name {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: $vault-accent;
}

.vault-reply-bar-text {
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-reply-bar-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: $vault-muted;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.12s;

  &:hover {
    color: $vault-text;
  }
}

/* ─── REPLY REFERENCE (in message) ─────────────────────────────────────── */

.vault-reply-ref {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
  max-width: 100%;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-left-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.7);
  }

  &:active {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.06);
  }
}

.vault-reply-ref-icon {
  color: $vault-accent;
  flex-shrink: 0;
}

.vault-reply-ref-name {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: $vault-accent;
  flex-shrink: 0;
}

.vault-reply-ref-text {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
  white-space: nowrap;
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  text-overflow: ellipsis;
}

/* ─── RICH MESSAGE CONTENT ─────────────────────────────────────────────── */

.vault-msg-text {
  word-break: break-word;

  :deep(.vault-mention) {
    color: $vault-accent;
    font-weight: 600;
    padding: 0 2px;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.12s;

    &:hover {
      background: $vault-accent-lo;
    }
  }

  :deep(.vault-link) {
    color: #6699ff;
    text-decoration: none;
    border-bottom: 1px solid rgba(102, 153, 255, 0.3);
    transition: border-color 0.12s;

    &:hover {
      border-color: #6699ff;
    }
  }
}

.vault-remote-media-consent {
  margin-top: 6px;
  padding: 5px 8px;
  border: 1px solid $vault-border;
  border-radius: 2px;
  background: transparent;
  color: $vault-muted;
  font: inherit;
  font-size: 11px;
  cursor: pointer;

  &:hover {
    border-color: $vault-border-hi;
    color: $vault-text;
  }
}

.vault-msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.vault-msg-image {
  max-width: 300px;
  max-height: 200px;
  object-fit: contain;
  border: 1px solid $vault-border;
  cursor: pointer;
  transition:
    border-color 0.12s,
    filter 0.15s;
  border-radius: 2px;

  &:hover {
    border-color: $vault-border-hi;
    filter: brightness(1.05);
  }
}

.vault-msg-videos {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.vault-msg-video {
  max-width: 360px;
  max-height: 240px;
  border: 1px solid $vault-border;
  background: #000;
  outline: none;
}

.vault-msg-gif {
  border-radius: 4px;
}

.vault-gif-loader-wrapper {
  position: relative;
  display: inline-block;
}

.vault-gif-loading-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}

.vault-video-wrapper {
  position: relative;
  max-width: 400px;
  border: 1px solid $vault-border;
  background: #000;
  overflow: hidden;

  &:hover .vault-video-controls {
    opacity: 1;
  }
}

.vault-video-el {
  width: 100%;
  max-height: 280px;
  display: block;
  outline: none;
}

.vault-video-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.85);
  opacity: 0;
  transition: opacity 0.2s;
}

.vault-vc-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.12s;

  &:hover {
    color: #fff;
  }
}

.vault-vc-progress {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
  position: relative;
}

.vault-vc-progress-bar {
  height: 100%;
  background: $vault-accent;
  transition: width 0.1s linear;
}

.vault-vc-time {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 32px;
  text-align: center;
  flex-shrink: 0;
}

/* ─── REACTIONS ────────────────────────────────────────────────────────── */

.vault-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  position: relative;
  z-index: 1;
}

.vault-reaction-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  &--mine {
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.3);
    background: $vault-accent-faint;
  }
}

.vault-reaction-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.vault-emoji-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.vault-emoji-icon--sm {
  width: 16px;
  height: 16px;
}

.vault-emoji-icon--lg {
  width: 22px;
  height: 22px;
}

.vault-reaction-count {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.vault-reaction-bar {
  position: absolute;
  top: -4px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: #0c0c0c;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  z-index: 5;
}

.vault-reaction-bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 14px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}

.vault-reaction-bar-plus {
  color: rgba(255, 255, 255, 0.4);

  &:hover {
    color: rgba(255, 255, 255, 0.7);
  }
}

.vault-failed-bar {
  position: absolute;
  top: -4px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: rgba(220, 20, 60, 0.2);
  border: 1px solid rgba(220, 20, 60, 0.4);
  border-radius: 4px;
  z-index: 5;
}

.vault-failed-bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;
  color: rgba(220, 20, 60, 0.7);

  &:hover {
    background: rgba(220, 20, 60, 0.3);
    color: rgba(220, 20, 60, 1);
  }
}

.vault-fade-enter-active,
.vault-fade-leave-active {
  transition: opacity 0.15s;
}

.vault-fade-enter-from,
.vault-fade-leave-to {
  opacity: 0;
}

/* ─── CONTEXT MENU REACTIONS ───────────────────────────────────────────── */

.vault-ctx-reactions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
}

.vault-ctx-emoji {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}

.vault-ctx-emoji-plus {
  color: rgba(255, 255, 255, 0.4);

  &:hover {
    color: rgba(255, 255, 255, 0.7);
  }
}

/* ─── EMOJI PICKER ─────────────────────────────────────────────────────── */

.vault-context-emoji-picker {
  position: fixed;
  z-index: 10000;
  width: 250px;
  max-height: 280px;
  overflow-y: auto;
  background: rgb(var(--m-elevated-rgb, 10 10 10));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
  padding: 8px;
}

.vault-context-emoji-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.vault-context-emoji-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 0;
  transition: background 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}

.vault-msg-embed {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid rgba(102, 153, 255, 0.4);
  transition: background 0.12s;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
}

.vault-embed-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 2px;
}

.vault-embed-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-embed-link {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: #6699ff;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.12s;

  &:hover {
    color: #88bbff;
  }
}

.vault-embed-path {
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-embed-external {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.2);
}

/* ─── CONTEXT MENU ─────────────────────────────────────────────────────── */

.vault-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.vault-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  background: #0c0c0c;
  border: 1px solid $vault-border;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
  padding: 4px 0;
}

.vault-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  font-family: monospace;
  font-size: 12px;
  color: $vault-text;
  background: none;
  border: none;
  cursor: pointer;
  transition: background 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  &--danger {
    color: $vault-danger;

    &:hover {
      background: $vault-danger-lo;
    }
  }
}

.vault-ctx-sep {
  height: 1px;
  background: $vault-border;
  margin: 4px 0;
}

/* ─── IMAGE PREVIEW ────────────────────────────────────────────────────── */

.vault-image-preview {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.97);
  cursor: pointer;
  overflow: hidden;
}

.vault-image-preview-img {
  max-width: 90vw;
  max-height: calc(100vh - 180px);
  object-fit: contain;
  cursor: default;
  transition: transform 0.2s ease;
  animation: vault-img-fade-in 0.3s ease;
}

@keyframes vault-img-fade-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.vault-image-preview-close {
  position: absolute;
  top: 60px;
  right: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $vault-text;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  transition: all 0.15s;
  z-index: 10;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }
}

.vault-image-preview-controls {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 10;

  button {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.6);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.12s;

    &:hover {
      color: $vault-text;
    }
  }
}

.vault-image-zoom-label {
  font-family: monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 40px;
  text-align: center;
  user-select: none;
}

/* ─── MESSAGE HIGHLIGHT (scroll-to animation) ──────────────────────────── */

.vault-msg--highlight {
  animation: vault-highlight-flash 1.8s ease;
}

@keyframes vault-highlight-flash {
  0% {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.15);
  }
  20% {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  }
  50% {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.06);
  }
  100% {
    background: transparent;
  }
}

/* ─── GIF PICKER ───────────────────────────────────────────────────────── */

.vault-gif-picker {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 8px);
  width: min(360px, calc(100vw - 32px));
  height: min(420px, 62vh);
  background: rgb(var(--m-elevated-rgb, 10 10 10));
  border: 1px solid $vault-border;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  z-index: 40;
}

.vault-gif-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid $vault-border;
}

.vault-gif-search {
  flex: 1;

  :deep(.q-field__control) {
    font-family: monospace;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.03) !important;
    border: 1px solid $vault-border !important;
    border-radius: 0 !important;
    min-height: 32px !important;
    padding: 0 8px !important;
  }

  :deep(.q-field__native) {
    color: $vault-text;
  }

  :deep(.q-field__control::before),
  :deep(.q-field__control::after) {
    display: none;
  }
}

.vault-gif-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: $vault-muted;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: $vault-text;
  }
}

.vault-gif-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vault-gif-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
  align-content: start;
}

.vault-gif-item {
  width: 100%;
  height: 112px;
  object-fit: cover;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    border-color 0.12s,
    transform 0.12s;
  border-radius: 2px;

  &:hover {
    border-color: $vault-accent;
    transform: scale(1.03);
  }
}

/* ─── EMOJI PICKER ─────────────────────────────────────────────────────── */

.vault-emoji-btn {
  &:hover:not(:disabled) {
    border-color: var(--vault-picker-border, rgb(255 0 0)) !important;
    background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.15) !important;
  }

  &:active:not(:disabled) {
    background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.25) !important;
  }
}

.vault-emoji-btn--active:not(:disabled) {
  color: $vault-accent;
  border-color: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.45) !important;
  background: rgb(var(--vault-picker-accent-rgb, 220 20 60) / 0.16) !important;
}

.vault-emoji-picker {
  position: absolute;
  right: 44px;
  bottom: calc(100% + 8px);
  width: min(320px, calc(100vw - 32px));
  max-height: min(320px, 50vh);
  background: rgb(var(--m-elevated-rgb, 10 10 10));
  border: 1px solid $vault-border;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  z-index: 40;
}

/* Tab bar for the unified composer picker. Hidden by default (desktop keeps the
   separate emoji / GIF buttons); shown on mobile where the panel replaces the
   keyboard. */
.vault-picker-tabs {
  display: none;
}

.vault-emoji-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid $vault-border;
}

.vault-emoji-title {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $vault-muted;
}

.vault-emoji-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
  padding: 10px;
  overflow-y: auto;
  align-content: start;
}

.vault-emoji-cell {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  background: none;
  border: 1px solid transparent;
  border-radius: 0; /* Mourn: square corners */
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: $vault-border-hi;
  }
}

.vault-gif-placeholder {
  background-color: rgba(128, 128, 128, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  border-color: transparent !important;
  transform: none !important;

  &:hover {
    transform: none !important;
  }
}

.vault-gif-skeleton {
  width: 80%;
  height: 80%;
  background: linear-gradient(
    90deg,
    rgba(200, 200, 200, 0.4) 0%,
    rgba(150, 150, 150, 0.4) 50%,
    rgba(200, 200, 200, 0.4) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: 2px;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.vault-gif-empty {
  grid-column: 1 / -1;
  text-align: center;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  padding: 24px;
}

.vault-gif-footer {
  padding: 4px 12px;
  border-top: 1px solid $vault-border;
  text-align: right;
}

/* ─── GROUP DISCOVER POPUP (was unstyled → white square) ─── */
.group-discover-dialog .q-card,
.group-discover-card {
  background: $vault-surface; /* --dash-panel */
  border: 1px solid $vault-border; /* --dash-border */
  border-radius: 0; /* Mourn: square */
  color: $vault-text;
  min-width: 420px;
  max-width: 92vw;
}

.group-discover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $vault-border;
}

.group-discover-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-discover-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 14px;
  font-weight: 600;
  color: $vault-text;
  letter-spacing: 0.05em;
}

.group-discover-search {
  padding: 12px 16px 0;
}

:deep(.group-discover-search .q-field__control) {
  background: $vault-card;
  border-color: $vault-border;
}

:deep(.group-discover-search .q-field__control:hover) {
  border-color: $vault-border-hi;
}

.group-discover-body {
  padding: 0;
  min-height: 280px;
  max-height: 56vh;
}

.group-discover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 240px;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.group-discover-list {
  display: flex;
  flex-direction: column;
}

.group-discover-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid $vault-border;
  transition: background 0.15s;
}

.group-discover-item:hover {
  background: $vault-card;
}

.group-discover-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 0;
}

.group-discover-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-discover-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 500;
  color: $vault-text;
}

.group-discover-description {
  color: #8a8a8a;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-discover-sub {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.group-discover-requested {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted !important;
}

.vault-create-btn {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: $vault-accent !important;
  border: 1px solid $vault-accent-lo !important;
  border-radius: 0;
}

/* ─── CREATE SUITE POPUP ─── */
.create-suite-dialog .q-card,
.create-suite-card {
  background: $vault-surface;
  border: 1px solid $vault-border;
  border-radius: 0;
  color: $vault-text;
  /* `min-width: 440px` on a 411px phone forced the card wider than the screen,
     so the member list and the footer ran off the edge and the dialog read as
     "huge". Size against the viewport instead, and let the card scroll rather
     than clip when the stages stack up. */
  width: min(560px, 96vw);
  min-width: 0;
  max-width: 96vw;
  max-height: 92vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.create-suite-stage {
  padding: 0;
  min-height: 320px;
}

.create-suite-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $vault-border;
}

.create-suite-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 14px;
  font-weight: 600;
  color: $vault-text;
  letter-spacing: 0.05em;
}

.create-suite-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid $vault-border;
}

.create-suite-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 4px;
  background: $vault-card;
  border: 1px solid $vault-accent-lo;
  border-radius: 0;
}

.create-suite-chip-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 0;
}

.create-suite-chip-name {
  font-family: monospace;
  font-size: 12px;
  color: $vault-text;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-suite-chip-remove {
  color: $vault-muted !important;
}

.create-suite-chip-remove:hover {
  color: $vault-accent !important;
}

.create-suite-search {
  padding: 12px 16px;
}

:deep(.create-suite-search .q-field__control) {
  background: $vault-card;
  border-color: $vault-border;
}

:deep(.create-suite-search .q-field__control:hover) {
  border-color: $vault-border-hi;
}

.create-suite-list {
  height: 46vh;
  padding: 0 8px 8px;
}

/* Short phones (and any phone with the IME open) can't give the candidate list
   46vh without pushing the footer off the card. */
@media (max-height: 700px) {
  .create-suite-list {
    height: 36vh;
  }
}

.create-suite-cand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid $vault-border;
  transition: background 0.15s;
}

.create-suite-cand:hover {
  background: $vault-card;
}

.create-suite-cand.is-added {
  opacity: 0.55;
}

.create-suite-cand-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 0;
}

.create-suite-cand-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.create-suite-cand-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 500;
  color: $vault-text;
}

.create-suite-cand-handle {
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
}

.create-suite-cand-add {
  color: $vault-muted !important;
}

.create-suite-cand-add:hover {
  color: $vault-accent !important;
}

.create-suite-cand-added {
  color: $vault-accent;
}

.create-suite-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.create-suite-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.create-suite-label {
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

:deep(.create-suite-field .q-field__control) {
  background: $vault-card;
  border-color: $vault-border;
}

:deep(.create-suite-field .q-field--focused .q-field__control) {
  border-color: $vault-accent;
}

.create-suite-permissions-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid $vault-border;
  background: $vault-card;
  padding: 8px 10px;
}

.create-suite-perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  text-transform: lowercase;
}

.create-suite-perm-val {
  color: $vault-text;
  letter-spacing: 0.03em;
}

.create-suite-visibility {
  border: 1px solid $vault-border;
  border-radius: 0; /* Mourn: square */
  font-family: monospace;

  :deep(.q-btn-item) {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: $vault-muted;
  }

  :deep(.q-btn-item.bg-primary) {
    color: #fff;
    font-weight: 600;
  }
}

.create-suite-hint {
  font-family: monospace;
  font-size: 9px;
  color: $vault-muted;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

.create-suite-footer {
  padding: 12px 16px;
  border-top: 1px solid $vault-border;
}

.vault-gif-powered {
  font-family: monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.2);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.vault-slide-up-enter-active,
.vault-slide-up-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.vault-slide-up-enter-from,
.vault-slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}

/* ─── FILE TRANSFERS ───────────────────────────────────────────────────── */

.vault-transfers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.vault-transfer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid $vault-border;
  font-family: monospace;
  font-size: 10px;
  color: $vault-muted;
}

.vault-transfer-name {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: $vault-text;
}

.vault-transfer-size {
  flex-shrink: 0;
  color: $vault-muted;
}

.vault-transfer-bar {
  flex: 1;
  min-width: 60px;
}

.vault-transfer-pct {
  flex-shrink: 0;
  min-width: 30px;
  text-align: right;
}

.vault-transfer-dl {
  color: $vault-accent;
  display: flex;
  align-items: center;

  &:hover {
    color: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0)) 73.3333333333%, white);
  }
}

.vault-transfer-err {
  color: $vault-danger;
  font-weight: 600;
}

/* ─── BLOB ATTACHMENT ──────────────────────────────────────────────────── */

.vault-blob-attachment {
  margin-top: 6px;
}

/* Shared media box. Images and videos are ONE box: a border + 2px radius that
   matches the inline `.vault-msg-image` pattern, with the media flush inside so
   it reads as a single object rather than "media + a metadata strip". */
.vault-blob-media {
  position: relative;
  margin-bottom: 6px;
  max-width: 320px;
  border: 1px solid $vault-border;
  border-radius: 2px;
  overflow: hidden;
  background: #000;
  line-height: 0;

  img,
  video {
    display: block;
    max-width: 100%;
    border: 0;
    border-radius: 0;
  }

  img {
    cursor: pointer;
  }

  &--image img {
    max-height: 260px;
    object-fit: contain;
  }
}

.vault-blob-media-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  min-height: 80px;
  margin-bottom: 0;
}

/* A blob the server has already deleted (404 after claim / TTL). Permanent, so
   say so instead of spinning forever. */
.vault-blob-media-unavailable {
  flex-direction: column;
  gap: 6px;
  color: #6b6b6b;
}

.vault-blob-unavailable-text {
  font: 11px monospace;
  color: #6b6b6b;
}

.vault-audio-time--state {
  font-style: italic;
}

/* Save overlay on the media box: hidden until hover (desktop). On mobile the
   full-screen preview owns the save action (tap the image to open it). */
.vault-blob-media-save {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  color: $vault-text;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    background 0.12s;

  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.85);
  }

  &:disabled {
    cursor: wait;
  }
}

.vault-blob-media:hover .vault-blob-media-save {
  opacity: 1;
}

/* Non-media file: a compact row that is ALWAYS visible. It used to be
   hover-revealed, which meant it was permanently invisible on a touch device
   (and the bubble read as an empty dark rectangle). */
.vault-blob-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  padding: 6px 10px;
  border: 1px solid $vault-border;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
}

.vault-blob-file-icon {
  flex-shrink: 0;
  color: $vault-muted;
}

.vault-blob-file-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.vault-blob-size {
  margin-left: 0;
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.vault-blob-filename {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  font-family: monospace;
  font-size: 12px;
  color: $vault-muted;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── Inline audio player (Discord-style) ─────────────────────────────────── */
.vault-audio-player {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: min(280px, 62vw);
  max-width: 320px;
  padding: 8px 10px;
  border: 1px solid $vault-border;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);

  /* The <audio> element is the playback engine only — the visible controls are
     the custom play button + seekable track above. */
  audio {
    display: none;
  }
}

.vault-audio-play {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  background: $vault-accent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition:
    filter 0.12s,
    opacity 0.12s;

  &:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
}

.vault-audio-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.vault-audio-track {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;

  /* Taller invisible hit area so a thumb can seek a 4px bar. */
  &::before {
    content: '';
    position: absolute;
    inset: -8px 0;
  }
}

.vault-audio-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: $vault-accent;
  transition: width 0.08s linear;
}

.vault-audio-knob {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: $vault-accent;
  transform: translateY(-50%);
  transition: left 0.08s linear;
  pointer-events: none;
}

.vault-audio-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vault-audio-name {
  min-width: 0;
  overflow: hidden;
  font-family: monospace;
  font-size: 11px;
  color: $vault-muted;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.vault-audio-time {
  flex-shrink: 0;
  font-family: monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.vault-video-wrapper--expanded {
  max-width: min(92vw, 720px);

  .vault-video-el {
    max-height: 70vh;
  }
}

.vault-video-preview-el {
  max-width: 92vw;
  max-height: calc(100vh - 180px);
  outline: none;
}

.vault-blob-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: $vault-text;
  background: $vault-accent-faint;
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;

  &:hover:not(:disabled) {
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.15);
    border-color: $vault-accent-strong;
  }

  &:disabled {
    opacity: 0.5;
    cursor: wait;
  }
}

.vault-blob-spinner {
  animation: vault-spin 0.8s linear infinite;
}

.vault-image-preview-header {
  position: absolute;
  top: 72px;
  left: 16px;
  color: $vault-text;
  font-family: monospace;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.4);
  padding: 6px 10px;
  border-radius: 6px;
  max-width: 70vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 11;
  pointer-events: none;
}

.vault-transfer-remove {
  background: transparent;
  border: none;
  color: $vault-muted;
  cursor: pointer;
  padding: 4px;
  margin-left: 8px;
}

.vault-transfer-remove:hover {
  color: $vault-text;
}

@keyframes vault-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ─── MARKDOWN CONTENT STYLES ──────────────────────────────────────────── */

.vault-msg-text {
  :deep(p) {
    margin: 0 0 4px;
    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 4px 0 2px;
    font-weight: 700;
    color: $vault-text;
    line-height: 1.3;
  }

  :deep(h1) {
    font-size: 18px;
  }
  :deep(h2) {
    font-size: 16px;
  }
  :deep(h3) {
    font-size: 14px;
  }
  :deep(h4) {
    font-size: 13px;
  }
  :deep(h5),
  :deep(h6) {
    font-size: 12px;
    color: $vault-muted;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  :deep(strong) {
    font-weight: 700;
  }
  :deep(em) {
    font-style: italic;
  }
  :deep(del),
  :deep(s) {
    text-decoration: line-through;
    color: $vault-muted;
  }

  :deep(code) {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 2px;
    color: #e8a0bf;
  }

  :deep(pre) {
    margin: 4px 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid $vault-border;
    border-radius: 0;
    overflow-x: auto;
    max-width: 100%;

    code {
      background: none;
      padding: 0;
      border-radius: 0;
      color: #c8c8c8;
      display: block;
      white-space: pre;
      font-size: 12px;
    }
  }

  :deep(blockquote) {
    margin: 4px 0;
    padding: 2px 10px;
    border-left: 3px solid $vault-accent;
    color: $vault-muted;
    font-style: italic;
  }

  :deep(ul),
  :deep(ol) {
    margin: 4px 0;
    padding-left: 20px;
  }

  :deep(li) {
    margin: 1px 0;
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid $vault-border;
    margin: 6px 0;
  }

  :deep(a) {
    color: $vault-accent;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: opacity 0.12s;

    &:hover {
      opacity: 0.7;
    }
  }

  :deep(small),
  :deep(.vault-subtext) {
    display: block;
    font-size: 10px;
    color: $vault-muted;
    line-height: 1.25;
    opacity: 0.82;
  }
}

/* ── Suite right-click context menu ─────────────────────────────── */
.suite-ctx-menu {
  position: fixed;
  z-index: 4000;
  background: $vault-card;
  border: 1px solid $vault-border;
  border-radius: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  min-width: 170px;
}
.suite-ctx-list {
  background: $vault-card;
  color: $vault-text;
  font-family: monospace;
  padding: 4px 0;
}
.suite-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  letter-spacing: 0.02em;
  cursor: pointer;
  user-select: none;
}
.suite-ctx-item:hover {
  background: $vault-surface;
}
.suite-ctx-item .q-icon {
  color: $vault-muted;
}
.suite-ctx-item.suite-ctx-danger .q-icon,
.suite-ctx-item.suite-ctx-danger span {
  color: $vault-danger;
}
/* Reporting a suite is not destructive — amber, matching the message context
   menu's report item. */
.suite-ctx-item.suite-ctx-report .q-icon,
.suite-ctx-item.suite-ctx-report span {
  color: rgb(var(--m-warning-rgb, 255 170 0));
}
.suite-ctx-item.suite-ctx-report:hover {
  background: rgba(255, 170, 0, 0.12);
}
.suite-ctx-sep {
  height: 1px;
  background: $vault-border;
  margin: 4px 0;
}

/* ── Invite-to-existing-group dialog ───────────────────────────── */
.group-invite-card,
.group-leave-card,
.coms-settings-card {
  background: $vault-card;
  border: 1px solid $vault-border;
  border-radius: 0;
  color: $vault-text;
  font-family: monospace;
}
/* Coms Settings dialog — force the dark $vault-* theme on every surface.
   Without these the q-card/q-separator/q-card-actions default to Quasar's
   light palette and render as a white blob (undefined --dash-* tokens in
   MessingPage's $vault-* scope). Mirrors the group-invite/leave-card styling. */
.coms-settings-card :deep(.q-card__section),
.coms-settings-card :deep(.q-card__actions) {
  background: transparent;
  color: $vault-text;
}
.coms-settings-card :deep(.q-separator) {
  background: $vault-border;
}
.coms-settings-card .coms-settings-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: $vault-text;
}
.coms-settings-card .coms-settings-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.coms-settings-card .coms-settings-label > span:first-child {
  font-size: 13px;
  color: $vault-text;
}
.coms-settings-card .coms-settings-desc {
  font-size: 11px;
  color: $vault-muted;
}
.coms-settings-card .coms-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.group-invite-results {
  max-height: 280px;
  margin-top: 8px;
  overflow-y: auto;
}
.group-invite-user {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.group-invite-user:hover {
  background: $vault-surface;
  border-color: $vault-border-hi;
}
.group-invite-user-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: $vault-text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.group-invite-user-handle {
  font-size: 11px;
  color: $vault-muted;
}
.group-invite-user-add {
  font-size: 11px;
  color: $vault-accent;
  white-space: nowrap;
}

/* ── Leave-group confirm ───────────────────────────────────────── */
.group-leave-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: $vault-text;
}
.group-leave-title .q-icon {
  color: $vault-danger;
}
.group-leave-body {
  margin: 10px 0 0;
  font-size: 12px;
  color: $vault-muted;
  line-height: 1.4;
}

.suite-right-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.suite-right-actions :deep(.q-btn) {
  width: 100%;
}

/* Suite panel member list (mirrors the members tab in Suite settings) */
.suite-panel-members {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.suite-panel-category {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 4px;
  color: $vault-muted;
  font: 700 9px/1.3 monospace;
  letter-spacing: 0.12em;
}
.suite-panel-category-count {
  color: $vault-muted;
}
.suite-panel-member {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 6px 8px;
  border-bottom: 1px solid $vault-border;
}
.suite-panel-member:hover {
  background: rgba(255, 255, 255, 0.02);
}
.suite-panel-member-avatar {
  flex-shrink: 0;
  border: 1px solid $vault-border;
  border-radius: 50%;
}
.suite-panel-member-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.suite-panel-member-name {
  overflow: hidden;
  color: $vault-text;
  font: 600 12px monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suite-panel-member-handle {
  color: $vault-muted;
  font: 10px monospace;
}
.suite-role-badge {
  flex-shrink: 0;
  padding: 3px 6px;
  border: 1px solid $vault-border;
  color: $vault-muted;
  font: 700 8px monospace;
}
.suite-role-badge--owner {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
  color: $vault-accent;
}
.suite-role-badge--admin {
  border-color: rgba(255, 170, 0, 0.35);
  color: $vault-warning;
}

/* ---- Broadcast member-picker dialog ---- */
.broadcast-members-card {
  width: min(480px, 92vw);
  max-width: 92vw;
}
.broadcast-members-scroll {
  max-height: 60vh;
  padding: 4px 8px;
}
.broadcast-member-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.suite-role-badge--action {
  cursor: pointer;
  border-color: $vault-border;
  color: $vault-muted;
  text-transform: none;
  line-height: 1;
}
.suite-role-badge--action:hover {
  border-color: $vault-accent-strong;
  color: $vault-accent;
}
.suite-role-badge--danger {
  border-color: rgba(255, 0, 0, 0.4);
  color: #ff5252;
}
.suite-role-badge--danger:hover {
  background: rgba(255, 0, 0, 0.1);
}
.suite-panel-empty {
  padding: 24px;
  color: $vault-muted;
  font: 12px monospace;
  text-align: center;
}

/* Drop-to-send overlay — same visual language as the vault establishing box */
.vault-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.82);
}

.vault-drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 38px;
  background: rgb(var(--m-elevated-rgb, 10 10 10));
  border: 1px dashed $vault-accent;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.72);
}

.vault-drop-icon {
  color: $vault-accent;
}

.vault-drop-title {
  font-family: monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: $vault-text;
}

.vault-drop-sub {
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: $vault-muted;
}

/* ── Mobile emoji/GIF panel: Telegram shape ──────────────────────────────────
   Full-width panel that takes the keyboard's place — search + EMOJI/GIF segment
   on top, grid in the middle, category bar pinned to the bottom. Overrides the
   desktop popover positioning, which was a 320px box floating above the composer. */
@media (max-width: 1023px) {
  /* The panel takes the keyboard's exact place. Reserving its height as padding
     under the composer is what keeps the composer at the SAME Y it had while the
     keyboard was open — the panel fills the reserved strip instead of floating. */
  .vault-input-area {
    /* Android animates its own resize (~200ms) when the keyboard hides. Applying
       the reserved strip instantly made the composer follow the viewport down and
       then snap back up; matching the duration makes the two moves cancel out, so
       the composer holds still and only the keyboard/panel swap. */
    transition: padding-bottom 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  .vault-input-area.is-picker-open {
    padding-bottom: calc(var(--picker-h, 42vh) + 4px);
  }
  /* The field keeps the focused LOOK while the panel owns the keyboard (real DOM
     focus is impossible with the IME dismissed). */
  .vault-input-area.is-picker-open :deep(.vault-input-form .q-field__control) {
    border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.55) !important;
  }
  .vault-emoji-picker {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: var(--picker-h, 42vh);
    max-height: none;
    border: 0;
    border-top: 1px solid $vault-border;
    border-radius: 0;
  }
  .vault-emoji-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid #141414;
  }
  .vault-picker-search {
    flex: 1 1 auto;
    min-width: 0;
  }
  .vault-picker-search :deep(.q-field__control) {
    min-height: 30px !important;
    padding: 0 10px !important;
    border-radius: 15px !important;
    background: rgba(255, 255, 255, 0.06) !important;
  }
  .vault-picker-tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    flex: 0 0 auto;
  }
  .vault-picker-tab {
    min-width: 40px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: $vault-muted;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .vault-picker-tab--active {
    background: $vault-accent;
    color: #000;
  }
  .vault-picker-emoji-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .vault-picker-emoji-body .vault-emoji-grid {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .vault-picker-section {
    flex: 0 0 auto;
    padding: 4px 10px 2px;
    font-family: monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: $vault-muted;
  }
  .vault-picker-cats {
    display: flex;
    align-items: center;
    justify-content: space-around;
    gap: 4px;
    flex: 0 0 auto;
    padding: 6px 8px;
    border-top: 1px solid #141414;
  }
  .vault-picker-cat {
    padding: 4px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    font-size: 16px;
    line-height: 1;
    opacity: 0.55;
    cursor: pointer;
  }
  .vault-picker-cat.is-active {
    opacity: 1;
    background: rgb(var(--m-accent-rgb, 255 0 0) / 0.14);
  }
}
</style>
