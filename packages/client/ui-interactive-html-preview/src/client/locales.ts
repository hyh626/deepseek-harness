/** Localized copy for the consent-gated interactive HTML preview. */
export type InteractiveHtmlKey =
  | 'title'
  | 'enable'
  | 'confirm.title'
  | 'confirm.description'
  | 'confirm.acknowledge'
  | 'confirm.cancel'
  | 'confirm.enable'
  | 'starting'
  | 'failed'
  | 'retry'
  | 'frame'
  | 'off'

export const zh: Record<InteractiveHtmlKey, string> = {
  'title': '交互式 HTML',
  'enable': '启用交互预览',
  'confirm.title': '在隔离来源中运行此文档',
  'confirm.description': '交互预览会在独立来源中执行该 HTML 应用的脚本，并可访问同一目录中的本地资源。授权仅对当前打开的文档有效，关闭标签页后需要重新确认。',
  'confirm.acknowledge': '我信任此文档，允许在隔离预览中运行脚本',
  'confirm.cancel': '取消',
  'confirm.enable': '启用交互预览',
  'starting': '正在启动隔离来源…',
  'failed': '交互预览启动失败',
  'retry': '重试',
  'frame': '交互式 HTML 预览',
  'off': '此文件的交互预览尚未启用。通过工具栏启用后，该页面将在隔离来源中运行。',
}

export const en: Record<InteractiveHtmlKey, string> = {
  'title': 'Interactive HTML',
  'enable': 'Enable interactive preview',
  'confirm.title': 'Run this document in an isolated origin',
  'confirm.description': 'Interactive preview executes this HTML app in a unique origin and can load local files from the same directory. Authorization lasts only while this tab stays open; closing the tab requires confirmation again.',
  'confirm.acknowledge': 'I trust this document and allow scripts in the isolated preview',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable interactive preview',
  'starting': 'Starting isolated origin…',
  'failed': 'Interactive preview failed to start',
  'retry': 'Retry',
  'frame': 'Interactive HTML preview',
  'off': 'Interactive preview is off for this file. Enable it from the toolbar to run this page on an isolated origin.',
}
