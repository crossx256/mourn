<template>
  <q-dialog v-model="dialogOpen">
    <q-card class="modal-card suite-settings-modal">
      <div class="modal-header suite-settings-header">
        <div>
          <h3>Suite settings</h3>
        </div>
        <q-btn
          flat
          round
          dense
          icon="mdi-close"
          class="btn-secondary suite-icon-button"
          @click="closeDialog"
        />
      </div>

      <div v-if="settingsGroup" class="suite-settings-profile">
        <q-avatar size="72px" class="suite-settings-avatar">
          <img
            v-if="settingsGroup.avatarUrl"
            :src="settingsGroup.avatarUrl"
            :alt="settingsGroup.name"
          />
          <q-icon v-else name="mdi-shape" size="32px" color="grey-6" />
        </q-avatar>
        <div class="suite-settings-profile-copy">
          <span class="suite-settings-name">{{ settingsGroup.name }}</span>
          <span class="suite-settings-meta">
            {{ uniqueMembers.length }} members ·
            {{ settingsGroup.isPublic ? 'PUBLIC' : 'PRIVATE' }} · EPOCH {{ settingsGroup.epoch }}
          </span>
          <span class="suite-settings-role">YOUR ROLE: {{ currentMember?.role ?? 'MEMBER' }}</span>
        </div>
      </div>

      <q-tabs v-model="activeTab" dense align="left" class="suite-settings-tabs">
        <q-tab name="overview" label="Overview" />
        <q-tab name="members" label="Members" />
        <q-tab
          v-if="canManageJoinRequests"
          name="requests"
          :label="`Requests${joinRequests.length ? ` (${joinRequests.length})` : ''}`"
        />
      </q-tabs>

      <q-card-section class="suite-settings-content">
        <div v-if="!settingsGroup" class="suite-settings-empty">
          <q-spinner color="primary" size="24px" />
        </div>

        <div v-else-if="activeTab === 'overview'" class="suite-settings-section">
          <template v-if="canEditMeta">
            <div class="suite-avatar-editor">
              <q-avatar size="64px" class="suite-settings-avatar">
                <img v-if="editAvatarUrl" :src="editAvatarUrl" alt="Suite avatar preview" />
                <q-icon v-else name="mdi-shape" size="28px" color="grey-6" />
              </q-avatar>
              <div class="suite-avatar-actions">
                <input
                  ref="avatarInputRef"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  class="hidden"
                  @change="uploadAvatar"
                />
                <q-btn
                  unelevated
                  no-caps
                  icon="mdi-upload"
                  label="Upload image"
                  class="btn-secondary"
                  :loading="avatarUploading"
                  @click="avatarInputRef?.click()"
                />
                <q-btn
                  flat
                  no-caps
                  label="Remove"
                  class="btn-danger-outline"
                  :disable="!editAvatarUrl || avatarUploading"
                  @click="editAvatarUrl = ''"
                />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Suite name</label>
              <q-input
                v-model="editName"
                dense
                outlined
                dark
                hide-bottom-space
                class="suite-form-field"
                :error="!editName.trim()"
                error-message="Name is required"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Hosted avatar URL</label>
              <q-input
                v-model="editAvatarUrl"
                dense
                outlined
                dark
                hide-bottom-space
                class="suite-form-field"
                placeholder="https://i.ibb.co/... or https://files.catbox.moe/..."
              />
            </div>

            <div class="form-group">
              <label class="form-label">Public description</label>
              <q-input
                v-model="editDescription"
                dense
                outlined
                dark
                autogrow
                type="textarea"
                maxlength="280"
                hide-bottom-space
                class="suite-form-field"
                placeholder="Describe this Suite for discovery"
              />
            </div>

            <label class="toggle-item compact suite-visibility-toggle">
              <input type="checkbox" :checked="editIsPublic" @change="onPublicInput" />
              <span class="toggle-switch" aria-hidden="true" />
              <span class="suite-toggle-copy">
                <strong>Public Suite</strong>
                <small>Visible in discovery and joinable by request</small>
              </span>
            </label>

            <div class="suite-settings-actions">
              <q-btn
                unelevated
                no-caps
                label="Save changes"
                class="btn-primary-action"
                :loading="savingMeta"
                :disable="!editName.trim()"
                @click="saveMeta"
              />
            </div>
          </template>

          <template v-else>
            <div class="suite-readonly-block">
              <span class="suite-readonly-label">DESCRIPTION</span>
              <p>{{ settingsGroup.description || 'No public description.' }}</p>
            </div>
            <div class="suite-readonly-grid">
              <div>
                <span>VISIBILITY</span
                ><strong>{{ settingsGroup.isPublic ? 'PUBLIC' : 'PRIVATE' }}</strong>
              </div>
              <div>
                <span>MEMBERS</span><strong>{{ uniqueMembers.length }}</strong>
              </div>
              <div>
                <span>MLS EPOCH</span><strong>{{ settingsGroup.epoch }}</strong>
              </div>
              <div>
                <span>ROLE</span><strong>{{ currentMember?.role ?? 'USER' }}</strong>
              </div>
            </div>
          </template>

          <!-- Report the suite (§4b). Available to EVERY member, manager or
               not — reporting is not an admin capability. -->
          <div class="suite-report-row">
            <button type="button" class="suite-report-btn" @click="onReportSuite">
              <q-icon name="mdi-alert-octagon-outline" size="14px" />
              <span>REPORT THIS SUITE</span>
            </button>
          </div>
        </div>

        <div
          v-else-if="activeTab === 'members'"
          class="suite-settings-section suite-members-section"
        >
          <div class="suite-section-heading">
            <div>
              <span>MEMBERS</span>
              <small>{{ uniqueMembers.length }} people in this Suite</small>
            </div>
          </div>

          <q-scroll-area class="suite-members-list">
            <div v-for="member in uniqueMembers" :key="member.userId" class="suite-member-row">
              <q-avatar size="40px" class="suite-member-avatar">
                <img
                  v-if="member.profile?.profilePicture"
                  :src="member.profile.profilePicture"
                  :alt="member.username"
                />
                <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
              </q-avatar>

              <div class="suite-member-copy">
                <span class="suite-member-name">
                  {{ member.profile?.displayName || member.username || 'Member' }}
                </span>
                <span class="suite-member-handle">@{{ member.username || 'user' }}</span>
                <span class="suite-member-devices">
                  {{ member.devices?.length || 1 }} device{{
                    (member.devices?.length || 1) === 1 ? '' : 's'
                  }}
                </span>
              </div>

              <span
                class="suite-role-badge"
                :class="`suite-role-badge--${member.role.toLowerCase()}`"
              >
                {{ member.role }}
              </span>

              <q-btn
                v-if="member.userId !== authStore.user?.id && member.identityPub"
                flat
                round
                dense
                icon="mdi-shield-check-outline"
                class="btn-secondary suite-icon-button"
                @click="verifyMember(member)"
              >
                <q-tooltip>Verify safety number</q-tooltip>
              </q-btn>

              <q-btn-dropdown
                v-if="canManageMember(member)"
                flat
                dense
                no-caps
                dropdown-icon="mdi-dots-vertical"
                class="btn-secondary suite-member-menu-button"
              >
                <q-list class="suite-action-menu">
                  <q-item
                    v-if="isOwner && member.role !== 'OWNER'"
                    clickable
                    v-close-popup
                    @click="confirmMemberAction('transfer', member)"
                  >
                    <q-item-section avatar><q-icon name="mdi-crown" size="16px" /></q-item-section>
                    <q-item-section>Transfer ownership</q-item-section>
                  </q-item>
                  <q-item
                    v-if="member.role === 'USER'"
                    clickable
                    v-close-popup
                    @click="updateMemberRole(member.userId, 'ADMIN')"
                  >
                    <q-item-section avatar
                      ><q-icon name="mdi-shield-account" size="16px"
                    /></q-item-section>
                    <q-item-section>Promote to admin</q-item-section>
                  </q-item>
                  <q-item
                    v-if="isOwner && member.role === 'ADMIN'"
                    clickable
                    v-close-popup
                    @click="updateMemberRole(member.userId, 'USER')"
                  >
                    <q-item-section avatar
                      ><q-icon name="mdi-account" size="16px"
                    /></q-item-section>
                    <q-item-section>Demote to member</q-item-section>
                  </q-item>

                  <q-separator />
                  <q-item-label header>MEMBER PERMISSIONS</q-item-label>
                  <q-item
                    v-for="permission in memberPermissionOptions"
                    :key="permission.key"
                    clickable
                    @click="toggleMemberPermission(member, permission.key)"
                  >
                    <q-item-section avatar>
                      <q-icon
                        :name="
                          member[permission.key]
                            ? 'mdi-checkbox-marked'
                            : 'mdi-checkbox-blank-outline'
                        "
                        size="16px"
                      />
                    </q-item-section>
                    <q-item-section>{{ permission.label }}</q-item-section>
                  </q-item>

                  <q-separator />
                  <q-item
                    clickable
                    v-close-popup
                    class="text-negative"
                    @click="confirmMemberAction('remove', member)"
                  >
                    <q-item-section avatar
                      ><q-icon name="mdi-account-remove" size="16px"
                    /></q-item-section>
                    <q-item-section>Remove from Suite</q-item-section>
                  </q-item>
                </q-list>
              </q-btn-dropdown>
            </div>
          </q-scroll-area>
        </div>

        <div
          v-else-if="activeTab === 'requests'"
          class="suite-settings-section suite-members-section"
        >
          <div class="suite-section-heading">
            <div>
              <span>JOIN REQUESTS</span>
              <small>Members waiting for approval</small>
            </div>
            <q-btn
              flat
              round
              dense
              icon="mdi-refresh"
              class="btn-secondary suite-icon-button"
              :loading="joinRequestsLoading"
              @click="loadJoinRequests"
            />
          </div>

          <div v-if="joinRequestsLoading" class="suite-settings-empty">
            <q-spinner color="primary" size="24px" />
          </div>
          <div v-else-if="joinRequests.length === 0" class="suite-settings-empty">
            <q-icon name="mdi-account-clock-outline" size="28px" />
            <span>No pending requests</span>
          </div>
          <q-scroll-area v-else class="suite-members-list">
            <div v-for="request in joinRequests" :key="request.requestId" class="suite-member-row">
              <q-avatar size="40px" class="suite-member-avatar">
                <img
                  v-if="request.profile?.profilePicture"
                  :src="request.profile.profilePicture"
                  :alt="request.username"
                />
                <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
              </q-avatar>
              <div class="suite-member-copy">
                <span class="suite-member-name">
                  {{ request.profile?.displayName || request.username }}
                </span>
                <span class="suite-member-handle">@{{ request.username }}</span>
                <span class="suite-member-devices"
                  >REQUESTED {{ formatRequestDate(request.createdAt) }}</span
                >
              </div>
              <div class="suite-request-actions">
                <q-btn
                  unelevated
                  no-caps
                  icon="mdi-check"
                  label="Accept"
                  class="btn-primary-action"
                  :loading="respondingRequestId === request.requestId"
                  @click="respondJoinRequest(request.requestId, 'ACCEPTED')"
                />
                <q-btn
                  flat
                  no-caps
                  icon="mdi-close"
                  label="Reject"
                  class="btn-danger-outline"
                  :loading="respondingRequestId === request.requestId"
                  @click="respondJoinRequest(request.requestId, 'REJECTED')"
                />
              </div>
            </div>
          </q-scroll-area>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-dialog v-model="confirmPublicOpen">
    <q-card class="modal-card suite-confirm-card">
      <div class="modal-header"><h3>Make this Suite public?</h3></div>
      <div class="modal-body suite-confirm-copy">
        Its name, avatar, and description will appear in discovery. Members and messages remain
        private.
      </div>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" class="btn-secondary" @click="cancelPublicToggle" />
        <q-btn
          unelevated
          no-caps
          label="Make public"
          class="btn-primary-action"
          @click="confirmPublicToggle"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog v-model="memberConfirmOpen">
    <q-card class="modal-card suite-confirm-card">
      <div class="modal-header">
        <h3>{{ memberConfirmTitle }}</h3>
      </div>
      <div class="modal-body suite-confirm-copy">{{ memberConfirmMessage }}</div>
      <q-card-actions align="right">
        <q-btn
          flat
          no-caps
          label="Cancel"
          class="btn-secondary"
          @click="memberConfirmOpen = false"
        />
        <q-btn
          unelevated
          no-caps
          :label="memberConfirmAction === 'remove' ? 'Remove member' : 'Transfer ownership'"
          :class="memberConfirmAction === 'remove' ? 'btn-danger' : 'btn-primary-action'"
          :loading="memberActionLoading"
          @click="performMemberAction"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog v-model="verifyOpen">
    <q-card class="modal-card suite-confirm-card">
      <div class="modal-header"><h3>Verify member identity</h3></div>
      <div class="modal-body suite-confirm-copy">
        <strong>{{ verifyTarget?.profile?.displayName || verifyTarget?.username }}</strong>
        <p>Compare this safety number over a trusted secondary channel.</p>
        <div v-if="verifyLoading" class="suite-settings-empty"><q-spinner size="24px" /></div>
        <div v-else class="suite-safety-number">{{ verifyNumber }}</div>
        <p v-if="verifyError" class="text-negative">{{ verifyError }}</p>
      </div>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Close" class="btn-secondary" @click="verifyOpen = false" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useGroupStore, type GroupMember, type GroupRole } from 'src/stores/groupStore';
import { useAuthStore } from 'src/stores/auth';
import { useNotificationsStore } from 'src/stores/notifications';
import { openTicketReport } from 'src/utils/ticketLinks';
import { useQuasar } from 'quasar';

const props = defineProps<{
  modelValue: boolean;
  groupId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const groupStore = useGroupStore();
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const router = useRouter();
const $q = useQuasar();

/**
 * Report the suite (§4b). Suite-level only for this cut — a report about
 * individual messages inside a suite goes through the vault message report.
 * The server re-checks membership before writing the ticket.
 */
function onReportSuite() {
  const group = settingsGroup.value;
  if (!group) return;
  const label = `Suite "${group.name}"`;
  emit('update:modelValue', false);
  void openTicketReport(router, {
    targetType: 'suite',
    targetRef: group.id,
    label,
  });
}
const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const settingsGroup = computed(() =>
  props.groupId ? (groupStore.groups.get(props.groupId) ?? null) : null,
);
const uniqueMembers = computed(() => {
  const byUser = new Map<string, GroupMember>();
  for (const member of settingsGroup.value?.members ?? []) {
    const existing = byUser.get(member.userId);
    if (!existing) {
      byUser.set(member.userId, { ...member, devices: [...(member.devices ?? [])] });
      continue;
    }
    const devices = [...(existing.devices ?? [])];
    for (const device of member.devices ?? []) {
      if (!devices.some((item) => item.deviceId === device.deviceId)) devices.push(device);
    }
    if (member.deviceId && !devices.some((item) => item.deviceId === member.deviceId)) {
      devices.push({ deviceId: member.deviceId, identityPub: member.identityPub ?? null });
    }
    existing.devices = devices;
  }
  return Array.from(byUser.values());
});
const currentMember = computed(() =>
  uniqueMembers.value.find((member) => member.userId === authStore.user?.id),
);
const isOwner = computed(() => currentMember.value?.role === 'OWNER');
const isAdmin = computed(() => currentMember.value?.role === 'ADMIN' || isOwner.value);
const canEditMeta = isOwner;
const canManageJoinRequests = computed(
  () => isAdmin.value || Boolean(currentMember.value?.canAddMembers),
);

const activeTab = ref<'overview' | 'members' | 'requests'>('overview');
const editName = ref('');
const editAvatarUrl = ref('');
const editDescription = ref('');
const editIsPublic = ref(false);
const savingMeta = ref(false);
const avatarUploading = ref(false);
const avatarInputRef = ref<HTMLInputElement | null>(null);
const confirmPublicOpen = ref(false);

interface JoinRequestView {
  requestId: string;
  userId: string;
  username: string;
  profile: { displayName: string | null; profilePicture: string | null } | null;
  createdAt: string;
}
const joinRequests = ref<JoinRequestView[]>([]);
const joinRequestsLoading = ref(false);
const respondingRequestId = ref<string | null>(null);

const memberPermissionOptions: Array<{
  key: 'canPinMessages' | 'canAddMembers' | 'canSendMedia' | 'canChangeOptions';
  label: string;
}> = [
  { key: 'canPinMessages', label: 'Pin messages' },
  { key: 'canAddMembers', label: 'Invite and manage requests' },
  { key: 'canSendMedia', label: 'Post messages and media' },
];

function syncForm() {
  const group = settingsGroup.value;
  if (!group) return;
  editName.value = group.name;
  editAvatarUrl.value = group.avatarUrl ?? '';
  editDescription.value = group.description ?? '';
  editIsPublic.value = Boolean(group.isPublic);
}

watch(
  () => [props.modelValue, props.groupId] as const,
  async ([isOpen, groupId]) => {
    if (!isOpen || !groupId) return;
    await groupStore.fetchGroupDetails(groupId);
    syncForm();
    activeTab.value = 'overview';
    if (canManageJoinRequests.value) await loadJoinRequests();
  },
);

watch(activeTab, (tab) => {
  if (tab === 'requests') void loadJoinRequests();
});

function closeDialog() {
  dialogOpen.value = false;
}

function canManageMember(member: GroupMember): boolean {
  if (!isAdmin.value || member.userId === authStore.user?.id || member.role === 'OWNER')
    return false;
  if (member.role === 'ADMIN' && !isOwner.value) return false;
  return true;
}

async function loadJoinRequests() {
  if (!props.groupId || !canManageJoinRequests.value) {
    joinRequests.value = [];
    return;
  }
  joinRequestsLoading.value = true;
  try {
    joinRequests.value = await groupStore.fetchGroupJoinRequests(props.groupId);
  } finally {
    joinRequestsLoading.value = false;
  }
}

async function respondJoinRequest(requestId: string, action: 'ACCEPTED' | 'REJECTED') {
  if (!props.groupId || respondingRequestId.value) return;
  respondingRequestId.value = requestId;
  try {
    const ok = await groupStore.respondToJoinRequest(props.groupId, requestId, action);
    if (ok) {
      joinRequests.value = joinRequests.value.filter((request) => request.requestId !== requestId);
      const notification = notificationsStore.notifications.find(
        (item) => String(item.data?.requestId ?? '') === requestId,
      );
      if (notification) await notificationsStore.markAsRead(notification.id);
      await groupStore.fetchGroupDetails(props.groupId);
      $q.notify({
        type: action === 'ACCEPTED' ? 'positive' : 'info',
        message: action === 'ACCEPTED' ? 'Join request accepted.' : 'Join request rejected.',
      });
    } else {
      $q.notify({ type: 'negative', message: groupStore.lastError || 'Could not update request.' });
    }
  } finally {
    respondingRequestId.value = null;
  }
}

function onPublicInput(event: Event) {
  const next = (event.target as HTMLInputElement).checked;
  if (next && !editIsPublic.value) {
    confirmPublicOpen.value = true;
    return;
  }
  editIsPublic.value = next;
}
function cancelPublicToggle() {
  confirmPublicOpen.value = false;
  editIsPublic.value = false;
}
function confirmPublicToggle() {
  editIsPublic.value = true;
  confirmPublicOpen.value = false;
}

async function saveMeta() {
  if (!props.groupId || !editName.value.trim()) return;
  savingMeta.value = true;
  try {
    await groupStore.updateGroupMeta(props.groupId, {
      name: editName.value.trim(),
      avatarUrl: editAvatarUrl.value.trim(),
      description: editDescription.value.trim(),
      isPublic: editIsPublic.value,
    });
  } finally {
    savingMeta.value = false;
  }
}

async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !props.groupId) return;
  avatarUploading.value = true;
  try {
    const url = await groupStore.uploadGroupAvatar(props.groupId, file);
    if (url) {
      editAvatarUrl.value = url;
      $q.notify({ type: 'positive', message: 'Suite image updated.' });
    } else {
      $q.notify({
        type: 'negative',
        message: groupStore.lastError || 'Suite image upload failed.',
      });
    }
  } finally {
    avatarUploading.value = false;
  }
}

async function updateMemberRole(targetUserId: string, role: GroupRole) {
  if (!props.groupId) return;
  const ok = await groupStore.updateMemberRole(props.groupId, targetUserId, role);
  $q.notify({
    type: ok ? 'positive' : 'negative',
    message: ok
      ? `Member role changed to ${role.toLowerCase()}.`
      : groupStore.lastError || 'Role update failed.',
  });
}

async function toggleMemberPermission(
  member: GroupMember,
  key: 'canPinMessages' | 'canAddMembers' | 'canSendMedia' | 'canChangeOptions',
) {
  if (!props.groupId) return;
  const ok = await groupStore.updateMemberPermissions(props.groupId, member.userId, {
    [key]: !member[key],
  });
  if (!ok)
    $q.notify({ type: 'negative', message: groupStore.lastError || 'Permission update failed.' });
}

const memberConfirmOpen = ref(false);
const memberConfirmAction = ref<'remove' | 'transfer'>('remove');
const memberConfirmTarget = ref<GroupMember | null>(null);
const memberActionLoading = ref(false);
const memberConfirmTitle = computed(() =>
  memberConfirmAction.value === 'remove' ? 'Remove member?' : 'Transfer ownership?',
);
const memberConfirmMessage = computed(() => {
  const name =
    memberConfirmTarget.value?.profile?.displayName ||
    memberConfirmTarget.value?.username ||
    'this member';
  return memberConfirmAction.value === 'remove'
    ? `${name} will immediately lose access to this Suite and future MLS messages.`
    : `${name} will become the Suite owner. You will be demoted to admin.`;
});

function confirmMemberAction(action: 'remove' | 'transfer', member: GroupMember) {
  memberConfirmAction.value = action;
  memberConfirmTarget.value = member;
  memberConfirmOpen.value = true;
}

async function performMemberAction() {
  if (!props.groupId || !memberConfirmTarget.value) return;
  memberActionLoading.value = true;
  try {
    const targetId = memberConfirmTarget.value.userId;
    const ok =
      memberConfirmAction.value === 'remove'
        ? await groupStore.removeMember(props.groupId, targetId)
        : await groupStore.transferOwnership(props.groupId, targetId);
    if (ok) {
      memberConfirmOpen.value = false;
      $q.notify({
        type: 'positive',
        message:
          memberConfirmAction.value === 'remove'
            ? 'Member removed from the Suite.'
            : 'Suite ownership transferred.',
      });
    } else {
      $q.notify({ type: 'negative', message: groupStore.lastError || 'Member update failed.' });
    }
  } finally {
    memberActionLoading.value = false;
  }
}

const verifyOpen = ref(false);
const verifyTarget = ref<GroupMember | null>(null);
const verifyNumber = ref('');
const verifyLoading = ref(false);
const verifyError = ref('');
async function verifyMember(member: GroupMember) {
  verifyTarget.value = member;
  verifyNumber.value = '';
  verifyError.value = '';
  verifyLoading.value = true;
  verifyOpen.value = true;
  try {
    const number = await groupStore.computeMemberSafetyNumber(member.userId, props.groupId);
    if (number) verifyNumber.value = number;
    else verifyError.value = 'Could not compute a safety number for this member.';
  } finally {
    verifyLoading.value = false;
  }
}

function formatRequestDate(value: string): string {
  return new Date(value)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}
</script>

<style scoped>
/* Report-suite action (§4b). Rendered for every member, manager or not. */
.suite-report-row {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
}

.suite-report-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: transparent;
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-family: 'Courier New', monospace;
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    color 150ms ease;
}

.suite-report-btn:hover {
  border-color: var(--dash-warning, #ffaa00);
  color: var(--dash-warning, #ffaa00);
}
.suite-settings-modal {
  width: 620px;
  max-width: 94vw;
  height: 620px;
  border-radius: 0;
  display: flex;
  flex-direction: column;
}
.suite-settings-content {
  flex: 1;
  min-height: 0;
  height: auto;
  max-height: none;
  padding: 0;
  overflow: hidden;
}
.suite-settings-header {
  padding: 16px 18px;
}

/* Force the dark messenger theme on every Suite settings surface. These are
   needed because Quasar's q-dialog/q-card/tabs default to light when the app
   does not run in Quasar dark mode — the dashboard tokens only cover some
   surfaces and can be overridden by Quasar's own component palette. */
.suite-settings-modal,
.suite-settings-modal :deep(.q-card) {
  background: #0c0c0c !important;
  color: rgb(var(--m-text-rgb));
}
.suite-settings-modal :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.75) !important;
}
.suite-settings-modal .modal-header {
  background: rgb(var(--m-elevated-rgb)) !important;
  border-bottom: 1px solid rgb(var(--m-border-rgb)) !important;
}
.suite-settings-modal .modal-header h3 {
  color: rgb(var(--m-text-rgb)) !important;
}
.suite-settings-profile {
  background: #080808 !important;
}
.suite-settings-tabs,
.suite-settings-modal :deep(.q-tabs),
.suite-settings-modal :deep(.q-tabs__content) {
  background: rgb(var(--m-surface-rgb)) !important;
  border-bottom: 1px solid rgb(var(--m-border-rgb));
}
.suite-settings-modal :deep(.q-tab) {
  color: rgb(var(--m-textMuted-rgb));
}
.suite-settings-modal :deep(.q-tab--active) {
  color: rgb(var(--m-accent-rgb));
}
.suite-settings-modal :deep(.q-tab__indicator) {
  background: rgb(var(--m-accent-rgb)) !important;
}
.suite-settings-modal :deep(.q-tab__label) {
  font-family: monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.suite-settings-modal .suite-settings-content {
  background: #080808 !important;
  color: rgb(var(--m-text-rgb));
}
.suite-settings-modal :deep(.q-menu),
.suite-settings-modal :deep(.q-list),
.suite-settings-modal :deep(.q-item) {
  background: rgb(var(--m-surface-rgb)) !important;
  color: rgb(var(--m-text-rgb));
}
.suite-settings-modal :deep(.q-field__control) {
  background: #000000 !important;
  border-color: rgb(var(--m-border-rgb)) !important;
}
.suite-settings-modal :deep(.q-field__native),
.suite-settings-modal :deep(.q-field__input) {
  color: rgb(var(--m-text-rgb)) !important;
}
.suite-settings-modal :deep(.q-field__label) {
  color: rgb(var(--m-textMuted-rgb)) !important;
}
.suite-settings-modal :deep(.q-input),
.suite-settings-modal :deep(.q-select),
.suite-settings-modal :deep(.q-btn),
.suite-settings-modal :deep(.q-avatar) {
  color: rgb(var(--m-text-rgb));
}
.suite-settings-kicker,
.suite-settings-meta,
.suite-settings-role,
.suite-section-heading span,
.suite-readonly-label {
  color: var(--dash-muted);
  font: 10px/1.3 monospace;
  letter-spacing: 0.12em;
}
.suite-settings-profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--dash-border);
  background: #080808;
}
.suite-settings-avatar,
.suite-member-avatar {
  border: 1px solid var(--dash-border);
  border-radius: 50%; /* rounded like 1:1 chat avatars */
  background: var(--dash-card);
}
.suite-settings-profile-copy,
.suite-member-copy,
.suite-toggle-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.suite-settings-name {
  color: var(--dash-text);
  font: 600 15px monospace;
}
.suite-settings-role {
  color: var(--primary);
}
.suite-settings-tabs {
  border-bottom: 1px solid var(--dash-border);
  background: var(--dash-panel);
}
:deep(.suite-settings-tabs .q-tab) {
  min-height: 42px;
  color: var(--dash-muted);
  font: 700 10px monospace;
  letter-spacing: 0.08em;
}
:deep(.suite-settings-tabs .q-tab--active) {
  color: var(--primary);
}
:deep(.suite-settings-tabs .q-tab__indicator) {
  background: var(--primary);
}
.suite-settings-section {
  height: 100%;
  padding: 18px;
  overflow-y: auto;
}
.suite-members-section {
  height: 100%;
  padding: 0;
  overflow: hidden;
}
.suite-settings-content :deep(.q-card__section) {
  padding: 0;
}
/* Keep the members/requests scroller sized to the fixed dialog height. */
.suite-members-section :deep(.q-scrollarea),
.suite-members-section :deep(.q-scrollarea__container) {
  height: 100%;
}
.suite-settings-empty {
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dash-muted);
  font: 11px monospace;
}
.suite-avatar-editor {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.suite-avatar-actions,
.suite-settings-actions,
.suite-request-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.suite-form-field :deep(.q-field__control) {
  background: var(--dash-bg) !important;
  border-radius: 0 !important;
}
.suite-visibility-toggle {
  margin: 0;
}
.suite-toggle-copy strong {
  color: var(--dash-text);
  font: 600 11px monospace;
}
.suite-toggle-copy small {
  color: var(--dash-muted);
  font: 10px monospace;
}
.suite-settings-actions {
  justify-content: flex-end;
  margin-top: 18px;
}
.suite-readonly-block {
  padding: 14px;
  border: 1px solid var(--dash-border);
  background: #080808;
}
.suite-readonly-block p {
  margin: 8px 0 0;
  color: var(--dash-text);
  font: 12px/1.5 monospace;
}
.suite-readonly-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.suite-readonly-grid div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border: 1px solid var(--dash-border);
  background: #080808;
}
.suite-readonly-grid span {
  color: var(--dash-muted);
  font: 9px monospace;
}
.suite-readonly-grid strong {
  color: var(--dash-text);
  font: 12px monospace;
}
.suite-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--dash-border);
}
.suite-section-heading div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.suite-section-heading small {
  color: var(--dash-muted);
  font: 10px monospace;
}
.suite-members-list {
  height: calc(100% - 56px);
}
.suite-member-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 68px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--dash-border);
}
.suite-member-row:hover {
  background: rgba(255, 255, 255, 0.02);
}
.suite-member-copy {
  flex: 1;
}
.suite-member-name {
  overflow: hidden;
  color: var(--dash-text);
  font: 600 12px monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suite-member-handle {
  color: var(--dash-muted);
  font: 10px monospace;
}
.suite-member-devices {
  color: rgb(var(--m-textFaint-rgb));
  font: 9px monospace;
  letter-spacing: 0.05em;
}
.suite-role-badge {
  padding: 3px 6px;
  border: 1px solid var(--dash-border);
  color: var(--dash-muted);
  font: 700 9px monospace;
}
.suite-role-badge--owner {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
  color: var(--primary);
}
.suite-role-badge--admin {
  border-color: rgba(255, 170, 0, 0.35);
  color: var(--dash-warning);
}
.suite-icon-button {
  width: 32px;
  height: 32px;
  min-width: 32px;
}
.suite-member-menu-button {
  min-width: 34px;
}
.suite-action-menu {
  min-width: 250px;
  border: 1px solid var(--dash-border);
  border-radius: 0;
  background: var(--dash-panel);
  color: var(--dash-text);
  font: 11px monospace;
}
.suite-action-menu :deep(.q-item) {
  min-height: 38px;
}
.suite-request-actions :deep(.q-btn) {
  min-height: 34px;
}
/* Confirm dialogs (Make Suite public, member confirm, Verify member identity)
   render inside Quasar q-dialog/q-card, which default to LIGHT when the app is
   not in Quasar dark mode — dashboard.scss .modal-card sets a dark background
   WITHOUT !important, so Quasar's default white q-card wins and the popup shows
   white. These use !important to match the .suite-settings-modal treatment. */
.suite-confirm-card {
  border-radius: 0;
  background: #0c0c0c !important;
  color: rgb(var(--m-text-rgb));
}
.suite-confirm-card :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.75) !important;
}
.suite-confirm-card .modal-header {
  background: rgb(var(--m-elevated-rgb)) !important;
  border-bottom: 1px solid rgb(var(--m-border-rgb)) !important;
}
.suite-confirm-card .modal-header h3 {
  color: rgb(var(--m-text-rgb)) !important;
}
.suite-confirm-card .modal-body {
  background: #0c0c0c !important;
  color: rgb(var(--m-text-rgb));
}
.suite-confirm-card :deep(.q-card__actions) {
  background: rgb(var(--m-elevated-rgb)) !important;
  border-top: 1px solid rgb(var(--m-border-rgb)) !important;
}
.suite-confirm-copy {
  color: var(--dash-muted);
  font: 11px/1.55 monospace;
}
.suite-safety-number {
  padding: 12px;
  border: 1px solid var(--dash-border);
  background: #050505;
  color: var(--dash-text);
  font: 600 13px/1.6 monospace;
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
}
.hidden {
  display: none;
}
@media (max-width: 640px) {
  .suite-settings-modal {
    width: 96vw;
  }
  .suite-settings-profile {
    align-items: flex-start;
  }
  .suite-member-row {
    flex-wrap: wrap;
  }
  .suite-request-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
