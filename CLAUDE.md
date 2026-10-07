# CLAUDE.md

本仓库存放在手机上运行的 **AutoJs6** 自动化脚本（JavaScript，Rhino 引擎）。脚本不在电脑上运行；电脑上只能用 `node --check` 做语法检查，实际效果需要用户在手机上运行，再把日志发回来。

**修改脚本前，先读 [docs/pitfalls.md](docs/pitfalls.md)**，里面记录了已经踩过的坑。

## 运行环境

- 设备：OnePlus 13T（ColorOS），**无 root，有 Shizuku**
- 系统语言会在**中文和英文之间切换**，脚本必须兼容两种语言
- AutoJs6 已授予：无障碍、Shizuku、通知、后台弹出界面

## 编写约定

- **只用经典 Auto.js API**，不用 AutoJs6 独有的扩展，以便将来能迁移到 AutoX v7。平台相关代码集中放在脚本开头的"平台相关代码"区。
- **用包名启动 App**（`app.launch(pkg)`），不要用 App 名称。
- **按文字查找控件时，用数组列出中英文写法**，集中放在配置区（`TEXT_*`）。
- **选择器都加 `.packageName(pkg)`**；启动 App 后，先等它进入前台再查找控件。
- **点击前检查控件是否在屏幕范围内**，被收起或滚出屏幕的控件也能被 `find()` 找到。
- **Toast**：每次运行最多 3 条；弹之前先 `toast.dismissAll(); sleep(150);`；重要结果同时用 `notice()` 发通知。
- **关闭 App** 用 Shizuku：`dumpsys activity recents` 找任务 ID，再 `am stack remove`。微信小程序只移除它自己的卡片，不要结束微信。
- 用 ES5 风格书写（`var`、`function`），注释用中文。

## 测试

- 修改后先运行 `node --check <脚本名>/<脚本名>.js` 检查语法。
- 让用户在手机上运行时，提醒两次运行**间隔 68 秒以上**，否则会触发系统的 toast 频率限制。

## 目录结构

每个脚本一个子目录，通用文档放在 `docs/`：

```
<脚本名>/<脚本名>.js   # 脚本本体，复制到手机上的 AutoJs6 中运行
docs/pitfalls.md       # 踩坑记录（所有脚本通用）
```

新增脚本时，在下面的列表里补一行说明。

## 脚本列表

- `auto_steps/auto_steps.js`：先在步数能手里提交随机步数，再打开微信小程序"鹅厂运动"打卡，最后清理最近任务，并通过通知和 toast 播报结果。
