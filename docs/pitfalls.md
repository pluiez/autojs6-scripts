# AutoJs6 自动化踩坑记录

开发 `auto_steps.js` 过程中实际遇到并验证过的问题。每条按「现象 → 原因 → 解决」记录，并注明依据，方便判断结论是否仍然成立。

测试设备：OnePlus 13T（ColorOS），无 root，有 Shizuku。

---

## 一、Toast

### 1. Toast 堆积，脚本结束很久后才陆续弹出

- **现象**：最后的汇总 toast 没出现；之后打开别的 App，冒出一串之前没显示完的 toast。
- **原因**：AutoJs6 的 toast 放在一个**全局队列**里串行显示（`ScriptToast.kt`），短 toast 每条占 2 秒；Android 11+ 系统没回调"已隐藏"时，要等兜底超时才放下一条，最长约 3 秒。脚本发 toast 的速度远快于显示速度，而且**脚本结束时不会清空队列**，没显示完的会继续往后排。
- **解决**：过程信息只写 `log()`，每个阶段最多弹一条 toast，弹之前先清空队列（见下一条）。

### 2. `toast.dismissAll()` 之后马上 `toast()`，新 toast 也被清掉

- **原因**：在脚本线程里调用时，`dismissAll` 用 `mainHandler.post()` 排到主线程队列末尾，而 `enqueueToast` 用 `postAtFrontOfQueue()` 插到最前面。结果新 toast 先入队，随后被 `dismissAll` 一起清掉。`toast(msg, "forcible")` 内部也是先 `dismissAll` 再入队，有同样的问题。
- **解决**：`toast.dismissAll(); sleep(150); toast(msg);`（见 `showToast()`）。
- **依据**：AutoJs6 v6.7.0 源码 `runtime/api/ScriptToast.kt`、`augment/toast/ToastParser.kt`。

### 3. Android 12+ 后台 toast 频率限制（最隐蔽）

- **现象**：toast 已经限制为每阶段一条，最后的汇总 toast 仍然不显示。
- **原因**：从 **Android 12（API 31）** 开始，系统 `NotificationManagerService` 对**不在前台的 App** 限制 toast 频率，超出的直接丢弃。限额是多个滑动时间窗口，按 App 计数，必须同时满足：
  - 20 秒内最多 3 条
  - 42 秒内最多 5 条
  - 68 秒内最多 6 条

  前台 App 不受这个限制。脚本运行时，前台通常是被操作的 App，AutoJs6 处在后台，所以受限。当时的日志里，前 3 条阶段 toast 在约 10 秒内弹出，第 4 条汇总 toast 超出了"20 秒 3 条"的限额。
- **解决**：
  - 根据脚本的运行时长估算 toast 数量，不要超出上面的限额。`auto_steps.js` 全程约 15 秒，所以只弹 3 条：步数结果、打卡结果、最终报告。
  - 重要结果同时用**系统通知** `notice()` 发一份，通知不受这个限制。
- **测试注意**：限额按滑动时间窗口计算，**相邻几次运行的 toast 会合并计数**。比如每次运行弹 3 条，两次运行间隔不到 68 秒，就会超出"68 秒 6 条"的限额（之前的条数加上本次的条数），后一次的 toast 可能被丢掉。
- **依据**：AOSP 源码 `NotificationManagerService.java` 中的 `TOAST_RATE_LIMITS`（`android11-release` 中没有，`android12-release` 起才有），以及 `tryShowToast()` 里的 `isPackageInForeground` 判断。

### 4. ColorOS / MIUI / OriginOS 需要"后台弹出界面"权限

- 不开这个权限，后台 App 的 toast 可能被系统扣下，之后再集中放出。已在系统设置中给 AutoJs6 开启。
- **依据**：AutoJs6 文档 Toast 章节。

---

## 二、启动 App 与查找控件

### 5. 启动 App 后立刻查找控件，找到的是 AutoJs6 自己界面上的控件

- **现象**：从"正在打开步数能手"到"未找到输入框"只隔了 77 毫秒。
- **原因**：`app.launch()` / `app.launchApp()` 发出启动请求就返回，不会等 App 打开。这时 `className("EditText").findOne()` 在当前窗口（AutoJs6 自己的界面）里找到了一个输入框，立即返回了。
- **解决**：
  1. 先轮询 `currentPackage()`，等目标 App 进入前台（`waitForApp()`）；
  2. 所有选择器都加 `.packageName(pkg)`，只在目标 App 里找。

### 6. 控件在控件树里，但实际不在屏幕上

- **现象**：`Failed to call method "automator.click" ... negative coordinate values (562, -873)`，脚本报错。
- **原因**：收起的面板、滚出屏幕的列表项仍然在无障碍控件树里，`find()` / `findOne()` 照样能找到，但它们的 `bounds()` 在屏幕外。AutoJs6 的 `click(x, y)` 遇到负坐标会直接抛异常。
- **解决**：点击前用 `isOnScreen()` 检查控件中心是否在屏幕范围内（见 `findVisibleByText()`）。

### 7. `find()` 的返回值在 AutoJs6 中是真正的 JS 数组

- 在 AutoJs6 中，`UiObjectCollection` 交给脚本时会被包装成 JS 数组，所以 `concat`、`map`、`filter` 等数组方法都能用，同时还保留 `click()`、`each()` 等控件集合方法。
- `auto_steps.js` 里合并查找结果时用的是嵌套循环。这是当时没核实、出于谨慎的写法，不是必须的。
- 其他 Auto.js 系平台未必这样包装，迁移时需要重新确认。
- **依据**：AutoJs6 源码 `rhino/AndroidContextFactory.kt`（`wrap()`）、`runtime/ScriptBridges.kt`（`asArray()`）。

### 8. App 名称会随系统语言变化

- 微信在中文系统下叫"微信"，英文系统下叫"WeChat"，界面里显示为"Weixin"。用 `app.launchApp("WeChat")` 在中文系统下会找不到微信。
- **解决**：用包名启动，`app.launch("com.tencent.mm")`。

### 9. 不再强制停止微信后，微信打开时停在上次离开的界面

- 以前每次运行结束都会强制停止微信，下次打开总是停在聊天列表，下拉一定能拉出小程序面板。改为保留微信后，打开时可能停在子页面、面板半开等状态。
- **解决**：`openMpDrawer()` 先判断当前状态再操作，最多尝试 3 次：
  - 能看到"搜索小程序"：面板已展开；
  - 能看到底部的"通讯录"标签：在首页，执行下拉；
  - 都看不到：在子页面，按一次返回键。按返回键退出了微信就重新打开。

---

## 三、最近任务清理（Shizuku）

AutoJs6 支持 Shizuku。确认 Shizuku 可用后，可以用 `shizuku(cmd)` 执行 shell 命令，做到普通 App 做不到的事。下面几条都基于这个能力。

### 10. `am force-stop` 不会把卡片从最近任务里移除

- 它只结束进程。手动上滑卡片之所以能同时做到"移除卡片 + 结束进程"，是因为调用了系统的 `removeTask`。
- **解决**：用 Shizuku 执行 `dumpsys activity recents` 找到任务 ID，再执行 `am stack remove <taskId>`。这条命令调用的就是 `ActivityTaskManager.removeTask`，效果等同手动上滑。
- **依据**：AOSP `android15-release` 和 `main` 分支的 `ActivityManagerShellCommand.java`（`runRootTaskRemove`）。

### 11. `dumpsys` 输出是给人看的纯文本，格式不稳定

- 每张卡片的标题行格式是 `* Recent #0: Task{<hash> #<taskId> type=standard A=<uid>:<affinity>}`（或 `I=<component>`）。
- Android 15 中，任务对应的界面组件字段是 **`mActivityComponent=`**，**不是** `realActivity=`。我一开始按旧印象写成 `realActivity=`，核对源码后才改正。
- 输出里**没有卡片标题**（比如小程序名称），只能通过组件名和卡片顺序来判断是哪张卡片。
- `Recent #0` 是最近使用的任务，前台 App 也在列表里。
- 解析时同时匹配好几种标记；如果系统升级后日志出现"改用手势清理"，多半是输出格式变了。
- **依据**：AOSP `RecentTasks.dump()`、`Task.toString()`、`Task.dump()`。

### 12. 微信小程序和微信共用包名

- 小程序运行在 `com.tencent.mm` 包内，有单独的卡片，组件名是 `com.tencent.mm/.plugin.appbrand.ui.AppBrandUI`（多开时带编号，如 `AppBrandUI1`）。
- 按包名清理会把微信主界面一起移除，还会把微信结束掉。
- **解决**：只移除**最近使用的那一个** `AppBrandUI*` 任务（`closeMiniProgram()`），**不对微信执行 force-stop**。

### 13. Shizuku 的返回值在 AutoJs6 和 AutoX v7 中不同

- AutoJs6：`shizuku(cmd)` 返回 `{ code, result, error }`。
- AutoX v7：返回底层 `runShizukuShellCommand` 的结果，具体结构未验证。
- 已封装在 `shellRun()` 里，迁移时只改这一处。

### 14. 兜底手势依赖 OnePlus 的最近任务界面布局

- 当前 App 在前台时打开最近任务：当前 App 的卡片露在屏幕右侧，大约从 72% 宽度开始；从桌面打开时，最新的卡片居中。
- 所以兜底手势在 **4/5 屏幕宽度**处上滑，两种布局下都能滑到目标卡片。换机或换桌面程序后需要重新确认。

---

## 四、业务相关

### 15. 步数能手提交后，以弹窗 JSON 判断是否成功

- 弹窗内容形如 `{"code":"1","time":"...","user":"...","step":13502,"status":"success","message":"修改步数（13502）"}`。
- 要求 `status === "success"`，并且 `step` 等于本次填写的步数，才算成功。JSON 解析失败时，退回到检查文字里有没有 `success`。

### 16. 写死的像素值只适用于当前设备

- `MP_MIN_CENTER_Y = 300`、`REWARD_OFFSET_Y = 208` 都是在 OnePlus 13T 上测出来的，换机后需要重新测。
- 能按文字找到的按钮，优先按文字找（`REWARD_BTN_TEXT`）。

---

## 五、平台选择

- **AutoX.js**：原仓库 kkevsekk1/AutoX 已于 2025-01-07 停止维护。社区版 v6 最后发布于 2025-03。aiselp/AutoX（v7）仍在活跃更新。
- **AutoJs6**：单人维护，习惯本地开发很久再集中发大版本（v6.7.0 发布于 2026-03-14，作者 2026-09 在 issue 中提到 v6.8.0 正在开发）。主仓库长时间没有提交，**不代表停止维护**。
- **选择 AutoJs6 的目的就是用上它的新能力**（扩展 API、Shizuku、插件等），不必为了将来可能的迁移而只用经典 Auto.js API。
- 如果将来要迁移到 AutoX v7：它的 Rhino 引擎沿用 AutoX v6 的 API，经典 API 部分基本兼容；用到的 AutoJs6 独有能力需要逐个替换，`shizuku()` 的返回值结构也不同（见第 13 条）。

## 查证方法

遇到和 AutoJs6 或 Android 系统行为相关的疑问时，直接读源码，不要凭记忆下结论：

- AutoJs6 源码：`gh api repos/SuperMonster003/AutoJs6/contents/<path>`。文档的 HTML 源文件在 `app/src/main/assets-app/docs/`。
- AOSP 源码：`gh api -H "Accept: application/vnd.github.raw" "repos/aosp-mirror/platform_frameworks_base/contents/<path>?ref=android15-release"`。
