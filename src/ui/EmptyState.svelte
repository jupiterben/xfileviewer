<script lang="ts">
  let { message, version = '', onSettings }: { message: string; version?: string; onSettings?: () => void } = $props();
</script>
<div class="empty-wrap">
  <div class="empty-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.8" />
      <path d="m21 15-4.2-4.2a1.6 1.6 0 0 0-2.26 0L7 18.3" />
    </svg>
  </div>
  <p class="empty">{message}</p>
  {#if onSettings}<button type="button" class="empty-settings" onclick={onSettings}>设置</button>{/if}
  {#if version}<p class="app-version">{version}</p>{/if}
</div>
