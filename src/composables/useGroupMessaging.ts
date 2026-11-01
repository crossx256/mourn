// composables/useGroupMessaging.ts
import { ref } from 'vue';
import { useGroupStore } from '@/stores/groupStore';

export function useGroupMessaging() {
  const groupStore = useGroupStore();
  const isProcessing = ref(false);

  async function acceptGroupInvitation(groupId: string) {
    isProcessing.value = true;
    try {
      // The group store owns the MLS TreeKEM init, backend dispatch, and
      // local tree-state persistence, so delegate there instead of
      // re-implementing the crypto/API calls here.
      const ok = await groupStore.respondToInvite(groupId, 'ACCEPTED');
      return ok;
    } catch (error) {
      console.error('Group initialization failed:', error);
      return false;
    } finally {
      isProcessing.value = false;
    }
  }

  return {
    acceptGroupInvitation,
    isProcessing,
  };
}
