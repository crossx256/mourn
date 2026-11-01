<template>
  <div>
    <!-- Tab Header -->
    <div class="flex justify-between items-start mb-6 gap-4">
      <div>
        <div class="dash-back-inline">
          <q-btn
            v-if="$q?.screen?.lt?.md"
            round
            flat
            icon="mdi-arrow-left"
            to="/"
            color="primary"
            size="md"
            dense
            class="dash-back-btn"
            aria-label="back to home"
          />
          <h1 class="tab-title leading-none">my profile</h1>
        </div>
        <p class="tab-subtitle">customize your basic profile information</p>
      </div>
    </div>

    <!-- Basic Info Section -->
    <q-card flat bordered dark class="dash-card mb-4">
      <q-card-section class="card-section">
        <div class="section-title">basic info</div>

        <div class="field-group" data-field="display-name">
          <label class="field-label">display name</label>
          <p class="field-hint">this is what people will see on your profile</p>
          <q-input
            v-model="displayName"
            :placeholder="dashboardStore.username"
            maxlength="50"
            dark
            filled
            dense
            square
            class="dashboard-no-label-field"
          />
        </div>

        <div class="field-group mt-4" data-field="bio">
          <label class="field-label">bio</label>
          <p class="field-hint">tell people about yourself ({{ bioLength }}/500)</p>
          <q-input
            v-model="bio"
            type="textarea"
            maxlength="500"
            rows="3"
            dark
            filled
            dense
            square
            autogrow
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- Profile Picture Section -->
    <q-card flat bordered dark class="dash-card mb-4" data-field="profile-picture">
      <q-card-section class="card-section">
        <div class="section-title">profile picture</div>

        <div class="flex gap-4 items-start">
          <q-avatar size="64px" :square="profilePictureShape === 'square'" class="profile-avatar">
            <img v-if="profilePicture" :src="profilePicture" />
            <q-icon v-else name="mdi-account" size="24px" color="grey-7" />
          </q-avatar>

          <div class="flex-1">
            <div class="flex gap-2 items-center">
              <q-input
                v-model="profilePicture"
                placeholder="https://"
                dark
                filled
                dense
                square
                class="flex-1 dashboard-no-label-field"
              />
              <q-btn flat dense icon="mdi-upload" class="upload-btn" aria-label="Upload profile picture" @click="triggerFileUpload" />
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                class="dashboard-native-file"
                aria-label="Choose profile picture"
                @change="handleFileSelect"
              />
            </div>

            <div class="mt-3 flex items-center gap-3" data-field="profile-picture-shape">
              <span class="text-xs text-[#555]">shape</span>
              <q-btn-toggle
                v-model="profilePictureShape"
                no-caps
                dense
                unelevated
                class="shape-toggle"
                :options="[
                  { value: 'circle', icon: 'mdi-circle-outline' },
                  { value: 'square', icon: 'mdi-square-outline' },
                ]"
              />
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Profile Picture Cropper Dialog (lazy-loaded) -->
    <ProfilePictureCropper
      v-if="showCropper"
      v-model="showCropper"
      :file="cropperFile"
      @cropped="handleCroppedFile"
    />

    <!-- Visibility Options Section -->
    <q-card flat bordered dark class="dash-card mb-4">
      <q-card-section class="card-section">
        <div class="section-title">visibility options</div>

        <div class="toggle-grid">
          <label class="toggle-item">
            <input type="checkbox" v-model="showHandle" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show @username</span>
              <span class="toggle-desc">display your handle under display name</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showProfilePicture" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show profile picture</span>
              <span class="toggle-desc">display your avatar on the profile</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showViews" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show views</span>
              <span class="toggle-desc">display profile view count</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showReputation" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show reputation</span>
              <span class="toggle-desc">display your rep score</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showReferrals" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show referrals</span>
              <span class="toggle-desc">display referral count</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showMemberSince" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show join date</span>
              <span class="toggle-desc">display when you joined</span>
            </div>
          </label>

          <label class="toggle-item">
            <input type="checkbox" v-model="showBadges" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show badges</span>
              <span class="toggle-desc">display achievement badges</span>
            </div>
          </label>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';

// Lazy-load the cropper to keep initial bundle size low
const ProfilePictureCropper = defineAsyncComponent(
  () => import('src/components/dashboard/ProfilePictureCropper.vue'),
);

const $q = useQuasar();
const dashboardStore = useDashboardStore();

// // Upload state
// const uploadStatus = ref('');
// const profilePictureFile = ref<File | null>(null);

// Computed properties with two-way binding to store
const displayName = computed({
  get: () => dashboardStore.profile.displayName || '',
  set: (value) => dashboardStore.updateField('displayName', value || null),
});

const bio = computed({
  get: () => dashboardStore.profile.bio || '',
  set: (value) => dashboardStore.updateField('bio', value || null),
});

const bioLength = computed(() => (dashboardStore.profile.bio || '').length);

const profilePicture = computed({
  get: () => dashboardStore.profile.profilePicture || '',
  set: (value) => dashboardStore.updateField('profilePicture', value || null),
});

const profilePictureShape = computed({
  get: () => dashboardStore.profile.profilePictureShape || 'circle',
  set: (value) => dashboardStore.updateField('profilePictureShape', value),
});

const showHandle = computed({
  get: () => dashboardStore.profile.showHandle ?? true,
  set: (value) => dashboardStore.updateField('showHandle', value),
});

const showProfilePicture = computed({
  get: () => dashboardStore.profile.showProfilePicture ?? true,
  set: (value) => dashboardStore.updateField('showProfilePicture', value),
});

const showViews = computed({
  get: () => dashboardStore.profile.showViews,
  set: (value) => dashboardStore.updateField('showViews', value),
});

const showReputation = computed({
  get: () => dashboardStore.profile.showReputation,
  set: (value) => dashboardStore.updateField('showReputation', value),
});

const showReferrals = computed({
  get: () => dashboardStore.profile.showReferrals,
  set: (value) => dashboardStore.updateField('showReferrals', value),
});

const showMemberSince = computed({
  get: () => dashboardStore.profile.showMemberSince,
  set: (value) => dashboardStore.updateField('showMemberSince', value),
});

const showBadges = computed({
  get: () => dashboardStore.profile.showBadges,
  set: (value) => dashboardStore.updateField('showBadges', value),
});

// File input ref
const fileInput = ref<HTMLInputElement | null>(null);

// Cropper state
const showCropper = ref(false);
const cropperFile = ref<File | null>(null);

function triggerFileUpload() {
  fileInput.value?.click();
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  // Reset the input so re-selecting the same file still fires `change`.
  target.value = '';

  // Animated GIFs must keep their animation — bypass the cropper (which
  // re-encodes to a single-frame static webp) and upload directly.
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    void uploadGif(file);
    return;
  }

  // Open the cropper dialog for static images.
  cropperFile.value = file;
  showCropper.value = true;
}

async function uploadGif(file: File) {
  const url = await dashboardStore.uploadFile(file, 'profilePicture');
  if (url) {
    profilePicture.value = url;
  }
}

async function handleCroppedFile(file: File) {
  const url = await dashboardStore.uploadFile(file, 'profilePicture');
  if (url) {
    profilePicture.value = url;
  }
}
</script>

<!-- Styles moved to src/css/dashboard.scss -->
