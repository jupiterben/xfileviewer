<script lang="ts">
  import { message } from "@tauri-apps/plugin-dialog";
  import { basename } from "../core/path";
  import {
    chooseOtherApplication, listOpenWithApps, openFileWith, type OpenWithApp,
  } from "../shell/openWith";

  let { onSelect }: { onSelect: (index: number) => void } = $props();

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

  export function update(nextItems: string[], nextIndex: number) {
    // Copy: the shell mutates the sequence array in place while scanning, and
    // re-assigning the same reference would not re-render.
    items = [...nextItems];
    index = nextIndex;
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
    void index;
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
  <button type="button" class="sidebar-header" onclick={toggleFiles} aria-expanded={filesOpen}>
    <span class="sidebar-chevron">{filesOpen ? "▾" : "▸"}</span>
    <span class="sidebar-title">文件列表</span>
    <span class="sidebar-count">{items.length}</span>
  </button>
  {#if filesOpen}
    <div class="sidebar-files" bind:this={listEl}>
      {#each items as item, i (item)}
        <button
          type="button"
          class="sidebar-file"
          class:active={i === index}
          title={item}
          onclick={() => onSelect(i)}
        >{basename(item)}</button>
      {:else}
        <p class="sidebar-empty">没有文件</p>
      {/each}
    </div>
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
