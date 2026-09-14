<script lang="ts">
  import type { ViewerContext } from "../core/types";
  let { ctx }: { ctx: ViewerContext } = $props();

  function reportLoaded(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (width <= 0 || height <= 0) return;
    // Force a synchronous layout flush on the freshly-mounted <img>.
    // Without this, the first paint can show the image at its intrinsic
    // size anchored to (0, 0) — until the next reflow (a manual resize
    // or a navigate) finally applies object-fit: contain +
    // object-position: center and visibly recentres the picture.
    void img.offsetWidth;
    ctx.onContentSize?.(width, height);
  }
</script>

<img class="media image" alt={ctx.path} src={ctx.src}
  onload={reportLoaded}
  onerror={() => ctx.onError("无法加载图片：文件不可读或编码不受支持")} />
