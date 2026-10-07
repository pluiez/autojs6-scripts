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

### 10. 定时任务触发时不直接执行，改为响铃并等用户点击通知

- **背景**：无障碍操作需要屏幕亮着且已解锁。手机设置了锁屏密码时，脚本无法安全地自动解锁：自动输入 PIN 码需要把密码明文写进脚本，而仓库是公开的。即使到点时手机正好解锁着，用户可能正在用手机，直接接管屏幕也不合适。
- **做法：把提醒和执行拆成两个脚本**
  - 定时任务指向 `remind.js`，它只发一条会响铃的通知，点击通知后运行 `auto_steps.js`；
  - `auto_steps.js` 被启动就直接执行，不区分启动方式。
- **为什么不在同一个脚本里区分启动方式**：
  - 技术上可行。AutoJs6 所有的定时任务（AlarmManager、WorkManager、JobScheduler 三种方式）都通过 `TimedTask.createIntent()` 生成启动 intent，里面一定带有 `task_id` 参数，脚本中用 `engines.myEngine().execArgv.intent` 就能取到。
  - 但 `task_id` 是 AutoJs6 内部的实现细节，文档里没有写，以后的版本改了，判断就会失效，定时触发时会直接执行打卡。拆成两个脚本，就不依赖这个细节了。
- **点击通知运行脚本的实现**：
  - `notice()` 的 `intent` 选项可以直接传 Android `Intent` 对象。AutoJs6 把它包装成 `PendingIntent.getActivity`，所以在锁屏界面点击通知，系统会先要求解锁。
  - Intent 的目标设为 AutoJs6 对外开放的 `org.autojs.autojs.external.open.RunIntentActivity`，extra `path` 填脚本的绝对路径，AutoJs6 收到后就会运行这个脚本。
- **脚本之间互相调用**：`engines.execScriptFile(path, { arguments: {...} })` 可以启动另一个脚本，被启动的脚本通过 `engines.myEngine().execArgv` 读取参数，工作目录默认沿用调用方的。
- **响铃**：通知所在渠道的重要性要设为 `IMPORTANCE_HIGH`，通知才会发出提示音并弹出横幅。Android 规定渠道创建后，App 不能再提高它的重要性，以系统设置里的渠道配置为准，改代码不会生效。
- **不能用 `notice.channel.create()`**：AutoJs6 文档里有这个接口，但在 v6.7.0 中调用会报 `TypeError: Cannot find function create`。原因是 `Channel` 类实现了 `create()`，却没有像 `Notice` 那样声明 `selfAssignmentFunctions`，函数没有暴露给脚本。改为直接调用 Android 的 `NotificationManager.createNotificationChannel()` 创建渠道；之后 `notice()` 发到这个渠道时，AutoJs6 只在渠道不存在时才创建（`Channel.createIfNeeded`），不会覆盖。
- **注意**：从编辑器运行脚本时，实际执行的是缓存目录里的临时副本（日志中显示为 `[cache]`），所以脚本路径要用 `files.path("./<文件名>")` 基于工作目录生成，不能取当前正在执行的文件路径。
- **依据**：AutoJs6 v6.7.0 源码 `augment/notice/Channel.kt`、`timing/TimedTask.java`（`createIntent`）、`external/ScriptIntents.kt`、`augment/engines/Engines.kt`（`execArgv`、`execScriptFile`）、`augment/notice/Notice.kt`、`util/NotificationUtils.kt`、`external/open/RunIntentActivity.java`；AutoJs6 文档 NoticeChannelOptions。

### 11. 定时任务的触发方式和需要的权限

- AutoJs6 的定时任务默认用 AlarmManager 精确闹钟（`setExactAndAllowWhileIdle`）。要授予"闹钟和提醒"权限，才能在熄屏或待机时准时触发。设置里也可以改成 WorkManager 或 JobScheduler，但这两种都可能被系统推迟。
- 脚本里也可以用 `tasks.addDailyTask({ path, time: "22:00" })` 注册定时任务。官方文档的"任务"一章还没写，接口要看源码 `augment/tasks/Tasks.kt`。
- **依据**：AutoJs6 源码 `timing/AlarmTimedTaskScheduler.kt`、`res/values/strings.xml`（`default_key_timed_task_backend`）。

---

## 三、最近任务清理（Shizuku）

AutoJs6 支持 Shizuku。确认 Shizuku 可用后，可以用 `shizuku(cmd)` 执行 shell 命令，做到普通 App 做不到的事。下面几条都基于这个能力。

### 12. `am force-stop` 不会把卡片从最近任务里移除

- 它只结束进程。手动上滑卡片之所以能同时做到"移除卡片 + 结束进程"，是因为调用了系统的 `removeTask`。
- **解决**：用 Shizuku 执行 `dumpsys activity recents` 找到任务 ID，再执行 `am stack remove <taskId>`。这条命令调用的就是 `ActivityTaskManager.removeTask`，效果等同手动上滑。
- **依据**：AOSP `android15-release` 和 `main` 分支的 `ActivityManagerShellCommand.java`（`runRootTaskRemove`）。

### 13. `dumpsys` 输出是给人看的纯文本，格式不稳定

- 每张卡片的标题行格式是 `* Recent #0: Task{<hash> #<taskId> type=standard A=<uid>:<affinity>}`（或 `I=<component>`）。
- Android 15 中，任务对应的界面组件字段是 **`mActivityComponent=`**，**不是** `realActivity=`。我一开始按旧印象写成 `realActivity=`，核对源码后才改正。
- 输出里**没有卡片标题**（比如小程序名称），只能通过组件名和卡片顺序来判断是哪张卡片。
- `Recent #0` 是最近使用的任务，前台 App 也在列表里。
- 解析时同时匹配好几种标记；如果系统升级后日志出现"改用手势清理"，多半是输出格式变了。
- **依据**：AOSP `RecentTasks.dump()`、`Task.toString()`、`Task.dump()`。

### 14. 微信小程序和微信共用包名

- 小程序运行在 `com.tencent.mm` 包内，有单独的卡片，组件名是 `com.tencent.mm/.plugin.appbrand.ui.AppBrandUI`（多开时带编号，如 `AppBrandUI1`）。
- 按包名清理会把微信主界面一起移除，还会把微信结束掉。
- **解决**：只移除**最近使用的那一个** `AppBrandUI*` 任务（`closeMiniProgram()`），**不对微信执行 force-stop**。

### 15. Shizuku 的返回值在 AutoJs6 和 AutoX v7 中不同

- AutoJs6：`shizuku(cmd)` 返回 `{ code, result, error }`。
- AutoX v7：返回底层 `runShizukuShellCommand` 的结果，具体结构未验证。
- 已封装在 `shellRun()` 里，迁移时只改这一处。

### 16. 兜底手势依赖 OnePlus 的最近任务界面布局

- 当前 App 在前台时打开最近任务：当前 App 的卡片露在屏幕右侧，大约从 72% 宽度开始；从桌面打开时，最新的卡片居中。
- 所以兜底手势在 **4/5 屏幕宽度**处上滑，两种布局下都能滑到目标卡片。换机或换桌面程序后需要重新确认。

---

## 四、业务相关

### 17. 步数能手提交后，以弹窗 JSON 判断是否成功

- 弹窗内容形如 `{"code":"1","time":"...","user":"...","step":13502,"status":"success","message":"修改步数（13502）"}`。
- 要求 `status === "success"`，并且 `step` 等于本次填写的步数，才算成功。JSON 解析失败时，退回到检查文字里有没有 `success`。

### 18. 写死的像素值只适用于当前设备

- `MP_MIN_CENTER_Y = 300`、`REWARD_OFFSET_Y = 208` 都是在 OnePlus 13T 上测出来的，换机后需要重新测。
- 能按文字找到的按钮，优先按文字找（`REWARD_BTN_TEXT`）。

---

## 五、平台选择

- **AutoX.js**：原仓库 kkevsekk1/AutoX 已于 2025-01-07 停止维护。社区版 v6 最后发布于 2025-03。aiselp/AutoX（v7）仍在活跃更新。
- **AutoJs6**：单人维护，习惯本地开发很久再集中发大版本（v6.7.0 发布于 2026-03-14，作者 2026-09 在 issue 中提到 v6.8.0 正在开发）。主仓库长时间没有提交，**不代表停止维护**。
- **选择 AutoJs6 的目的就是用上它的新能力**（扩展 API、Shizuku、插件等），不必为了将来可能的迁移而只用经典 Auto.js API。
- 如果将来要迁移到 AutoX v7：它的 Rhino 引擎沿用 AutoX v6 的 API，经典 API 部分基本兼容；用到的 AutoJs6 独有能力需要逐个替换，`shizuku()` 的返回值结构也不同（见第 15 条）。

## 查证方法

遇到和 AutoJs6 或 Android 系统行为相关的疑问时，直接读源码，不要凭记忆下结论：

- **AutoJs6 的文档不等于实际可用的接口**。文档版本（6.6.4）落后于发行版，而且写在文档里的接口不一定真的暴露给了脚本（例如 `notice.channel.create`，见第 10 条）。使用文档里的接口前，到**用户所装版本的发行版 tag** 源码中确认：对应的 `augment/**/<模块>.kt` 有没有把这个函数列进 `selfAssignmentFunctions`（或 `selfAssignmentGetters` 等）。

- AutoJs6 源码：`gh api repos/SuperMonster003/AutoJs6/contents/<path>`。文档的 HTML 源文件在 `app/src/main/assets-app/docs/`。
- AOSP 源码：`gh api -H "Accept: application/vnd.github.raw" "repos/aosp-mirror/platform_frameworks_base/contents/<path>?ref=android15-release"`。
