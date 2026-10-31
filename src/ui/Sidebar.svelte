<script lang="ts">
  import { message } from "@tauri-apps/plugin-dialog";
  import { basename, dirname } from "../core/path";
  import { ChevronDown, ChevronRight, File, Folder, FolderOpen, ListCollapse } from "lucide-svelte";
  import {
    buildFileTree, fileAncestors, filePathKey, visibleFileRows,
    type FileNode, type FileRow, type SidebarFolders,
  } from "./fileTree";
  import {
    chooseOtherApplication, listOpenWithApps, openFileWith, type OpenWithApp,
  } from "../shell/openWith";

  let { onSelect, onLoadDirectory = () => {} }: {
    onSelect: (index: number) => void;
    onLoadDirectory?: (path: string) => void;
  } = $props();

  let folders = $state<SidebarFolders>({ root: "", directories: [], loaded: [], loading: [], errors: {} });
  let expanded = $state(new Set<string>());
  let focused = $state<string | null>(null);
  let treeRoot = $state("");
  let treeDirectories = $state<string[]>([]);
  let lastItems: string[] | null = null;

  let items = $state<string[]>([]);
  let index = $state(-1);
  let filesOpen = $state(localStorage.getItem("sidebar-files-open") !== "0");
  let appsOpen = $state(localStorage.getItem("sidebar-apps-open") !== "0");
  let apps = $state<OpenWithApp[]>([]);
  let appsLoading = $state(false);
  let appsError = $state("");
  let launchingId = $state<string | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const currentPath = $derived(index >= 0 ? (items[index] ?? null) : null);
  const tree = $derived(buildFileTree(treeRoot, items, treeDirectories));
  const loadingSet = $derived(new Set(folders.loading));
  const loadedSet = $derived(new Set(folders.loaded));
  const rows = $derived(visibleFileRows(tree, expanded));
  const focusId = $derived(rows.some(row => row.node.id === focused) ? focused
    : rows.find(row => row.node.index === index && row.node.kind === "file")?.node.id ?? rows[0]?.node.id);
  const visibleCount = $derived(rows.filter(row => row.node.kind === "file").length);
  const activeAncestors = $derived(new Set(fileAncestors(folders.root, currentPath ?? "").map(filePathKey)));

  export function update(nextItems: string[], nextIndex: number, nextFolders?: SidebarFolders) {
    const previousPath = currentPath;
    const state = nextFolders ?? {
      root: nextItems[0] ? dirname(nextItems[0]) : "", directories: [], loaded: [], loading: [], errors: {},
    };
    if (state.session !== folders.session || filePathKey(state.root) !== filePathKey(folders.root)) {
      expanded = new Set();
      focused = null;
    }
    // Copy: scans mutate the sequence in place. Keep expansion across batches.
    if (nextItems !== lastItems || nextItems.length !== items.length) items = [...nextItems];
    lastItems = nextItems;
    treeRoot = state.root;
    if (state.directories.length !== treeDirectories.length
      || state.directories.some((path, at) => path !== treeDirectories[at])) treeDirectories = [...state.directories];
    index = nextIndex;
    folders = state;
    const path = nextItems[nextIndex];
    if (path && path !== previousPath) {
      expanded = new Set([...expanded, ...fileAncestors(state.root, path).map(filePathKey)]);
      focused = filePathKey(path);
    }
  }

  function toggleFolder(node: FileNode) {
    const next = new Set(expanded);
    if (next.has(node.id)) next.delete(node.id);
    else {
      next.add(node.id);
      onLoadDirectory(node.path);
    }
    expanded = next;
    focused = node.id;
  }

  function focusRow(id: string) {
    focused = id;
    // Focus after Svelte has applied the roving tabindex / newly expanded rows.
    queueMicrotask(() => listEl?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
  }

  function treeKeydown(event: KeyboardEvent, row: FileRow) {
    const at = rows.findIndex(item => item.node.id === row.node.id);
    let target: string | undefined;
    switch (event.key) {
      case "ArrowDown": target = rows[Math.min(at + 1, rows.length - 1)]?.node.id; break;
      case "ArrowUp": target = rows[Math.max(at - 1, 0)]?.node.id; break;
      case "Home": target = rows[0]?.node.id; break;
      case "End": target = rows[rows.length - 1]?.node.id; break;
      case "ArrowRight":
        if (row.node.kind === "directory") {
          if (!expanded.has(row.node.id)) toggleFolder(row.node);
          else target = row.node.children[0]?.id;
        }
        break;
      case "ArrowLeft":
        if (row.node.kind === "directory" && expanded.has(row.node.id)) toggleFolder(row.node);
        else target = row.parent;
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target) focusRow(target);
  }

  function toggleFiles() {
    filesOpen = !filesOpen;
    localStorage.setItem("sidebar-files-open", filesOpen ? "1" : "0");
  }

  function toggleApps() {
    appsOpen = !appsOpen;
    localStorage.setItem("sidebar-apps-open", appsOpen ? "1" : "0");
  }

  let appsRequest = 0;
  $effect(() => {
    const path = currentPath;
    const request = ++appsRequest;
    appsError = "";
    if (!path) {
      apps = [];
      appsLoading = false;
      return;
    }
    appsLoading = true;
    listOpenWithApps(path)
      .then(result => {
        if (request !== appsRequest) return;
        apps = result;
        appsLoading = false;
      })
      .catch(error => {
        if (request !== appsRequest) return;
        apps = [];
        appsError = String(error);
        appsLoading = false;
      });
  });

  $effect(() => {
    void currentPath;
    if (!filesOpen || !listEl) return;
    const active = listEl.querySelector(".sidebar-file.active");
    // jsdom (tests) does not implement scrollIntoView.
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  });

  async function launch(app: OpenWithApp) {
    const path = currentPath;
    if (!path || launchingId) return;
    launchingId = app.id;
    try {
      await openFileWith(path, app.id);
    } catch (error) {
      await message(String(error), { title: "无法打开文件", kind: "error" });
    } finally {
      launchingId = null;
    }
  }

  async function chooseOther() {
    const path = currentPath;
    if (!path) return;
    try {
      await chooseOtherApplication(path);
    } catch (error) {
      await message(String(error), { title: "无法打开程序选择器", kind: "error" });
    }
  }
</script>

<section class="sidebar-section" class:is-open={filesOpen}>
  <div class="sidebar-file-heading">
    <button type="button" class="sidebar-header" onclick={toggleFiles} aria-expanded={filesOpen} aria-controls="sidebar-file-tree">
      <span class="sidebar-chevron" aria-hidden="true">{filesOpen ? "▾" : "▸"}</span>
      <span class="sidebar-title">文件列表</span>
      <span class="sidebar-count" title="已加载的同类文件">{items.length}</span>
    </button>
    <button type="button" class="sidebar-tool" title="收起所有子目录" aria-label="收起所有子目录"
      disabled={!filesOpen || expanded.size === 0} onclick={() => { expanded = new Set(); focused = null; }}>
      <ListCollapse size={15} strokeWidth={1.7} />
    </button>
  </div>
  {#if filesOpen}
    <div class="sidebar-root" title={folders.root}>
      <Folder size={14} strokeWidth={1.7} />
      <span>{basename(folders.root) || folders.root || "当前目录"}</span>
    </div>
    <div id="sidebar-file-tree" class="sidebar-files" role="tree" aria-label="当前目录的文件与子目录" bind:this={listEl}>
      {#each rows as row (row.node.id)}
        {@const node = row.node}
        {@const isFolder = node.kind === "directory"}
        {@const isExpanded = isFolder && expanded.has(node.id)}
        {@const loading = isFolder && loadingSet.has(node.id)}
        {@const loaded = isFolder && loadedSet.has(node.id)}
        {@const error = folders.errors[node.id]}
        <button
          type="button" role="treeitem"
          class="sidebar-tree-row" class:sidebar-file={!isFolder} class:sidebar-folder={isFolder}
          class:active={!isFolder && node.index === index}
          class:contains-current={isFolder && activeAncestors.has(node.id)}
          style={`--level: ${row.level - 1}`}
          aria-level={row.level} aria-posinset={row.position} aria-setsize={row.size}
          aria-expanded={isFolder ? isExpanded : undefined}
          aria-selected={isFolder ? undefined : node.index === index}
          aria-busy={isFolder ? loading : undefined}
          aria-describedby={isExpanded && (error || loading || (loaded && node.children.length === 0)) ? `folder-status-${encodeURIComponent(node.id)}` : undefined}
          tabindex={focusId === node.id ? 0 : -1}
          title={error ? `${node.path}\n${error}\n收起后再次展开可重试` : node.path}
          onfocus={() => { focused = node.id; }}
          onkeydown={(event) => treeKeydown(event, row)}
          onclick={() => { if (isFolder) toggleFolder(node); else onSelect(node.index); }}
        >
          <span class="sidebar-row-chevron" aria-hidden="true">
            {#if isFolder}{#if isExpanded}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}{/if}
          </span>
          <span class="sidebar-row-icon" aria-hidden="true">
            {#if isFolder}{#if isExpanded}<FolderOpen size={15} strokeWidth={1.6} />{:else}<Folder size={15} strokeWidth={1.6} />{/if}
            {:else}<File size={14} strokeWidth={1.6} />{/if}
          </span>
          <span class="sidebar-file-name">{node.label}</span>
          {#if isFolder}
            <span class="sidebar-folder-count" title="已加载的同类文件数">{loading ? "…" : error ? "!" : loaded ? node.count : ""}</span>
          {/if}
        </button>
        {#if isExpanded && (error || loading || (loaded && node.children.length === 0))}
          <p id={`folder-status-${encodeURIComponent(node.id)}`} role="status" aria-live="polite"
            class="sidebar-folder-status" class:sidebar-error={!!error} style={`--level: ${row.level}`}>
            {error ? "读取失败，收起后展开可重试" : loading ? "正在读取…" : "没有同类文件"}
          </p>
        {/if}
      {:else}
        <p class="sidebar-empty">没有文件</p>
      {/each}
    </div>
    <div class="sidebar-summary">已显示 {visibleCount} / {items.length} 个同类文件<span>点击目录展开 / 收起</span></div>
  {/if}
</section>

<section class="sidebar-section sidebar-section-apps" class:is-open={appsOpen}>
  <button type="button" class="sidebar-header" onclick={toggleApps} aria-expanded={appsOpen}>
    <span class="sidebar-chevron">{appsOpen ? "▾" : "▸"}</span>
    <span class="sidebar-title">打开方式</span>
  </button>
  {#if appsOpen}
    <div class="sidebar-apps">
      {#if appsLoading}
        <p class="sidebar-empty">正在查询…</p>
      {:else if appsError}
        <p class="sidebar-empty sidebar-error" title={appsError}>{appsError}</p>
      {:else}
        {#each apps as app (app.id)}
          <button
            type="button"
            class="sidebar-app"
            disabled={!currentPath || launchingId !== null}
            title={`${app.name}\n${app.id}`}
            onclick={() => { void launch(app); }}
          >
            {#if app.icon}
              <img class="sidebar-app-icon" src={app.icon} alt="" draggable="false" />
            {:else}
              <span class="sidebar-app-icon sidebar-app-icon-fallback" aria-hidden="true">
                {app.name.slice(0, 1).toUpperCase()}
              </span>
            {/if}
            <span class="sidebar-app-name">
              {launchingId === app.id ? `正在打开… ${app.name}` : app.name}
            </span>
          </button>
        {:else}
          <p class="sidebar-empty">未找到关联程序</p>
        {/each}
      {/if}
      <button type="button" class="sidebar-app sidebar-app-other"
        disabled={!currentPath} onclick={() => { void chooseOther(); }}>
        <span class="sidebar-app-icon sidebar-app-icon-fallback" aria-hidden="true">⋯</span>
        <span class="sidebar-app-name">使用其他程序…</span>
      </button>
    </div>
  {/if}
</section>
