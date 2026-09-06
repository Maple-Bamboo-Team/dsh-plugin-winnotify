# WinNotify

DeepSeek Harness 的 Windows 原生 Toast 通知插件。安装一次即可；页面模块由 dsh 自动加载，不需要安装 Chrome 或 Edge 扩展。

## 通知样式

左上角来源名称为 **DeepSeek Harness**，使用 dsh 应用自带的黑色透明图标。正文没有大图标或横幅。

启动通知的标题为“晚上好，Windows 用户名”等时段问候，正文仅显示一句一言，**不显示作者或出处**。请求失败时，正文固定为：

> 不诱于誉，不恐于诽。

问候按本机时间选择：00:00–04:59 夜深了，05:00–10:59 早上好，11:00–12:59 中午好，13:00–17:59 下午好，18:00–23:59 晚上好。每个 dsh 进程仅发送一次启动问候；页面刷新和插件热重载不会重复弹出。请求一言默认最多等待 15 秒，期间不阻塞 dsh。

## 安装

支持 Windows 10/11、本机运行的 dsh `web` profile 和 Node.js 22.19+。已针对 dsh `0.1.2-rc.1` 完成实际页面验证，并对照提供的 `0.1.3-alpha.1` 源码接口。

## 一行安装

PowerShell 中执行：

```powershell
dsh plugin --profile web add github:Maple-Bamboo-Team/dsh-plugin-winnotify
```

仓库已包含构建后的 `lib/`，从 GitHub 安装时不需要执行本地构建授权。安装完成后重启对应的 `dsh web`，再刷新页面使页面模块生效。

## 本地开发

在本目录构建、检查并打包：

```powershell
npm install
npm run check
npm test
npm pack
```

本地 tarball 可加入需要通知的 profile：

```powershell
dsh plugin --profile web add .\dsh-plugin-winnotify-0.1.0.tgz
```

随后重启 `dsh web` 并刷新页面，使页面模块生效。安装不修改 dsh 源码。

## 触发规则

| 事件 | 行为 |
| --- | --- |
| 启动 | 始终问候一次，不要求页面失焦 |
| 审批 | 请求仍在等待决定，且对应对话未聚焦时提醒一次 |
| 提问 | 模型等待用户回答，且对应对话未聚焦时提醒一次 |
| 异常 | 使用 agent 错误及回合错误结果，同一次回合只通知一次 |
| 完成 | 一个有实际执行步骤的回复回合正常结束时提醒 |
| 中断 | 用户/上级/Hook 取消、请求阻止或输出长度达到限制时提醒 |

只有“页面可见、浏览器窗口有焦点、选中的会话与通知对应”同时成立，才认为用户正在查看该对话。多个标签页共同参与判断。未处理的审批和模型提问在用户离开对话后会分别提醒一次；已结束的交互不再发送。除启动问候外，通知正文标题只显示对话名，正文单行显示事件和具体内容；具体内容有冒号时将首个冒号改为破折号。子代理正常完成不单独提醒，子代理审批、提问和异常归属主对话。

点击事件通知，在默认浏览器打开相应会话；点击启动问候打开 dsh 首页。系统关闭通知或开启专注助手时，展示方式遵循 Windows 设置。正常退出、插件卸载及恢复历史记录不作为中断通知。

页面通过 dsh 的认证 Connection 通道上报焦点；焦点变化立即上报，默认每 2 秒续期。浏览器异常关闭或网络中断后，旧的焦点状态最多保留 8 秒。通知发送前会再次检查焦点。

## 配置

在对应 profile 的 `cordis.patch.yml` 添加覆盖：

```yaml
- id: winnotify
  config:
    sound: true
    quoteTimeoutMs: 15000
```

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `welcome` | `true` | 启动问候 |
| `approval` | `true` | 等待审批 |
| `question` | `true` | 等待模型提问的回答 |
| `error` | `true` | 异常提醒 |
| `completed` | `true` | 完成提醒 |
| `interrupted` | `true` | 中断提醒 |
| `sound` | `true` | 使用系统通知声音 |
| `quoteUrl` | `https://v1.hitokoto.cn/?encode=json&max_length=48` | 一言 JSON 接口，必须为 HTTPS |
| `quoteTimeoutMs` | `15000` | 一言请求超时，毫秒 |
| `heartbeatMs` | `2000` | 页面焦点续期间隔，毫秒 |
| `presenceTtlMs` | `8000` | 焦点过期时间，至少为续期间隔的 3 倍 |
| `notificationDelayMs` | `300` | 发送前等待焦点和审批状态稳定的时间，毫秒 |
| `nativeTimeoutMs` | `8000` | 原生辅助进程超时，毫秒 |
| `maxBodyChars` | `160` | 事件正文的字符上限 |

一言请求只获取公开句子，不发送用户名、会话内容或工作目录。网络错误、HTTP 错误、无有效句子或超时均使用固定语句。辅助进程隐藏运行，通过 UTF-8 JSON 接收数据，并用 XML API 构造通知。

## 测试

```powershell
npm run preview
npm run preview -- --fallback
```

首条命令测试真实一言，第二条测试固定语句。两者都会实际弹出系统通知。

自动化测试包含真实 Cordis Loader 配置和 Session 事件、焦点时序、审批去重、异常/中断、卸载以及一言失败与取消。`scripts/browser-smoke.mjs <隔离的 dsh 地址>` 使用本机 Edge 验证页面自动加载、会话选择和跳转。无头浏览器不提供真实桌面窗口焦点，因此窗口失焦在该测试中使用 DOM 状态模拟。

## 卸载

先移除 profile 中的插件并重启 dsh：

```powershell
dsh plugin --profile web remove dsh-plugin-winnotify
```

要清除 Windows 中的通知来源和图标，在本地插件目录执行：

```powershell
npm run unregister
```

通知身份为 `WinNotify.DeepSeekHarness`，仅注册到当前用户的 `HKCU\Software\Classes\AppUserModelId`；图标位于 `%LOCALAPPDATA%\WinNotify\assets`。普通热卸载保留身份，让已有通知继续显示正确名称和图标；清理命令只删除该身份与插件自己的图标文件。

## 图标来源

图标来自 DeepSeek Harness 的 `apps/web/public/favicon.svg`，保留其黑色轮廓与透明通道；PNG 和多尺寸 ICO 已随包提供。图标遵循原仓库 MIT 许可证，版权归 DeepSeek。

插件不增加模型上下文、工具或会话日志格式，也不消耗模型 token。当前面向本机 Windows Web profile；远程 Windows 主机上的通知会出现在远程主机桌面。
