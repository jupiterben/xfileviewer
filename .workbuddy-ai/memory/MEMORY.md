# 项目长期约定

- 用户要求优化启动速度，按文件类型动态加载 JS 依赖，并保持可扩展框架。
- 内置插件注册应仅含元数据；查看器用 src/plugins/lazyViewer.ts 包装，重型解析器/可选功能用 src/core/lazyModule.ts 封装 import()，禁止把实现静态引入启动壳。
- 模型按格式拆分，GLTF 压缩解码器按扩展声明加载；Markdown 渲染是异步API，KaTeX/highlight/Mermaid 按内容加载，异步后必须保留销毁/取消检查。
- 新格式/功能要补测试；vite.config.ts 的最终产物依赖守卫防止重型库进入壳、格式解析器进入3D公共入口、增强库进入Markdown公共入口，壳静态 JS 预算180 kB。
