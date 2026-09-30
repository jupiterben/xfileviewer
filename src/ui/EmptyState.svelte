<script lang="ts">
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import Images from "lucide-svelte/icons/images";
  import Settings from "lucide-svelte/icons/settings";

  let { message, version = "", onOpen, onSettings }: {
    message: string;
    version?: string;
    onOpen: () => void | Promise<void>;
    onSettings?: () => void;
  } = $props();
  let opening = $state(false);

  async function open() {
    if (opening) return;
    opening = true;
    try {
      await onOpen();
    } finally {
      opening = false;
    }
  }
</script>
<div class="empty-wrap">
  <div class="empty-content">
    <div class="empty-icon" aria-hidden="true"><Images size={40} strokeWidth={1.5} /></div>
    <p class="empty">{message}</p>
    <div class="empty-actions" data-no-window-drag>
      <button type="button" class="empty-open" onclick={open} disabled={opening} aria-busy={opening}>
        <FolderOpen size={16} aria-hidden="true" />
        <span>打开</span>
      </button>
      {#if onSettings}
        <button type="button" class="empty-settings" onclick={onSettings} disabled={opening}>
          <Settings size={16} aria-hidden="true" />
          <span>设置</span>
        </button>
      {/if}
    </div>
    {#if version}<p class="app-version">{version}</p>{/if}
  </div>
</div>
