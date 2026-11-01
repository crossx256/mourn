<template>
  <q-page class="download-page min-h-screen bg-dark p-4 overflow-x-hidden">
    <div class="download-page-shell mx-auto flex w-full max-w-5xl flex-col items-center">
      <div class="hero text-center mt-8 mb-8 max-w-full">
        <h1 class="text-3xl md:text-5xl font-mono font-bold text-primary mb-2 tracking-widest">
          Get MOURN for Desktop
        </h1>
        <p class="text-secondary font-mono text-base md:text-lg opacity-80">
          Secure. Minimal. Yours.
        </p>
        <p class="mt-2 font-mono text-sm text-primary tracking-[0.2em] lowercase">
          {{ appVersion }}
        </p>
      </div>

      <div class="download-cards flex flex-col md:flex-row gap-6 mb-10 w-full max-w-full min-w-0">
        <DownloadCard
          v-for="option in downloadOptions"
          :key="option.os"
          :os="option.os"
          :label="option.label"
          :file="option.file"
          :highlight="option.os === detectedOS"
          :badge="option.os === detectedOS ? 'Auto-detected' : ''"
          :icon="option.icon"
        />
      </div>

      <div class="security-verification w-full max-w-3xl bg-dark rounded-lg p-6 mb-8">
        <h2 class="font-mono text-lg text-primary mb-4 tracking-widest">Security Verification</h2>
        <q-table
          :rows="checksums"
          :columns="columns"
          row-key="filename"
          flat
          class="checksum-table font-mono text-xs bg-transparent text-secondary"
          hide-bottom
          :loading="isLoadingChecksums"
          :card-style="{ backgroundColor: 'transparent', color: 'var(--q-secondary)' }"
          :table-header-style="{ color: 'var(--q-primary)' }"
        >
          <template #body-cell-hash="props">
            <q-td :props="props">
              <span class="font-mono select-all text-white">{{ props.row.hash }}</span>
            </q-td>
          </template>
        </q-table>

        <p class="mt-4 font-mono text-xs leading-6 text-secondary opacity-90">
          After downloading, compare the SHA-256 hash shown above with a local hash of the file. On
          Linux, use <span class="text-white">sha256sum</span>; on Windows, use
          <span class="text-white">certutil -hashfile</span>.
        </p>

        <div v-if="androidSigner" class="android-signer mt-6 font-mono text-xs leading-6 text-secondary">
          <p class="text-primary tracking-widest mb-1">Android signing certificate</p>
          <p class="opacity-90">
            The Android APK is signed with the Mourn release key. An APK signed with any other key
            cannot install over, or update, an existing install, so a matching fingerprint is what
            proves the download will update in place. Verify it with
            <span class="text-white">{{ androidSigner.verifyCommand }}</span>.
          </p>
          <p class="mt-2 break-all">
            SHA-256: <span class="text-white select-all">{{ androidSigner.certificateSha256 }}</span>
          </p>
          <p class="opacity-80">
            {{ androidSigner.certificateSubject }} · {{ androidSigner.keyAlgorithm }}
          </p>
        </div>
      </div>

      <q-btn
        round
        flat
        icon="mdi-arrow-left"
        to="/"
        class="absolute left-4 top-4 text-primary z-10"
        aria-label="back to home"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Platform } from 'quasar';
import DownloadCard from 'components/DownloadCard.vue';
import { api, resolveApiUrl } from 'boot/axios';
import appPackage from '../../package.json';

const downloadOptions = [
  {
    os: 'windows-exe',
    label: 'Windows (.exe)',
    file: resolveApiUrl('/api/download/windows-exe'),
    icon: 'mdi-microsoft-windows',
  },
  {
    os: 'windows-msi',
    label: 'Windows (.msi)',
    file: resolveApiUrl('/api/download/windows-msi'),
    icon: 'mdi-microsoft-windows',
  },
  {
    os: 'linux-appimage',
    label: 'Linux (.AppImage)',
    file: resolveApiUrl('/api/download/appimage'),
    icon: 'mdi-linux',
  },
  {
    os: 'linux-deb',
    label: 'Linux (.deb)',
    file: resolveApiUrl('/api/download/deb'),
    icon: 'mdi-debian',
  },
  {
    os: 'android-apk',
    label: 'Android (.apk)',
    file: resolveApiUrl('/api/download/android-apk'),
    icon: 'mdi-android',
  },
];

const detectedOS = ref('');
const appVersion = `v${appPackage.version}`;
const isLoadingChecksums = ref(true);
const checksums = ref<Array<{ platform: string; filename: string; hash: string }>>([]);

type AndroidSigner = {
  certificateSha256: string;
  certificateSubject: string;
  keyAlgorithm: string;
  verifyCommand: string;
};
const androidSigner = ref<AndroidSigner | null>(null);

onMounted(() => {
  if (Platform.is.win) detectedOS.value = 'windows-exe';
  else if (Platform.is.linux) detectedOS.value = 'linux-appimage';

  void loadChecksums();
});

const columns = [
  {
    name: 'platform',
    label: 'Platform',
    field: 'platform',
    align: 'left' as const,
    style: 'width: 120px',
  },
  {
    name: 'filename',
    label: 'Filename',
    field: 'filename',
    align: 'left' as const,
    style: 'width: 200px',
  },
  { name: 'hash', label: 'SHA-256 Hash', field: 'hash', align: 'left' as const },
];

async function loadChecksums() {
  try {
    const response = await api.get('/api/download/checksums');
    const payload = response.data;
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];

    const signer = payload?.androidSigner;
    androidSigner.value =
      signer && typeof signer.certificateSha256 === 'string' ? (signer as AndroidSigner) : null;

    const platformLabels: Record<string, string> = {
      'windows-exe': 'Windows (.exe)',
      'windows-msi': 'Windows (.msi)',
      appimage: 'Linux (.AppImage)',
      deb: 'Linux (.deb)',
      'android-apk': 'Android (.apk)',
    };

    checksums.value = assets.map(
      (asset: {
        platform?: string;
        filename?: string;
        digest?: string | null;
        sha256?: string | null;
      }) => {
        const rawPlatform = String(asset.platform || '');
        const platform = platformLabels[rawPlatform] || rawPlatform.toUpperCase();
        return {
          platform,
          filename: String(asset.filename || ''),
          hash: String(asset.digest || asset.sha256 || 'Unavailable'),
        };
      },
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : null;
    console.error('Failed to load release checksums:', status || '', error);
    checksums.value = [
      {
        platform: 'N/A',
        filename: 'Release checksums unavailable',
        hash: status
          ? `Backend returned HTTP ${status}`
          : 'Check the backend /api/download/checksums endpoint',
      },
    ];
  } finally {
    isLoadingChecksums.value = false;
  }
}
</script>

<style scoped>
.download-page {
  background: var(--q-dark);
}
.download-page-shell {
  min-height: calc(100vh - 2rem);
  position: relative;
}
.hero h1 {
  letter-spacing: 0.15em;
}
.download-cards {
  width: 100%;
  justify-content: center;
  flex-wrap: wrap;
}
.security-verification {
  border: 1px solid color-mix(in srgb, var(--q-primary) 30%, transparent);
}
.checksum-table {
  background: transparent !important;
}

.checksum-table :deep(th) {
  color: var(--q-primary);
  font-weight: bold;
}

.checksum-table :deep(td) {
  border-color: color-mix(in srgb, var(--q-primary) 20%, transparent);
}

.download-page :deep(.download-card) {
  width: 100%;
  max-width: 320px;
  min-width: 0;
}

.download-page :deep(.q-table__container) {
  max-width: 100%;
  overflow-x: auto;
}

@media (max-width: 767px) {
  .download-page-shell {
    min-height: calc(100vh - 2rem);
  }

  .security-verification {
    padding: 1rem;
  }
}
</style>
