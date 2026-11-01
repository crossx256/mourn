<template>
  <RegisterPage v-if="activationToken" :key="activationToken" />
  <RegistrationApplicationPage v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import RegisterPage from 'src/pages/RegisterPage.vue';
import RegistrationApplicationPage from 'src/pages/RegistrationApplicationPage.vue';

const route = useRoute();

const activationToken = computed(() => {
  const token = route.query.token;
  return typeof token === 'string' ? token.trim() : '';
});
</script>
