# WinNotify

DeepSeek Harness 的 Windows 原生 Toast 通知插件。

## 一行安装

需要 Windows 10/11、Node.js 22.19+ 和已安装的 dsh。在 PowerShell 中执行：

```powershell
dsh plugin --profile web add https://codeload.github.com/Maple-Bamboo-Team/dsh-plugin-winnotify/tar.gz/refs/heads/main --ignore-scripts
```

安装后重启 `dsh web` 并刷新页面。

## 通知

未查看对应对话时，提醒审批、提问、异常、任务完成和中断；点击通知打开对应会话。

通知标题为对话名，正文示例：

| 事件 | 正文 |
| --- | --- |
| 审批 / 权限提升 | 等待处理：写入文件——需要工作区外的写入权限 |
| 提问 | 等待回答：状态探测——是否继续？ |
| 异常 | 未经处理的异常：具体内容 |
| 完成 | 任务已完成 |
| 中断 | 任务中断：执行已取消 |

启动时发送时段问候和一言，获取失败则显示「不诱于誉，不恐于诽。」

## 配置

在 profile 的 `cordis.patch.yml` 中配置，例如关闭启动问候和声音：

```yaml
- id: winnotify
  config:
    welcome: false
    sound: false
```

`welcome`、`approval`、`question`、`error`、`completed`、`interrupted` 和 `sound` 默认开启。更多选项见 [src/config.ts](src/config.ts)。

## 卸载

```powershell
dsh plugin --profile web remove dsh-plugin-winnotify
```

重启 dsh 后生效。需要清除系统通知来源和图标时，可在本地插件目录运行 `npm run unregister`。

## 开发

```powershell
npm ci
npm run check
npm test
npm pack
```

`npm test` 会先构建；提交源码时一并提交更新后的 `lib/`。`npm run preview` 可预览系统通知。

## 许可

采用 [MIT 许可证](LICENSE)。图标来自 DeepSeek Harness 的 `apps/web/public/favicon.svg`，版权归 DeepSeek。
