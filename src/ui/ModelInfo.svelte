<script lang="ts">
  import { flushSync } from 'svelte';
  import type { FbxDetails } from "../plugins/model/fbx/details";
  import Tree from "./Tree.svelte";
  import { valueTree } from "./tree";
  let rows = $state<Array<[string, string | number]>>([]);
  let collapsed = $state(false);
  let details = $state.raw<FbxDetails | undefined>();
  const nodes = $derived.by(() => {
    if (!details) return [];
    const scene = valueTree("scene", details.scene, "scene");
    const children = scene.children!;
    const first = ["rootNode", "globalSettings", "materials", "textures", "animStacks", "poses", "cameras", "lights", "videos", "connections"];
    scene.children = () => children().slice().sort((a, b) => {
      const rank = (label: string) => first.includes(label) ? first.indexOf(label) : first.length;
      return rank(a.label) - rank(b.label);
    });
    return [scene, valueTree("document", details.document, "document")];
  });
  export function update(next: Array<[string, string | number]>, sdk?: FbxDetails) {
    rows = next;
    details = sdk;
  }
</script>
{#snippet statistics()}
  <table><tbody>
    {#each rows as [label, value] (label)}
      <tr><th scope="row">{label}</th><td>{typeof value === "number" ? value.toLocaleString() : value}</td></tr>
    {/each}
  </tbody></table>
{/snippet}
<button type="button" class="model-info-toggle"
  title={collapsed ? "展开模型信息" : "收起模型信息"}
  aria-label={collapsed ? "展开模型信息" : "收起模型信息"}
  aria-expanded={!collapsed} onclick={() => flushSync(() => { collapsed = !collapsed; })}>{collapsed ? "‹" : "›"}</button>
<aside class="model-info" class:model-info-sdk={!!details} data-no-window-drag hidden={collapsed}>
  {#if details}
    <details class="model-summary">
      <summary>模型信息</summary>
      {@render statistics()}
    </details>
    <section class="model-sdk">
      <h2>FBX SDK 详情</h2>
      <p class="model-sdk-meta">@infloopgame/lib-fbx · {details.document.format} · {details.document.version}</p>
      {#key details}
        <Tree {nodes} label="FBX SDK 详情" initialExpanded={["scene"]} />
      {/key}
    </section>
  {:else}
    <h2>模型信息</h2>
    {@render statistics()}
  {/if}
</aside>
