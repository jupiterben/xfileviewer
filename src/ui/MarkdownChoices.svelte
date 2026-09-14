<script lang="ts">
  import { MARKDOWN_THEMES, type MarkdownTheme } from '../plugins/markdown/themes';
  import { MARKDOWN_WIDTHS, type MarkdownWidth } from '../plugins/markdown/widths';
  let { onTheme, onWidth }: { onTheme: (theme: MarkdownTheme) => void; onWidth: (width: MarkdownWidth) => void } = $props();
  let selected = $state(0);
  let theme = $state('');
  let width = $state('');
  export function update(index: number, themeId: string, widthId: string) {
    selected = index; theme = themeId; width = widthId;
  }
</script>
<div class="md-theme-picker-label">主题</div>
{#each MARKDOWN_THEMES as item, index (item.id)}
  <button type="button" role="option" aria-selected={index === selected}
    data-current={item.id === theme ? "true" : undefined} onclick={() => onTheme(item)}>{item.label}</button>
{/each}
<div class="md-theme-picker-label">宽度</div>
{#each MARKDOWN_WIDTHS as item, index (item.id)}
  <button type="button" role="option" aria-selected={MARKDOWN_THEMES.length + index === selected}
    data-current={item.id === width ? "true" : undefined} onclick={() => onWidth(item)}>{item.label}</button>
{/each}
