# CLAUDE.md

本仓库存放在手机上运行的 **AutoJs6** 自动化脚本（JavaScript，Rhino 引擎）。脚本不在电脑上运行，电脑上只能用 `node --check` 做语法检查；实际效果要由用户在手机上运行，再把日志发回来。

**修改脚本前，先读 [docs/pitfalls.md](docs/pitfalls.md)**，里面记录了已经踩过的坑及其依据。

## 运行环境

- 设备：OnePlus 13T（ColorOS），**无 root，有 Shizuku**
- AutoJs6 已授予以下权限：无障碍、Shizuku、通知、后台弹出界面

## 编写约定

- **可以使用 AutoJs6 提供的各种能力**，包括它在 Auto.js 基础上新增的 API 和插件，不必局限于经典 Auto.js API。拿不准某个 API 的用法时，查 AutoJs6 文档或源码确认（方法见 pitfalls.md 末尾的"查证方法"）。
- **AutoJs6 支持 Shizuku**：确认 Shizuku 可用时，可以用它执行 shell 命令（`shizuku(cmd)`）来扩展脚本能力，例如清理最近任务、强制停止 App。Shizuku 不可用时，应有兜底方案或给出明确提示。
- **用包名启动 App**（`app.launch(pkg)`）。App 名称会随系统语言变化，按名称启动可能找不到。
- **选择器加上 `.packageName(pkg)`**；启动 App 后，先等它进入前台再查找控件。否则可能找到 AutoJs6 自己界面上的控件。
- **点击前检查控件是否在屏幕范围内**：被收起或滚出屏幕的控件仍在控件树里，`find()` 照样能找到，但坐标在屏幕外。
- **Toast**：
  - 从 Android 12 起，系统会限制**后台 App** 的 toast 频率，超出的直接丢弃：20 秒内 3 条、42 秒内 5 条、68 秒内 6 条。脚本运行时 AutoJs6 通常在后台，所以要控制 toast 数量。
  - 弹新 toast 前先 `toast.dismissAll(); sleep(150);`，避免队列堆积。
  - 重要结果同时用 `notice()` 发通知，通知不受这个频率限制。
  - 详见 pitfalls.md 第一部分。

## 测试

- 修改后先运行 `node --check <工作流>/<脚本名>.js` 检查语法。
- 让用户连续多次运行同一个脚本测试时要提醒：上面提到的 toast 频率限制会把**相邻几次运行**的 toast 合在一起计数。如果每次运行要弹 3 条 toast，两次运行之间要间隔 68 秒以上（"68 秒内最多 6 条"那个时间窗口），否则后一次的 toast 可能被系统丢掉。

## 目录结构

按工作流分目录，一个工作流目录下可以有多个脚本；通用文档放在 `docs/`：

```
<工作流>/<脚本名>.js   # 脚本，复制到手机上的 AutoJs6 中运行
docs/pitfalls.md       # 踩坑记录（所有工作流通用）
README.md              # 仓库说明与工作流列表
```

新增工作流或脚本时，同步更新 README.md 的工作流列表。

## 工作流列表

- `auto_steps/`
  - `auto_steps.js`：先在步数能手里提交随机步数，再打开微信小程序"鹅厂运动"打卡，最后清理最近任务，并通过通知和 toast 播报结果。
