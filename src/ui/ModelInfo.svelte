<script lang="ts">
  import { flushSync } from 'svelte';
  let rows = $state<Array<[string, string | number]>>([]);
  let collapsed = $state(false);
  export function update(next: Array<[string, string | number]>) { rows = next; }
</script>
<button type="button" class="model-info-toggle"
  title={collapsed ? "展开模型信息" : "收起模型信息"}
  aria-label={collapsed ? "展开模型信息" : "收起模型信息"}
  aria-expanded={!collapsed} onclick={() => flushSync(() => { collapsed = !collapsed; })}>{collapsed ? "‹" : "›"}</button>
<aside class="model-info" data-no-window-drag hidden={collapsed}>
  <h2>模型信息</h2>
  <table><tbody>
    {#each rows as [label, value] (label)}
      <tr><th scope="row">{label}</th><td>{typeof value === "number" ? value.toLocaleString() : value}</td></tr>
    {/each}
  </tbody></table>
</aside>
