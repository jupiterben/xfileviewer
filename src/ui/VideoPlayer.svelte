<script lang="ts">
  // Playback backends attach their video surface and update these controls.
</script>
<div class="video-player">
  <div class="video-surface"></div>
  <div class="video-status" role="status" hidden></div>
  <div class="video-bar">
    <div class="video-nav-group">
      <button type="button" class="video-nav video-nav-prev" aria-label="上一个" disabled>‹</button>
      <button type="button" class="video-play" aria-label="播放/暂停">▶</button>
      <button type="button" class="video-nav video-nav-next" aria-label="下一个" disabled>›</button>
    </div>
    <span class="video-time video-current">0:00</span>
    <input type="range" class="video-seek" min="0" max="0" step="0.1" value="0" aria-label="播放进度" />
    <span class="video-time video-duration">0:00</span>
    <div class="video-volume-wrap" role="group" aria-label="音量控制">
      <button type="button" class="video-mute" aria-label="静音"></button>
      <div class="video-volume-pop">
        <div class="video-volume-rail">
          <div class="video-volume-track" aria-hidden="true">
            <div class="video-volume-fill"></div>
            <div class="video-volume-thumb"></div>
          </div>
          <input type="range" class="video-volume" min="0" max="100" step="1" aria-label="音量" />
        </div>
        <span class="video-volume-value" aria-hidden="true"></span>
      </div>
    </div>
  </div>
</div>
