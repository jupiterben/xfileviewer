<script lang="ts">
  let { message, version = '', onSettings }: { message: string; version?: string; onSettings?: () => void } = $props();
</script>
<div class="empty-wrap">
  <p class="empty">{message}</p>
  {#if onSettings}<button type="button" class="empty-settings" onclick={onSettings}>设置</button>{/if}
  {#if version}<p class="app-version">{version}</p>{/if}
</div>
