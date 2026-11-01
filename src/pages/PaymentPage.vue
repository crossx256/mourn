<template>
  <q-page class="min-h-screen bg-dash-bg flex items-start justify-center px-4 py-16 relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/dashboard"
      class="absolute left-4 top-4 text-primary z-10"
      aria-label="back to dashboard"
    />
    <div class="w-full max-w-[720px]">
      <h1 class="text-dash-text text-3xl font-bold lowercase tracking-wide text-center mb-2">
        payment
      </h1>
      <p class="text-dash-muted text-sm text-center mb-2">
        pick the rail that fits you — most private first, easiest last.
      </p>
      <q-separator class="bg-dash-border my-6 mx-auto w-24" />

      <!-- Philosophy -->
      <q-card flat class="bg-dash-card border border-solid border-dash-border mb-6">
        <q-card-section class="py-6 px-6">
          <h2 class="text-primary font-mono text-sm tracking-wide lowercase mb-3">
            / why we do this
          </h2>
          <p class="text-dash-muted text-sm leading-relaxed m-0">
            Mourn is a non-extractive ecosystem. We don't sell your data, we don't host ads, and we
            don't answer to corporate boards. This sanctuary exists solely because of individual
            contributions. By donating, you aren't just buying a badge; you are paying for the
            server's breath and the project's evolution. Stay human.
          </p>
        </q-card-section>
      </q-card>

      <!-- Selected Plan Summary + Selector -->
      <q-card flat class="bg-dash-card border border-solid border-dash-border mb-6">
        <q-card-section
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-4 px-6"
        >
          <div class="flex items-center gap-3">
            <q-icon :name="selectedPlan.icon" size="28px" class="text-primary" />
            <div>
              <div class="text-dash-text text-sm font-bold lowercase font-mono">
                {{ selectedPlan.label }}
              </div>
              <div class="text-dash-muted text-xs font-mono">{{ selectedPlanSubLabel }}</div>
            </div>
          </div>
          <div class="flex flex-col sm:items-end gap-2">
            <q-select
              v-model="selectedPlanId"
              :options="planOptions"
              emit-value
              map-options
              dense
              outlined
              dark
              options-dark
              class="min-w-[200px]"
              popup-content-class="bg-dash-panel text-dash-text"
            />
          </div>
        </q-card-section>
      </q-card>

      <!-- payment rails: most private -> least private -->
      <div class="flex items-baseline justify-between mb-3">
        <h2
          class="text-dash-text text-sm font-bold uppercase tracking-wider m-0 flex items-center gap-2 font-mono"
        >
          <q-icon name="mdi-shield-key-outline" size="18px" class="text-primary" />
          choose how you pay
        </h2>
        <span class="text-[10px] text-dash-muted font-mono lowercase">
          most private → easiest
        </span>
      </div>

      <div v-if="methodsLoading" class="text-dash-muted text-sm mb-6">loading rails…</div>

      <q-card
        v-else-if="loadFailed"
        flat
        class="bg-dash-card border border-solid border-dash-border mb-6"
      >
        <q-card-section class="py-6 px-6">
          <p class="text-dash-muted text-sm m-0 leading-relaxed">
            couldn't load the payment options just now. refresh, or reach out via
            <a
              href="https://discord.gg/sGp8A3nfKj"
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent decoration-none"
              >discord</a
            >
            and we'll sort it.
          </p>
        </q-card-section>
      </q-card>

      <div v-else class="flex flex-col gap-4 mb-6">
        <q-card
          v-for="rail in rails"
          :key="rail.key"
          flat
          class="bg-dash-card border border-solid border-dash-border"
        >
          <q-card-section class="py-5 px-6">
            <!-- rail header -->
            <div class="flex items-start justify-between gap-4 mb-3">
              <div class="flex items-center gap-3">
                <q-icon :name="rail.icon" size="26px" class="text-primary" />
                <div>
                  <div class="text-dash-text text-sm font-bold lowercase font-mono">
                    {{ rail.title }}
                  </div>
                  <div
                    class="text-[10px] uppercase tracking-wider font-mono"
                    :class="rail.tierClass"
                  >
                    {{ rail.tier }}
                  </div>
                </div>
              </div>
              <span
                v-if="rail.badge"
                class="text-[10px] font-mono lowercase px-2 py-1 border border-solid border-dash-border text-dash-muted whitespace-nowrap"
              >
                {{ rail.badge }}
              </span>
            </div>

            <p class="text-dash-muted text-sm leading-relaxed m-0">{{ rail.blurb }}</p>

            <p class="text-dash-muted text-[11px] leading-relaxed mt-3 mb-2 opacity-80">
              {{ rail.privacyNote }}
            </p>

            <p
              v-if="rail.networkNote"
              class="text-dash-warning text-[11px] leading-relaxed mt-0 mb-4 font-mono"
            >
              ⚠ {{ rail.networkNote }}
            </p>
            <div v-else class="mb-2"></div>

            <!-- ── address rails: monero / bitcoin / ethereum ── -->
            <template v-if="rail.key !== 'fiat'">
              <div
                v-if="rail.address"
                class="bg-dash-bg border border-solid border-dash-border p-3 mb-3 break-all font-mono text-xs text-dash-text leading-relaxed select-all"
              >
                {{ rail.address }}
              </div>

              <a
                v-if="rail.address && rail.key === 'xmr'"
                :href="moneroUri(rail.address)"
                class="block text-[10px] text-dash-muted font-mono lowercase underline decoration-dotted hover:text-primary mb-3"
              >
                tap to open in your monero wallet
              </a>

              <q-btn
                v-if="rail.address"
                no-caps
                unelevated
                class="w-full bg-dash-panel text-dash-text border border-solid border-dash-border hover:border-primary font-mono lowercase tracking-wide"
                icon="mdi-content-copy"
                :label="copiedKey === rail.key ? 'copied!' : `copy ${rail.key} address`"
                @click="copyValue(rail.address, rail.key)"
              />

              <p v-else class="text-dash-muted text-xs font-mono">
                address not configured yet — use another rail for now.
              </p>

              <!-- monero gets the from-zero walkthrough -->
              <template v-if="rail.key === 'xmr'">
                <q-expansion-item
                  dense
                  switch-toggle-side
                  icon="mdi-school-outline"
                  label="never used crypto before?"
                  class="mt-4 border border-solid border-dash-border bg-dash-bg mb-2"
                  header-class="text-dash-text text-xs font-mono lowercase"
                >
                  <div class="px-4 pb-4 pt-1">
                    <ol class="text-dash-muted text-xs leading-loose m-0 pl-5 flex flex-col gap-1">
                      <li>
                        install a free monero wallet — we recommend
                        <span class="text-dash-text">Cake Wallet</span> (iPhone or Android) or
                        <span class="text-dash-text">Feather</span> (Windows / Linux).
                      </li>
                      <li>
                        open it, tap <span class="text-dash-text">receive</span>, and you now own a
                        monero address (a long code starting with 4 or 8).
                      </li>
                      <li>
                        get monero. easiest route: buy a little bitcoin, eth or usdt with a card,
                        then swap it to monero inside your wallet. if you already use an exchange
                        that lists monero, just buy it there.
                      </li>
                      <li>
                        send it to the mourn address above, then paste the transaction id in the box
                        at the bottom of this page.
                      </li>
                    </ol>
                  </div>
                </q-expansion-item>

                <q-expansion-item
                  dense
                  switch-toggle-side
                  icon="mdi-wallet-outline"
                  label="already have crypto?"
                  class="border border-solid border-dash-border bg-dash-bg"
                  header-class="text-dash-text text-xs font-mono lowercase"
                >
                  <div class="px-4 pb-4 pt-1">
                    <ol class="text-dash-muted text-xs leading-loose m-0 pl-5 flex flex-col gap-1">
                      <li>copy the address above (or tap it to open your wallet).</li>
                      <li>send monero (xmr) from your wallet to it.</li>
                      <li>paste the transaction id in the box below — that's the whole process.</li>
                    </ol>
                  </div>
                </q-expansion-item>
              </template>
            </template>

            <!-- ── fiat: card / paypal / ko-fi ── -->
            <template v-else>
              <a
                v-if="rail.receiveLink"
                :href="rail.receiveLink"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center justify-center gap-2 w-full py-3 px-4 bg-primary text-white font-mono lowercase tracking-wide decoration-none hover:opacity-90 transition-opacity"
              >
                <q-icon name="mdi-open-in-new" size="18px" />
                continue to payment
              </a>
              <p v-else class="text-dash-muted text-xs font-mono">
                payment link not configured yet — use another rail for now.
              </p>
            </template>
          </q-card-section>
        </q-card>
      </div>

      <!-- Proof of payment -->
      <q-card
        v-if="showProof"
        flat
        class="bg-dash-card border border-solid border-dash-border mb-6"
      >
        <q-card-section class="py-6 px-6">
          <h2
            class="text-dash-text text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 font-mono"
          >
            <q-icon name="mdi-check-decagram-outline" size="18px" class="text-primary" />
            proof of payment
          </h2>

          <p v-if="!isLoggedIn" class="text-dash-muted text-sm m-0 leading-relaxed">
            <router-link to="/login" class="text-accent decoration-none">log in</router-link>
            and submit your transaction id — we match it to your account so we know who to upgrade.
          </p>

          <template v-else>
            <q-select
              v-model="proofMethod"
              :options="methodOptions"
              emit-value
              map-options
              dense
              outlined
              dark
              label="which rail did you use?"
              class="mb-4"
              color="red"
              options-dark
              popup-content-class="bg-dash-panel text-dash-text"
            />

            <q-input
              v-model="txHash"
              outlined
              dense
              placeholder="paste your transaction id (tx hash)"
              class="mb-4"
              input-class="font-mono text-xs"
              color="red"
              dark
            >
              <template #prepend>
                <q-icon name="mdi-key-outline" size="18px" class="text-dash-muted" />
              </template>
            </q-input>

            <q-input
              v-model="userNote"
              outlined
              dense
              :placeholder="userNotePlaceholder"
              class="mb-5"
              input-class="font-mono text-xs"
              color="red"
              dark
            >
              <template #prepend>
                <q-icon name="mdi-account-outline" size="18px" class="text-dash-muted" />
              </template>
            </q-input>

            <q-btn
              no-caps
              unelevated
              class="w-full bg-primary text-white font-mono lowercase tracking-wide"
              icon="mdi-send"
              label="submit proof"
              :loading="submitting"
              :disable="submitting || !txHash.trim() || (isUserNoteRequired && !userNote.trim())"
              @click="submitProof"
            />
          </template>
        </q-card-section>
      </q-card>

      <!-- Disclaimer -->
      <p class="text-dash-muted text-[11px] text-center leading-relaxed">
        payments are processed manually. once verified, your account will be upgraded.
        <br />
        if you have issues, reach out via
        <a
          href="https://discord.gg/sGp8A3nfKj"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:text-accent-secondary transition-colors decoration-none"
          >discord</a
        >.
      </p>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMeta, useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';

useMeta({
  title: 'payment — mourn',
  meta: {
    description: {
      name: 'description',
      content:
        'Support mourn — pay with Monero, Bitcoin, Ethereum, or card. Pick your own privacy level.',
    },
  },
});

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

type RailKey = 'xmr' | 'btc' | 'eth' | 'fiat';

type PaymentMethodConfig = {
  key: RailKey;
  enabled: boolean;
  address: string | null;
  receiveLink: string | null;
};

type RailDisplay = {
  key: RailKey;
  title: string;
  icon: string;
  tier: string;
  tierClass: string;
  badge: string;
  blurb: string;
  privacyNote: string;
  networkNote: string;
  address: string | null;
  receiveLink: string | null;
};

// Rendering order is fixed: most private first, most convenient last. Copy lives
// here; the backend owns only the key, the enabled flag and the address/link.
// No address is hardcoded anywhere — admin -> donations is the single source.
const RAIL_META: Record<RailKey, Omit<RailDisplay, 'address' | 'receiveLink' | 'key'>> = {
  xmr: {
    title: 'monero (xmr)',
    icon: 'mdi-shield-lock-outline',
    tier: 'maximum privacy',
    tierClass: 'text-primary',
    badge: 'recommended',
    blurb:
      'The private rail. A payment no bank, processor or middleman can see, reverse, or tie to anyone.',
    privacyNote:
      'We never learn who you are. You never learn who we are. No financial body learns either of us.',
    networkNote: '',
  },
  btc: {
    title: 'bitcoin (btc)',
    icon: 'mdi-currency-btc',
    tier: 'high privacy',
    tierClass: 'text-dash-warning',
    badge: '',
    blurb: 'Widely held and easy to send. No processor holds your identity.',
    privacyNote:
      'We never learn who you are. You never learn who we are. But the bitcoin ledger is public — anyone can watch the coins move and total them up.',
    networkNote: 'bitcoin network only. sending on any other chain means lost funds.',
  },
  eth: {
    title: 'ethereum (eth)',
    icon: 'mdi-ethereum',
    tier: 'high privacy',
    tierClass: 'text-dash-warning',
    badge: '',
    blurb: 'Common, but the most expensive to send and the most visible.',
    privacyNote:
      'We never learn who you are. You never learn who we are. But the ethereum ledger is public — anyone can watch the coins move and total them up.',
    networkNote:
      'ethereum mainnet only. gas fees apply — and sending on another network means extra recovery steps, so check before you send.',
  },
  fiat: {
    title: 'card / paypal / ko-fi',
    icon: 'mdi-credit-card-outline',
    tier: 'medium privacy',
    tierClass: 'text-dash-muted',
    badge: 'easiest',
    blurb:
      'The easy rail. No wallet, no crypto, no setup — just tap and pay with a card or PayPal.',
    privacyNote:
      'We never learn who you are. You never learn who we are. A payment processor learns some details about you — that is how fiat rails work.',
    networkNote: '',
  },
};

const RAIL_ORDER: RailKey[] = ['xmr', 'btc', 'eth', 'fiat'];

const methods = ref<PaymentMethodConfig[]>([]);
const methodsLoading = ref(true);
const loadFailed = ref(false);

const rails = computed<RailDisplay[]>(() => {
  const byKey = new Map(methods.value.map((method) => [method.key, method]));
  return RAIL_ORDER.filter((key) => byKey.get(key)?.enabled).map((key) => {
    const method = byKey.get(key)!;
    return {
      key,
      ...RAIL_META[key],
      address: method.address,
      receiveLink: method.receiveLink,
    };
  });
});

const showProof = computed(() => rails.value.some((rail) => rail.key === 'xmr'));

async function loadMethods() {
  methodsLoading.value = true;
  loadFailed.value = false;
  try {
    const response = await api.get('/api/v1/public/payment-methods');
    const list = (response.data?.data?.methods || []) as PaymentMethodConfig[];
    methods.value = list;
  } catch {
    // Deliberately show nothing rather than a guessed address: this page moves
    // money, and a stale hardcoded address is worse than an honest error.
    methods.value = [];
    loadFailed.value = true;
  } finally {
    methodsLoading.value = false;
  }
}

onMounted(loadMethods);

const moneroUri = (address: string) => `monero:${encodeURIComponent(address)}`;

const copiedKey = ref<RailKey | null>(null);

async function copyValue(value: string | null, key: RailKey) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 2000);
  } catch {
    $q.notify({ type: 'negative', message: 'failed to copy', position: 'bottom' });
  }
}

// --- plan selection (unchanged) ---

const txHash = ref('');
const userNote = ref('');
const proofMethod = ref<RailKey>('xmr');
const submitting = ref(false);

const isLoggedIn = computed(() => authStore.isLoggedIn);

// Only the rails a donor can paste a txid for — a card payment arrives through the
// processor and never reaches this form.
const methodOptions = computed(() =>
  rails.value
    .filter((rail) => rail.key !== 'fiat')
    .map((rail) => ({ label: rail.title, value: rail.key })),
);

interface PlanInfo {
  id: string;
  label: string;
  price: string;
  period: string;
  icon: string;
}

const planMap: Record<string, PlanInfo> = {
  monthly: {
    id: 'monthly',
    label: 'monthly',
    price: '4',
    period: '/mo',
    icon: 'mdi-calendar-month',
  },
  yearly: {
    id: 'yearly',
    label: 'yearly',
    price: '40',
    period: '/yr',
    icon: 'mdi-star-four-points',
  },
  lifetime: {
    id: 'lifetime',
    label: 'lifetime',
    price: '110',
    period: ' once',
    icon: 'mdi-infinity',
  },
  contribution: {
    id: 'contribution',
    label: 'general contribution',
    price: 'custom',
    period: '',
    icon: 'mdi-heart-flash',
  },
};

const planOptions = Object.values(planMap).map((plan) => ({
  label:
    plan.id === 'contribution'
      ? `${plan.label} — ${plan.price}`
      : `${plan.label} — $${plan.price}${plan.period}`,
  value: plan.id,
}));

const initialPlanId = (() => {
  const planQuery = route.query.plan as string | undefined;
  return planQuery && planMap[planQuery] ? planQuery : 'monthly';
})();

const selectedPlanId = ref<string>(initialPlanId);

const selectedPlan = computed<PlanInfo>(() => planMap[selectedPlanId.value] ?? planMap.monthly!);
const isContributionPlan = computed(() => selectedPlanId.value === 'contribution');
const isUserNoteRequired = computed(() => !isContributionPlan.value);

const selectedPlanSubLabel = computed(() => {
  return isContributionPlan.value ? 'mourn contribution' : 'mourn donation';
});
const userNotePlaceholder = computed(() => {
  if (isContributionPlan.value) return 'your mourn username (optional note)';
  return 'your mourn username (required for donor status)';
});

watch(
  () => selectedPlanId.value,
  (planId) => {
    void router.replace({ query: { ...route.query, plan: planId } });
  },
);

async function submitProof() {
  if (!txHash.value.trim()) return;
  if (isUserNoteRequired.value && !userNote.value.trim()) {
    $q.notify({
      type: 'negative',
      message: 'mourn username is required to become a donor.',
      position: 'bottom',
    });
    return;
  }

  submitting.value = true;
  try {
    // Writes need the CSRF token. On web it rides in a cookie that this session may
    // not have touched yet, so ask for it before the first submission.
    if (!authStore.csrfToken) await authStore.fetchCsrfToken();

    await api.post(
      '/api/v1/payments/proof',
      {
        txid: txHash.value.trim(),
        method: proofMethod.value,
        plan: selectedPlanId.value,
        memo: userNote.value.trim() || null,
      },
      { headers: { 'X-CSRF-Token': authStore.csrfToken } },
    );

    $q.notify({
      type: 'positive',
      message: "proof submitted — we'll verify and upgrade your account shortly.",
      position: 'bottom',
      timeout: 5000,
    });

    txHash.value = '';
    userNote.value = '';
  } catch (error) {
    const response = (
      error as { response?: { status?: number; data?: { error?: string } } }
    )?.response;

    if (response?.status === 401) {
      $q.notify({
        type: 'negative',
        message: 'your session expired — log in again and resubmit',
        position: 'bottom',
      });
      return;
    }

    // 409 (already submitted) and 400 (bad txid) both carry a specific, safe
    // message from the API — show it rather than a generic failure.
    $q.notify({
      type: 'negative',
      message: response?.data?.error || 'could not submit your proof — try again in a moment',
      position: 'bottom',
    });
  } finally {
    submitting.value = false;
  }
}
</script>
