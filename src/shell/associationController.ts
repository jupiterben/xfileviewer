import { invoke } from "@tauri-apps/api/core";
import type { PluginRegistry } from "../core/registry";
import { associationDecision, rememberAssociation, type AssociationSettings } from "./associations";
import {
  associationChanges, buildAssociationRows, groupAssociationRows, mergeAssociationState,
  setAssociationRowError, setKindGranted, setRowGranted, type AssociationRow,
} from "./associationSettings";

interface AssociationQuery {
  osManaged: boolean;
  granted: Record<string, boolean>;
}

export function createAssociationController(
  registry: PluginRegistry,
  onVisibilityChange: (open: boolean) => void,
) {
  const page = document.querySelector<HTMLElement>("#settings")!;
  const list = document.querySelector<HTMLElement>("#settings-list")!;
  const apply = document.querySelector<HTMLButtonElement>("#settings-apply")!;
  const back = document.querySelector<HTMLButtonElement>("#settings-back")!;
  const overlay = document.querySelector<HTMLElement>("#assoc-overlay")!;
  const text = document.querySelector<HTMLElement>("#assoc-text")!;
  const yes = document.querySelector<HTMLButtonElement>("#assoc-yes")!;
  const no = document.querySelector<HTMLButtonElement>("#assoc-no")!;
  let settings: AssociationSettings = { granted: [], denied: [] };
  let appliedRows: AssociationRow[] = [];
  let rows: AssociationRow[] = [];
  let applying = false;

  async function refresh() {
    rows = buildAssociationRows(registry.extensionsWithPlugins());
    try {
      const query = await invoke<AssociationQuery>("query_file_associations", {
        extensions: rows.map(row => row.ext),
      });
      rows = mergeAssociationState(rows, query.granted, settings, query.osManaged);
    } catch {
      rows = mergeAssociationState(rows, {}, settings, false);
    }
    appliedRows = rows;
    render();
  }

  function render() {
    list.replaceChildren();
    for (const group of groupAssociationRows(rows)) {
      const heading = document.createElement("label");
      heading.className = "assoc-kind";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = group.checkState === "all";
      input.indeterminate = group.checkState === "mixed";
      input.disabled = applying;
      input.addEventListener("change", () => {
        rows = setKindGranted(rows, group.kindId, input.checked);
        render();
      });
      const name = document.createElement("span");
      name.textContent = group.label;
      heading.append(input, name);
      list.append(heading);
      const wrap = document.createElement("div");
      wrap.className = "assoc-exts";
      for (const row of group.rows) {
        const label = document.createElement("label");
        label.className = "assoc-row";
        label.title = row.error || row.pluginName;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = row.granted;
        checkbox.disabled = applying;
        checkbox.addEventListener("change", () => {
          rows = setRowGranted(rows, row.ext, checkbox.checked);
          render();
        });
        const ext = document.createElement("span");
        ext.className = "assoc-ext";
        ext.textContent = `.${row.ext}`;
        label.append(checkbox, ext);
        if (row.error) label.classList.add("is-error");
        wrap.append(label);
      }
      list.append(wrap);
    }
    const changes = associationChanges(appliedRows, rows);
    apply.disabled = applying || (changes.grant.length === 0 && changes.revoke.length === 0);
  }

  async function applyChanges() {
    if (applying) return;
    const { grant, revoke } = associationChanges(appliedRows, rows);
    applying = true;
    render();
    const errors: Record<string, string> = {};
    try {
      for (const [extensions, command, granted] of [
        [grant, "grant_file_associations", true],
        [revoke, "revoke_file_associations", false],
      ] as const) {
        for (const ext of extensions) {
          try {
            await invoke(command, { extensions: [ext] });
            settings = rememberAssociation(settings, [ext], granted);
          } catch (error) {
            errors[ext] = String(error) || "无法关联";
          }
        }
      }
      await invoke("save_association_settings", { settings });
      await refresh();
    } finally {
      applying = false;
      for (const [ext, error] of Object.entries(errors)) rows = setAssociationRowError(rows, ext, error);
      render();
    }
  }

  function close() {
    if (page.hidden) return;
    page.hidden = true;
    onVisibilityChange(false);
  }

  back.addEventListener("click", close);
  apply.addEventListener("click", () => {
    void applyChanges().catch(error => console.error("[associations] save failed", error));
  });

  return {
    close,
    isOpen: () => !page.hidden,
    isPromptOpen: () => !overlay.hidden,
    isInteractionBlocked: () => !page.hidden || !overlay.hidden,
    async load() {
      try {
        const loaded = await invoke<AssociationSettings>("load_association_settings");
        if (!loaded || ![loaded.granted, loaded.denied].every(
          values => Array.isArray(values) && values.every(value => typeof value === "string"),
        )) throw new Error("Invalid association settings");
        settings = loaded;
      } catch (error) {
        console.warn("[associations] using defaults; saved settings were not changed", error);
      }
    },
    async open() {
      page.hidden = false;
      onVisibilityChange(true);
      await refresh();
    },
    async promptFor(path: string) {
      const plugin = registry.pluginFor(path);
      if (!plugin?.requestAssociation) return;
      const exts = plugin.viewers.flatMap(viewer => viewer.extensions);
      if (associationDecision(settings, exts) !== "ask") return;
      text.textContent = `插件「${plugin.name}」想关联 ${exts.map(ext => "." + ext).join(" ")}，设为默认打开方式？`;
      overlay.hidden = false;
      const granted = await new Promise<boolean>(resolve => {
        const finish = (value: boolean) => {
          overlay.hidden = true;
          yes.removeEventListener("click", onYes);
          no.removeEventListener("click", onNo);
          resolve(value);
        };
        const onYes = () => finish(true);
        const onNo = () => finish(false);
        yes.addEventListener("click", onYes);
        no.addEventListener("click", onNo);
      });
      settings = rememberAssociation(settings, exts, granted);
      try {
        await invoke("save_association_settings", { settings });
        if (granted) await invoke("grant_file_associations", { extensions: exts });
      } catch (error) {
        console.warn("[associations] could not persist association", error);
      }
    },
  };
}
