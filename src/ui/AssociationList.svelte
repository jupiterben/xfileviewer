<script lang="ts">
  import type { AssociationRow } from "../shell/associationSettings";
  import { groupAssociationRows } from "../shell/associationSettings";
  let { onKind, onRow }: {
    onKind: (kind: string, checked: boolean) => void;
    onRow: (ext: string, checked: boolean) => void;
  } = $props();
  let rows = $state<AssociationRow[]>([]);
  let applying = $state(false);
  export function update(next: AssociationRow[], busy: boolean) {
    rows = next;
    applying = busy;
  }
</script>

{#each groupAssociationRows(rows) as group (group.kindId)}
  <label class="assoc-kind">
    <input type="checkbox" checked={group.checkState === "all"}
      indeterminate={group.checkState === "mixed"} disabled={applying}
      onchange={event => onKind(group.kindId, event.currentTarget.checked)} />
    <span>{group.label}</span>
  </label>
  <div class="assoc-exts">
    {#each group.rows as row (row.ext)}
      <label class="assoc-row" class:is-error={!!row.error} title={row.error || row.pluginName}>
        <input type="checkbox" checked={row.granted} disabled={applying}
          onchange={event => onRow(row.ext, event.currentTarget.checked)} />
        <span class="assoc-ext">.{row.ext}</span>
      </label>
    {/each}
  </div>
{/each}
