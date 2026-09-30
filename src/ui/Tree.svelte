<script lang="ts">
  import { flushSync } from "svelte";
  import { ChevronDown, ChevronRight } from "lucide-svelte";
  import { visibleTreeRows, type TreeNode, type TreeRow } from "./tree";

  let { nodes, label, initialExpanded = [] }: {
    nodes: TreeNode[]; label: string; initialExpanded?: string[];
  } = $props();
  // The owner keys this component by the inspected document.
  // svelte-ignore state_referenced_locally
  let expanded = $state(new Set(initialExpanded));
  let active = $state("");
  let tree: HTMLDivElement;
  const rows = $derived(visibleTreeRows(nodes, expanded));
  const activeId = $derived(rows.some(row => row.node.id === active) ? active : rows[0]?.node.id);

  function toggle(node: TreeNode, open = !expanded.has(node.id)) {
    if (!node.children) return;
    const next = new Set(expanded);
    if (open) next.add(node.id);
    else next.delete(node.id);
    expanded = next;
  }

  function focus(id: string) {
    flushSync(() => { active = id; });
    tree.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }

  function keydown(event: KeyboardEvent, row: TreeRow, index: number) {
    let target: string | undefined;
    switch (event.key) {
      case "ArrowDown": target = rows[index + 1]?.node.id; break;
      case "ArrowUp": target = rows[index - 1]?.node.id; break;
      case "Home": target = rows[0]?.node.id; break;
      case "End": target = rows[rows.length - 1]?.node.id; break;
      case "ArrowRight":
        if (row.node.children && !expanded.has(row.node.id)) toggle(row.node, true);
        else if (row.node.children) target = rows[index + 1]?.node.id;
        break;
      case "ArrowLeft":
        if (expanded.has(row.node.id)) toggle(row.node, false);
        else target = row.parent;
        break;
      case "Enter":
      case " ": toggle(row.node); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target) focus(target);
  }
</script>

<div class="sdk-tree" role="tree" aria-label={label} bind:this={tree}>
  {#each rows as row, index (row.node.id)}
    <div class="sdk-tree-row" role="treeitem"
      aria-level={row.level} aria-posinset={row.position} aria-setsize={row.size}
      aria-selected={activeId === row.node.id}
      aria-expanded={row.node.children ? expanded.has(row.node.id) : undefined}
      tabindex={activeId === row.node.id ? 0 : -1}
      style:padding-left={`${6 + Math.min(row.level - 1, 8) * 12}px`}
      onfocus={() => { active = row.node.id; }}
      onclick={() => { focus(row.node.id); toggle(row.node); }}
      onkeydown={event => keydown(event, row, index)}>
      <span class="sdk-tree-chevron" aria-hidden="true">
        {#if row.node.children}
          {#if expanded.has(row.node.id)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
        {/if}
      </span>
      <span class="sdk-tree-content">
        <span class="sdk-tree-label">{row.node.label}</span>
        <span class="sdk-tree-value">{row.node.value}</span>
      </span>
    </div>
  {/each}
</div>
