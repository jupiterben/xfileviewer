<script lang="ts">
  let { name, path, onOpen, onReset, onRotate, onWireframe }: {
    name: string; path: string; onOpen?: () => void;
    onReset: () => void; onRotate: (checked: boolean) => void; onWireframe: (checked: boolean) => void;
  } = $props();
</script>
<div class="model-viewer">
  <div class="model-toolbar">
    {#if onOpen}<button type="button" title="打开模型 (Ctrl/Cmd+O)" onclick={onOpen}>打开</button>{/if}
    <span class="model-file-name" title={path}>{name}</span>
    <button type="button" onclick={onReset}>重置视角</button>
    <label><input type="checkbox" onchange={event => onRotate(event.currentTarget.checked)} />自动旋转</label>
    <label><input class="model-wireframe" type="checkbox" onchange={event => onWireframe(event.currentTarget.checked)} />线框</label>
  </div>
  <div class="model-main">
    <div class="model-viewport" data-no-window-drag>
      <div class="model-loading">正在加载模型…</div>
    </div>
  </div>
  <span class="model-status" role="status">正在加载模型…</span>
</div>
