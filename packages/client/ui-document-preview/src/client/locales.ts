/** `documentPreview` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title.empty': '文档预览',
  'reload': '重新加载',
  'openExternal': '在外部打开',
  'close': '关闭',
  'copy': '复制',
  'copied': '复制成功',
  'markdown.footnotes': '脚注',
  'loading': '正在加载文档…',
  'empty': '打开 Markdown 或 HTML 文件以预览',
  'mermaidError': '图表渲染失败',
  'error.generic': '无法预览该文档',
  'interactive.enable': '启用交互预览',
  'interactive.confirm.title': '在隔离来源中运行此文档',
  'interactive.confirm.description': '交互预览会在独立来源中执行该 HTML 应用的脚本，并可访问同一目录中的本地资源。外部网络请求会被拦截。浏览器无法阻止脚本把当前预览页导航到外部地址。授权仅对当前打开的文档有效，关闭标签页或打开其他文件后需要重新确认。',
  'interactive.confirm.acknowledge': '我信任此文档，允许在隔离预览中运行脚本',
  'interactive.confirm.cancel': '取消',
  'interactive.confirm.enable': '启用交互预览',
}

/** English dictionary (same keys as {@link zh}). */
export const en: typeof zh = {
  'title.empty': 'Document preview',
  'reload': 'Reload',
  'openExternal': 'Open externally',
  'close': 'Close',
  'copy': 'Copy',
  'copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
  'loading': 'Loading document…',
  'empty': 'Open a Markdown or HTML file to preview it',
  'mermaidError': 'Diagram failed to render',
  'error.generic': 'Unable to preview this document',
  'interactive.enable': 'Enable interactive preview',
  'interactive.confirm.title': 'Run this document in an isolated origin',
  'interactive.confirm.description': 'Interactive preview executes this HTML app in a unique origin and can load local files from the same directory. External network requests are blocked. Browsers cannot stop the app from navigating its own frame to an external URL. Authorization lasts only while this document stays open; closing the tab or opening another file requires confirmation again.',
  'interactive.confirm.acknowledge': 'I trust this document and allow scripts in the isolated preview',
  'interactive.confirm.cancel': 'Cancel',
  'interactive.confirm.enable': 'Enable interactive preview',
}

/** Dictionary key union for the `documentPreview` namespace. */
export type DocumentPreviewKey = keyof typeof zh
