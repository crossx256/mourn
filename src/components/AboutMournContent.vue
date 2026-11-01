<template>
    <div class="content-container column items-center text-center">
      <div class="logo-section q-mb-xl">
        <MournLogoInline class="mourn-logo text-primary" />

      </div>

      <div class="text-block q-mb-xl">
        <h2 class="text-primary font-mono q-mb-md">// What's Mourn?</h2>
        <div class="manifesto-body text-body1">
          <p>
            Mourn is a private social ecosystem that is actively growing. It's a place where you can
            have genuine human connection and improve as a person while doing so.
          </p>
          <p>It currently includes:</p>
        </div>

        <div class="features-grid row q-col-gutter-md justify-center">
          <div class="col-12 text-left">
            <div class="feature-item q-pa-md bordered-panel">
              customizable profiles (biolinks at
              <span class="text-primary">mourn.bio/{username}</span>)
            </div>
          </div>
          <div class="col-12 text-left">
            <div class="feature-item q-pa-md bordered-panel">
              educational center (Archives at <span class="text-primary">mourn.bio/archives</span>)
            </div>
          </div>
          <div class="col-12 text-left">
            <div class="feature-item q-pa-md bordered-panel">
              our own 3D universe where you can leave a message as a star (The Graveyard at
              <span class="text-primary">mourn.bio/graveyard</span>)
            </div>
          </div>
          <div class="col-12 text-left">
            <div class="feature-item q-pa-md bordered-panel">
              our own desktop app that comes with secure E2EE communication where you can message your
              friends on mourn
            </div>
          </div>
          <div class="col-12 text-left">
            <div class="feature-item q-pa-md bordered-panel">
              many security features meant to guarantee your safety and privacy
            </div>
          </div>
        </div>
      </div>

      <div class="text-block q-mb-xl">
        <h2 class="text-primary font-mono text-subtitle1 q-mb-md">// What's our Goal?</h2>
        <div class="manifesto-body text-body1">
          <p>
            The internet is now filled with ads, AI slop, propaganda, psychological warfare, and
            algorithms that mentally abuse the user. (And of course subscriptions everywhere.)
          </p>
          <p>
            All of these systems are exposed in the Archives, along with ways to break out of them and
            improve your life — we urge you to check them out.
          </p>
          <p>
            Mourn is meant to be the safe space on the internet where you don't have to worry about any
            of that.
          </p>
          <p>
            With that said, everything on mourn is <strong>Free</strong>. We don't want your money, all
            we want is you to improve as a person and in turn improve the communities you interact with.
          </p>
          <p>
            Mourn's goal is to change the world for the better, and that will be done by our users and
            members of mourn.
          </p>
        </div>
      </div>

      <div v-if="showBackLink" class="q-mt-xl opacity-50 hover-opacity-100">
        <q-btn flat no-caps label="[ back to main ]" to="/" class="font-mono" />
      </div>
    </div>

</template>

<script setup lang="ts">
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';

withDefaults(defineProps<{ showBackLink?: boolean }>(), { showBackLink: false });
</script>

<style scoped>
.about-page {
  font-family: 'Courier New', 'Consolas', monospace;
  overflow-x: hidden;
}

.about-back-btn {
  position: fixed;
  left: 16px;
  top: calc(env(safe-area-inset-top) + 68px);
  z-index: 100;
}

.content-container {
  font-family: 'Courier New', 'Consolas', monospace;
  max-width: 850px;
  width: 100%;
  padding: 0 20px;
}

.logo-section .mourn-logo {
  width: 350px; /* Desktop size */
  max-width: 80vw;
  height: auto;
  transition: transform 0.5s ease;
}

.text-block {
  width: 100%;
  max-width: 700px;
}

.manifesto-body p {
  line-height: 1.7;
  font-size: 0.93rem;
  margin-bottom: 1.5rem;
  color: var(--q-secondary);
  text-align: center;
  opacity: 0.85;
}

.text-block h2 {
  font-size: 1.02rem;
  font-weight: 700;
}

.features-grid {
  align-items: stretch;
}

.features-grid > [class*='col-'] {
  display: flex;
}

.feature-item {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  color: var(--q-secondary);
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 0.8rem;
  line-height: 1.6;
}

.bordered-panel {
  border: 1px solid #1a1a1a;
  border-radius: 0;
  background: #101010;
  transition: border 0.3s ease;
}

.bordered-panel:hover {
  border-color: var(--q-primary);
}

.letter-spacing-3 {
  letter-spacing: 3px;
}

.opacity-70 {
  opacity: 0.7;
}
.opacity-80 {
  opacity: 0.8;
}
.hover-opacity-100:hover {
  opacity: 1;
}

.content-container :deep(.q-btn) {
  border-radius: 0;
}

/* Mobile Adjustments */
@media (max-width: 600px) {
  .about-back-btn {
    z-index: 1;
  }

  .logo-section .mourn-logo {
    width: 220px;
  }
  .manifesto-body p {
    text-align: center;
  }
  .feature-item {
    text-align: center;
  }
}
</style>
