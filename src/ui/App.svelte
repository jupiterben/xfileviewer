<script lang="ts"></script>
<div class="main-row">
  <aside id="sidebar" class="sidebar" data-no-window-drag hidden></aside>
  <div class="workspace">
      <div id="viewer-host" class="viewer-host"></div>
      <button type="button" id="prev" class="nav nav-prev" disabled aria-label="上一张">
        ‹
      </button>
      <button type="button" id="next" class="nav nav-next" disabled aria-label="下一张">
        ›
      </button>
      <button type="button" id="media-window-mode" class="media-window-mode" hidden>
        适应尺寸
      </button>
    </div>
</div>
    <div id="settings" class="settings" hidden>
      <header class="settings-bar">
        <button type="button" id="settings-back">返回</button>
        <h1>设置</h1>
      </header>
      <div class="settings-body">
        <section class="settings-section">
          <h2>图片与视频窗口</h2>
          <label class="settings-choice">
            <input type="radio" name="media-window-mode" value="fit" />
            适应图片/视频大小
          </label>
          <label class="settings-choice">
            <input type="radio" name="media-window-mode" value="fixed" />
            固定窗口大小
          </label>
        </section>
        <section class="settings-section">
          <h2>关联文件格式</h2>
          <div id="settings-list" class="settings-list"></div>
        </section>
      </div>
      <footer class="settings-footer">
        <p id="app-version" class="app-version" hidden></p>
        <button type="button" id="settings-apply" disabled>Apply</button>
      </footer>
    </div>
    <div id="assoc-overlay" class="overlay" hidden>
      <div class="dialog">
        <p id="assoc-text"></p>
        <div class="dialog-actions">
          <button type="button" id="assoc-no">不关联</button>
          <button type="button" id="assoc-yes">关联</button>
        </div>
      </div>
    </div>
