# AutoJs6 自动化踩坑记录

开发 `auto_steps.js` 过程中实际遇到并验证过的问题。每条按「现象 → 原因 → 解决」记录，并注明依据，方便判断结论是否仍然成立。

条目编号在代码注释、其他文档和提交记录里都有引用，所以已有的编号不改：新条目接着最大的编号往后排，放进内容对应的部分，部分之间的编号因此不一定连续。

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
  - 根据脚本的运行时长估算 toast 数量，不要超出上面的限额。`auto_steps.js` 每次运行最多弹 2 条：刷步结果、最终结果（最终结果只有一行，见第 22 条）。
  - 重要结果同时用**系统通知** `notice()` 发一份，通知不受这个限制。
- **测试注意**：限额按滑动时间窗口计算，**相邻几次运行的 toast 会合并计数**。比如每次运行弹 3 条，两次运行间隔不到 68 秒，就会超出"68 秒 6 条"的限额（之前的条数加上本次的条数），后一次的 toast 可能被丢掉。
- **依据**：AOSP 源码 `NotificationManagerService.java` 中的 `TOAST_RATE_LIMITS`（`android11-release` 中没有，`android12-release` 起才有），以及 `tryShowToast()` 里的 `isPackageInForeground` 判断。

### 4. ColorOS / MIUI / OriginOS 需要"后台弹出界面"权限

- 不开这个权限，后台 App 的 toast 可能被系统扣下，之后再集中放出。已在系统设置中给 AutoJs6 开启。
- **依据**：AutoJs6 文档 Toast 章节。

### 22. 系统 toast 最多显示两行，超出的部分被截断

- **现象**：没有在真机上确认过。原来的最终报告 toast 是"标题 + 每一步一行"，至少三行。按 AOSP 的布局，只显示得出前两行，后面的领取结果会变成省略号。
- **原因**：AutoJs6 用 `Toast.makeText()` 弹文字 toast，targetSdk 是 36。targetSdk ≥ 30 的 App 弹的文字 toast 由 SystemUI 渲染，SystemUI 的 toast 布局里文字设了 `maxLines="2"`、`ellipsize="end"`。toast 左边还有 App 图标，文字 14sp，按 AOSP 的布局估算，中文每行二十来个字。
- **解决**：一条 toast 只放一条结果。中间步骤的结果各弹一条；最终 toast 只放最后一条结果（全部完成时是领取结果，中途失败时是失败的那一步）。完整报告放在通知里：收起时显示同一条结果，展开后显示每一步的结果。
- ColorOS 上是不是也限制两行，没有确认。
- **依据**：AOSP `android12-release`、`android15-release` 的 `packages/SystemUI/res/layout/text_toast.xml`，`android15-release` 的 `core/res/res/layout/transient_notification.xml` 也是两行；`core/java/android/widget/Toast.java`（`CHANGE_TEXT_TOASTS_IN_THE_SYSTEM`，`@EnabledAfter(targetSdkVersion = Q)`）；AutoJs6 v6.7.0 源码 `runtime/api/ScriptToast.kt`（`Toast.makeText`）、`version.properties`（`TARGET_SDK_VERSION=36`）。

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

### 17. 捕获其他 App 弹出的短暂 toast（AutoTasks 的"刷步成功"）

- toast 不在无障碍控件树里，`text()` / `find()` 找不到，只能通过无障碍事件捕获：`events.observeToast()` + `events.onToast(fn)`，回调参数有 `getText()` 和 `getPackageName()`。
- **回调线程**：AutoJs6 的 `api.Events` 构造时没有绑定 timer，收到 toast 后直接在 Android 主线程上调用回调（`mHandler.post(() -> emit("toast", ...))`），不用等脚本线程空闲。所以脚本线程可以 `sleep()` 轮询等结果，两个线程之间用 `java.util.concurrent.CopyOnWriteArrayList` 传递数据。
- **必须先监听再点击**：AutoTasks 的弹窗一关闭就立即弹出 toast，而且显示时间很短。
- **用完必须取消**：`observeToast()` 会设置 `waitWhenIdle(true)`，脚本执行完后会一直挂着不退出。结束时要调用 `events.removeAllListeners("toast")` 和 `events.removeToastObserver()`。
- **依据**：AutoJs6 v6.7.0 源码 `runtime/api/Events.java`、`core/eventloop/EventEmitter.java`、`core/accessibility/AccessibilityNotificationObserver.kt`；示例 `assets-app/sample/事件与监听/Toast监听.js`。

### 18. 页面上的一段文字在控件树里可能被拆成多个控件

- 例如鹅厂运动的"**8923** / 6666步"，大号的步数和后面的达标线字号不同，在控件树里可能是一个控件，也可能拆成好几个。小程序页面的文字有时在 `desc` 里，而不在 `text` 里。
- **做法**：不匹配固定字符串，而是先确定一个区域（比如"今日步数"和下方按钮之间），收集区域内可见**叶子**控件的 `text` / `desc`，按阅读顺序拼接，再用正则提取（步数：`(\d+)\s*\/\s*(\d+)\s*步`）。
  - 只取叶子控件：WebView 的父容器可能在 `desc` 里重复带上子控件的文字。
  - 按"垂直方向是否重叠"分行，而不是按坐标取整分组：字号不同的控件（大号数字和小数点）高度不同，按中心点分组会被分到不同的行，拼出来顺序就乱了。
- 用 `DEBUG_DUMP` 把关键界面的控件全部打印到日志，可以确认实际结构。
- **艺术字标题可能是图片**：领取弹窗的标题"今日已成功瓜分Q米"在控件树里不存在，只能用弹窗里的普通文字（"坐等收米"）判断弹窗是否出现。
- **滚动数字**：领取弹窗的金额是里程表式动画，按坐标读不准，改读 Q 米记录页，见第 21 条。

### 19. 写死的像素值只适用于当前设备

- `MP_MIN_CENTER_Y = 300` 是在 OnePlus 13T 上测出来的，换机后需要重新测。
- 能按文字找到的按钮，优先按文字找。鹅厂运动的领取按钮原来按"今日步数下方 208 像素"盲点，现在改成按按钮文字判断状态再点击。

### 20. 小程序页面里的控件要用坐标点击，并确认点击生效

- **现象**：鹅厂运动首页已经显示"7815 / 6666步"和"马上瓜分今日Q米"按钮，脚本找到按钮并点击，没有任何报错，但 5 秒后页面毫无变化，按钮还是可领取状态。
- **原因**：
  - 当时用的 `tap()` 先调用 `widget.click()`（无障碍 `ACTION_CLICK`），返回 false 才退回到坐标点击。小程序页面由 WebView 渲染（微信的 XWeb，基于 Chromium），WebView 收到 `ACTION_CLICK` 后只是把动作异步转交给页面，只要节点存在且没被禁用就立即返回 true。所以返回 true 不代表页面响应了，`tap()` 也就不会退回到坐标点击。
  - 页面收到后模拟的是 pointer、mouse、click 事件，**没有 touch 事件**。小程序的 `tap` 事件定义为"手指触摸后马上离开"，无障碍点击能不能触发 `bindtap`，取决于小程序基础库怎么处理，没有保证。
  - 这次失败是不是这个原因，日志里看不出来：也可能是领取请求被服务端拒绝了（当时刚过零点），页面的提示只显示一两秒，5 秒后再 dump 已经看不到。
- **解决**（见 `claimReward()`）：
  - 小程序页面里的控件一律用 `clickCenter()` 坐标点击。它通过无障碍手势（`dispatchGesture`）注入一次真实的触摸，和手指点击一样。`tap()` 只用于原生界面。
  - 每次点击后确认页面有反应：领取弹窗出现，或按钮变成"今日奖励已领取"。按钮还是可领取状态就重新查找按钮再点，最多 `MP_CLAIM_ATTEMPTS` 次。
  - 等待期间把页面上新出现的文字记到日志，再失败时能看到页面给出的提示。
- **依据**：Chromium 源码 `content/public/android/java/src/org/chromium/content/browser/accessibility/WebContentsAccessibilityImpl.java`（`performAction` → `performClick`）、`content/browser/accessibility/web_contents_accessibility_android.cc`（`Click()` 调用 `DoDefaultAction` 后直接返回 true）、`third_party/blink/renderer/modules/accessibility/ax_object.cc`（`OnNativeClickAction`）、`third_party/blink/renderer/core/dom/events/event_dispatcher.cc`（`DispatchSimulatedClick`）；AutoJs6 v6.7.0 源码 `core/automator/UiObjectActions.kt`（`click()` 就是 `performAction(ACTION_CLICK)`）、`core/automator/GlobalActionAutomator.kt`（`click(x, y)` 是手势）；微信开发文档"事件"一章对 `tap` 的定义。读的是上游 Chromium 的代码，XWeb 是它的分支，没有逐行核对。

### 21. 小程序里做动画的控件，控件树里的坐标可能停在动画中途

- **现象**：领取弹窗的金额是里程表式滚动数字：每一位是一列竖排的 `0–9`（重复两遍）TextView，整列上下平移，让目标数字停在显示窗口里，其余数字只是被遮住，在控件树里照样"可见"。原来的读法是每列取离小数点中心最近的那一格，读数保持 1.5 秒不变才采用。2026-10-15、10-16 两天读成 7.45、4.65，Q 米记录里实际是 5.25、0.66。
- **原因**：控件树里的坐标停在了动画中途的一帧，之后不再更新。证据来自两天日志里的 dump：
  - 弹窗刚出现时，三列的第一个"0"都在显示窗口里（top=1009，窗口中心 y≈1069）。约 1 秒后读数从 0.00 跳到 7.45（第二天是 4.65），之后一直不变，所以"保持 1.5 秒不变"的判断通过了；2.8 秒时 dump 出来的就是这组坐标。
  - 在这组坐标里，每列离窗口中心最近的那一格都偏离了 10–57 像素（一格约 117 像素，最多只能偏半格 58 像素）。停稳时每列都应该正对窗口，所以这不是最终画面。
  - 设每列最终平移"10 + 目标数字"格（先滚一整圈再停），两天里第 1、2、3 列停住的位置分别是最终平移的 43.2%、34.0%、29.7%，两天相差不到 0.1 个百分点。目标数字不同、比例却相同，说明控件树记下的是动画开始后固定时刻的一帧。
  - 为什么之后不更新，没有查证。推测：Chromium 的无障碍坐标在主线程更新布局时才刷新，CSS transform 动画在合成器线程上跑，动画期间主线程不重新布局，坐标就停在那一帧。动画结束后会不会刷新、多久刷新，也不知道。
- **解决**（见 `readTodayAmount()`）：不再读弹窗里的金额。点弹窗里的"查询Q米瓜分记录"进入 Q 米记录页，读今天那一行的数量。记录页是静态文字，数字也是服务端记下的实际领取量。
  - 2026-10-16 在已领取状态下实测，读对了当天的 0.66；领取后先关弹窗再去记录页这一步，要等领取当天才能验证。记录页的控件结构是按截图推测的，没有逐项核对 dump：每一行左边是日期"2026-10-16"和"领取时间 00:11"，右边是"+0.66"。所以 `findRecordAmount()` 不依赖具体拆分方式：先找今天的日期控件，取垂直中心离它最近的数量控件（带"+"号的优先，避开月份标题的"累计获得 20.58Q米"），再反过来确认离这个数量最近的日期就是今天这一行，免得今天的数量还没显示时取到相邻行的。
  - **入口**：Q 米记录页的入口是"我的"页右上角的"奖励记录"（2026-10-16 确认）。点首页的"今日奖励已领取"按钮没有任何反应，不会再弹出领取弹窗。"我的"页还有一个"健康记录"，所以匹配入口时不能只看"记录"两个字。切到"我的"标签后，首页的控件就不在控件树里了。
  - **领取后先关弹窗，再走"我的"→"奖励记录"**：已领取时走的也是这条路线，所以领取后当天再运行一次，就能把读记录这部分完整测一遍，不用等第二天。弹窗里的"查询Q米瓜分记录"只在领取时出现，每天只能测一次，也没确认过点开是不是同一个页面，所以只在弹窗关不掉时才用。弹窗开着时它的遮罩盖住了底部标签栏，点不到"我的"。
- **推广**：小程序里做动画的控件，坐标不可信，不要从它们的坐标里读数据；能从静态页面读到的，就从静态页面读。

### 23. 鹅厂运动打开时先显示上次同步的步数，几秒后才刷新

- **现象**：2026-10-22 反馈：脚本打开鹅厂运动后，几乎马上就报"步数未达标"。自己正常走了两三千步时也是这样：进入鹅厂运动后要等几秒，页面上的步数才刷新成最新值。
- **原因**：页面一打开先显示上次同步的步数，最新步数要过几秒才到。原来的 `waitStepsSynced()` 只等到步数大于 0，旧步数不是 0，它就当作已经同步，接着看到"还差 N 步"的按钮就判定未达标。
- **解决**（见 `waitStepsReady()`）：等按钮变成"马上瓜分今日Q米"或"今日奖励已领取"再往下走。一直是"还差 N 步"就等满 `MP_SYNC_TIMEOUT`（30 秒），其间每隔 `MP_REFRESH_INTERVAL`（10 秒）点一次"刷新"，等满后仍没达标才判定未达标。
- 同步实际要几秒、点"刷新"有没有用，还没有数据。步数或按钮一有变化，脚本就把它连同已等待的秒数记到日志里，以后按日志调整这两个值。

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
