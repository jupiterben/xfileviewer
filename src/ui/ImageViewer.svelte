<script lang="ts">
  import { onMount } from "svelte";
  import type { ViewerContext } from "../core/types";
  let { ctx }: { ctx: ViewerContext } = $props();
  let pending = $state(true);
  let imgEl: HTMLImageElement | undefined;
  let reported = false;

  onMount(() => {
    if (imgEl?.complete && imgEl.naturalWidth > 0) void reveal(imgEl);
  });

  function reportLoaded(event: Event) {
    void reveal(event.currentTarget as HTMLImageElement);
  }

  async function reveal(img: HTMLImageElement) {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (reported || width <= 0 || height <= 0) return;
    reported = true;
    // Wait until the window has been sized to this image. Reporting size
    // and painting immediately leaves the first frame laid out against
    // the default 1100×720 window; WebViewGTK then skips object-fit
    // after programmatic setSize, so the picture sits in the old
    // rectangle until a user resize or a remount.
    await ctx.onContentSize?.(width, height);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    void img.offsetWidth;
    pending = false;
  }
</script>

<img bind:this={imgEl} class="media image" class:image-pending={pending} alt={ctx.path} src={ctx.src}
  onload={reportLoaded}
  onerror={() => ctx.onError("无法加载图片：文件不可读或编码不受支持")} />
