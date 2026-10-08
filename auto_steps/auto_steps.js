// ==========================================
// AutoTasks 刷步 + WeChat 鹅厂运动领取 Q 米
// (阶段 Toast 提示 + 状态记录 + Shizuku 清理最近任务 + 通知播报)
// 运行环境：AutoJs6
// 前置条件：开启无障碍服务；授权 Shizuku（不可用时自动退回到多任务手势清理）
// 定时运行：定时任务指向同目录的 remind.js，它负责响铃并发通知，点击通知后才运行本脚本。
//           本脚本被启动就直接执行，不区分启动方式
// ==========================================

// ====== 配置 ======
// 用包名启动 App，不受系统语言影响（App 名称会随语言变化，如 微信 / WeChat）
var AUTOTASKS_PKG = "ts.auto.tasks";
var WECHAT_PKG = "com.tencent.mm";
var MP_NAME = "鹅厂运动";
var MP_ACTIVITY = WECHAT_PKG + "/.plugin.appbrand.ui.AppBrandUI"; // 微信小程序界面的组件名前缀（AppBrandUI、AppBrandUI1 ...）
var STEPS_MIN = 7000;            // 随机步数下限
var STEPS_MAX = 10000;           // 随机步数上限（AutoTasks 手动刷步只接受 1–10000）
var LAUNCH_TIMEOUT = 10000;      // 等待 App 打开并显示界面的最长时间（毫秒）
var DIALOG_TIMEOUT = 3000;       // 等待 AutoTasks 手动刷步弹窗出现的最长时间
var TOAST_TIMEOUT = 2000;        // 点击"开始刷步"后等待结果 toast 的最长时间
var MP_LOAD_TIMEOUT = 3000;      // 等待鹅厂运动页面加载（"今日步数"出现）的最长时间
var MP_SYNC_TIMEOUT = 3000;      // 等待步数同步（步数不为 0）的最长时间
var MP_REFRESH_TIMEOUT = 3000;   // 点击"刷新"后再次等待步数同步的最长时间
var MP_POPUP_TIMEOUT = 3000;     // 点击领取后等待"今日已成功瓜分Q米"弹窗的最长时间
var MP_MIN_CENTER_Y = 300;       // 过滤顶部搜索栏等区域的像素阈值，换机需重测
var DEBUG_DUMP = true;           // 在关键界面把所有带文字的控件打印到日志，用于确认控件结构；确认后可关闭
var REPORT_TITLE = "【今日打卡报告】";
var REMIND_SCRIPT = "remind.js";          // 同目录的提醒脚本，锁屏无法执行时用它重新发提醒通知
var REMINDER_NOTICE_ID = 22000;           // remind.js 发出的提醒通知 ID，需与 remind.js 保持一致

// 界面文字
var TEXT_CONTACTS_TAB = ["通讯录", "Contacts"];              // 微信首页底部标签，用于判断是否在首页（系统语言会在中英文间切换）
var TEXT_MP_SEARCH = ["搜索小程序", "Search Mini Programs"]; // 小程序面板顶部的搜索栏（同上）
var TEXT_MANUAL_BTN = "手动";                 // AutoTasks 任务卡片上的手动刷步按钮
var TEXT_START_BTN = "开始刷步";              // AutoTasks 手动刷步弹窗的确认按钮
var TEXT_STEPS_ANCHOR = "今日步数";           // 鹅厂运动步数卡片标题，用作定位锚点
var TEXT_REFRESH = "刷新";                    // 鹅厂运动的刷新按钮
var TEXT_CLAIMABLE = "马上瓜分";              // 可领取时的按钮文字（"马上瓜分今日Q米"）
var TEXT_CLAIMED = "今日奖励已领取";          // 已领取时的按钮文字
var TEXT_NOT_ENOUGH = "还差";                 // 步数不足时的按钮文字（"还差6666步就能瓜分Q米，冲鸭 ~"）
var TEXT_POPUP_TITLE = "今日已成功瓜分Q米";   // 领取成功弹窗标题
var TEXT_POPUP_CLOSE = "坐等收米";            // 领取成功弹窗的关闭按钮

// 记录各阶段的执行结果，最后统一播报
var runStatus = [];

// ====== 平台相关代码（依赖 AutoJs6 特有接口的封装） ======

// 通过 Shizuku 执行 shell 命令，返回 { code, out }；Shizuku 不可用时抛出异常
// AutoX v7 的 shizuku() 返回值结构不同，迁移时需改这里
function shellRun(cmd) {
    var r = shizuku(cmd);
    return { code: r.code, out: String(r.result || "") };
}

// 清空 toast 队列后再显示新 toast
// 注：安卓 12+ 限制后台 App 的 toast 频率（20 秒内 3 条、42 秒内 5 条、68 秒内 6 条），超出的会被系统丢弃
// 注：AutoJs6 的 dismissAll 是异步投递的，新 toast 会插队到它前面而被一并清掉，所以中间要等一下
function showToast(msg, isLong) {
    log(msg);
    try {
        toast.dismissAll();
        sleep(150);
    } catch (e) {
        log("清空 toast 队列失败：" + e);
    }
    toast(msg, !!isLong);
}

// 发送系统通知（标题 + 多行内容）
function sendNotice(title, content) {
    try {
        notice(title, content.split("\n")[0], { bigContent: content, autoCancel: true });
    } catch (e) {
        log("发送通知失败：" + e);
    }
}

// 判断手机是否处于可操作状态：屏幕亮着且没有锁屏
function isDeviceUnlocked() {
    var km = context.getSystemService(android.content.Context.KEYGUARD_SERVICE);
    return device.isScreenOn() && !km.isKeyguardLocked();
}

// ====== 通用工具 ======

// 读取最近任务列表，按最近使用顺序返回 [{ id, block }]
// 每个任务块形如：
//   * Recent #0: Task{2c3e5f1 #1234 type=standard A=10245:com.tencent.mm}
//     ... mActivityComponent=com.tencent.mm/.ui.LauncherUI ...
function listRecentTasks() {
    var out = shellRun("dumpsys activity recents").out;
    var blocks = out.split(/\n(?=\s*\* Recent #\d+:)/);
    var tasks = [];
    for (var i = 0; i < blocks.length; i++) {
        var m = blocks[i].match(/Recent #\d+: Task\{\w+ #(\d+)/);
        if (m) {
            tasks.push({ id: m[1], block: blocks[i] });
        }
    }
    return tasks;
}

// 从最近任务中找出属于指定包名的任务 ID（含微信小程序等独立任务）
function findRecentTaskIds(pkg) {
    var tasks = listRecentTasks();
    var markers = ["mActivityComponent=" + pkg + "/", "I=" + pkg + "/", ":" + pkg + "}", ":" + pkg + " "];
    var ids = [];
    for (var i = 0; i < tasks.length; i++) {
        for (var j = 0; j < markers.length; j++) {
            if (tasks[i].block.indexOf(markers[j]) >= 0) {
                ids.push(tasks[i].id);
                break;
            }
        }
    }
    return ids;
}

// 找出最近使用的、界面组件以指定前缀开头的任务 ID，找不到返回 null
function findLatestTaskId(componentPrefix) {
    var tasks = listRecentTasks();
    for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].block.indexOf("mActivityComponent=" + componentPrefix) >= 0) {
            return tasks[i].id;
        }
    }
    return null;
}

// 判断最近任务中是否还存在指定任务 ID
function hasRecentTask(id) {
    var tasks = listRecentTasks();
    for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id == id) {
            return true;
        }
    }
    return false;
}

// 彻底关闭 App：从最近任务中移除（等同手动上滑卡片），再强制停止残留进程
// Shizuku 不可用或移除失败时，退回到多任务界面手势清理
function closeApp(pkg) {
    log("▶ 准备关闭 " + pkg + " ...");
    if (pkg) {
        try {
            var ids = findRecentTaskIds(pkg);
            for (var i = 0; i < ids.length; i++) {
                shellRun("am stack remove " + ids[i]);
            }
            shellRun("am force-stop " + pkg);
            sleep(500);
            if (findRecentTaskIds(pkg).length == 0) {
                log("已移除 " + pkg + " 的 " + ids.length + " 个最近任务");
                return;
            }
            log("最近任务中仍有 " + pkg + "，改用手势清理");
        } catch (e) {
            log("Shizuku 清理失败，改用手势清理：" + e);
        }
    }
    closeByRecents();
}

// 关闭刚用过的小程序：只移除它的最近任务卡片（等同手动上滑），不停止微信本身
// 最近任务按使用时间排序，刚打卡的小程序排在最前面，所以取第一个小程序任务
// Shizuku 不可用或移除失败时，退回到多任务界面手势清理（此时小程序在前台，清理的是它的卡片）
function closeMiniProgram() {
    log("▶ 准备关闭小程序 " + MP_NAME + " ...");
    try {
        var id = findLatestTaskId(MP_ACTIVITY);
        if (id == null) {
            log("最近任务中没有小程序任务");
            return;
        }
        shellRun("am stack remove " + id);
        sleep(500);
        if (!hasRecentTask(id)) {
            log("已移除小程序最近任务 #" + id);
            return;
        }
        log("最近任务中仍有小程序，改用手势清理");
    } catch (e) {
        log("Shizuku 清理失败，改用手势清理：" + e);
    }
    closeByRecents();
}

// 兜底方案：呼出多任务界面，上滑清理当前App
function closeByRecents() {
    recents(); // 呼出多任务界面
    sleep(1000); // 等待多任务界面动画展开

    var w = device.width;
    var h = device.height;
    var swipeX = w * 4 / 5; // 你测算出的精准X坐标
    var startY = h * 0.75;
    var endY = h * 0.2;

    // 执行上滑清理手势
    gesture(200, [swipeX, startY], [swipeX, endY]);
    sleep(500); // 等待清理动画结束
}

// 点击控件中心，适用于控件本身不可点击的情况
function clickCenter(widget) {
    var b = widget.bounds();
    click(b.centerX(), b.centerY());
}

// 等待指定 App 进入前台
function waitForApp(pkg, timeout) {
    var deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (currentPackage() == pkg) {
            return true;
        }
        sleep(200);
    }
    return false;
}

// 等待指定 App 中出现足够数量的输入框，返回输入框集合
function waitForInputs(pkg, minCount, timeout) {
    var deadline = Date.now() + timeout;
    var inputs = className("android.widget.EditText").packageName(pkg).find();
    while (inputs.length < minCount && Date.now() < deadline) {
        sleep(200);
        inputs = className("android.widget.EditText").packageName(pkg).find();
    }
    return inputs;
}

// 在指定时间内等待 App 内出现文字或描述等于 texts 中任一项、且位于屏幕范围内的控件，找不到返回 null
function waitVisibleByText(pkg, texts, timeout) {
    var deadline = Date.now() + timeout;
    var widget = findVisibleByText(pkg, texts);
    while (!widget && Date.now() < deadline) {
        sleep(200);
        widget = findVisibleByText(pkg, texts);
    }
    return widget;
}

// 判断控件中心是否在屏幕范围内（被收起或滚出屏幕的控件仍在控件树里，但坐标在屏幕外）
function isOnScreen(widget) {
    var b = widget.bounds();
    return b != null && b.centerX() > 0 && b.centerX() < device.width && b.centerY() > 0 && b.centerY() < device.height;
}

// 在指定 App 内查找第一个位于屏幕范围内、文字或描述等于 texts（字符串或字符串数组）中任一项的控件，找不到返回 null
function findVisibleByText(pkg, texts) {
    if (typeof texts === "string") {
        texts = [texts];
    }
    for (var t = 0; t < texts.length; t++) {
        var groups = [text(texts[t]).packageName(pkg).find(), desc(texts[t]).packageName(pkg).find()];
        for (var g = 0; g < groups.length; g++) {
            for (var i = 0; i < groups[g].length; i++) {
                if (isOnScreen(groups[g][i])) {
                    return groups[g][i];
                }
            }
        }
    }
    return null;
}

// 在指定 App 内查找第一个位于屏幕范围内、文字或描述包含 str 的控件，找不到返回 null
// 小程序页面的文字可能在 text 也可能在 desc 里，而且按钮文字常带有额外内容，所以用包含匹配
function findVisibleContaining(pkg, str) {
    var groups = [textContains(str).packageName(pkg).find(), descContains(str).packageName(pkg).find()];
    for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].length; i++) {
            if (isOnScreen(groups[g][i])) {
                return groups[g][i];
            }
        }
    }
    return null;
}

// 在指定时间内等待 findVisibleContaining 找到控件，找不到返回 null
function waitVisibleContaining(pkg, str, timeout) {
    var deadline = Date.now() + timeout;
    var widget = findVisibleContaining(pkg, str);
    while (!widget && Date.now() < deadline) {
        sleep(200);
        widget = findVisibleContaining(pkg, str);
    }
    return widget;
}

// 点击控件：优先用无障碍点击，控件不可点击时改为点击坐标中心
function tap(widget) {
    if (!widget.click()) {
        clickCenter(widget);
    }
}

// 返回控件的文字：text 为空时取 desc
function nodeText(widget) {
    var t = widget.text();
    if (t == null || String(t) === "") {
        t = widget.desc();
    }
    return t == null ? "" : String(t);
}

// 收集指定 App 中、垂直方向位于 [top, bottom] 区间内的可见叶子控件文字，按从上到下、从左到右的顺序拼接
// 只取叶子控件，避免父容器重复带上子控件的文字。
// 分行时按垂直方向是否重叠判断：字号不同的控件（如大号数字和小数点）高度不同，但只要上下有重叠就算同一行
function collectTextInBand(pkg, top, bottom) {
    var nodes = packageName(pkg).find();
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.childCount() > 0 || !isOnScreen(n)) {
            continue;
        }
        var b = n.bounds();
        var t = nodeText(n);
        if (t !== "" && b.top >= top && b.bottom <= bottom) {
            items.push({ top: b.top, bottom: b.bottom, left: b.left, text: t });
        }
    }
    items.sort(function (a, b) { return a.top - b.top; });
    var rows = [];
    for (var k = 0; k < items.length; k++) {
        var row = rows.length ? rows[rows.length - 1] : null;
        if (row && items[k].top < row.bottom) {
            row.items.push(items[k]);
            row.bottom = Math.max(row.bottom, items[k].bottom);
        } else {
            rows.push({ bottom: items[k].bottom, items: [items[k]] });
        }
    }
    return rows.map(function (r) {
        r.items.sort(function (a, b) { return a.left - b.left; });
        return r.items.map(function (it) { return it.text; }).join("");
    }).join("");
}

// 调试：把指定 App 中所有可见、带文字的控件打印到日志（DEBUG_DUMP 为 true 时生效）
function debugDump(label, pkg) {
    if (!DEBUG_DUMP) {
        return;
    }
    var nodes = packageName(pkg).find();
    log("[DUMP] ==== " + label + "（共 " + nodes.length + " 个控件）====");
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var t = n.text();
        var d = n.desc();
        if ((t == null || String(t) === "") && (d == null || String(d) === "")) {
            continue;
        }
        log("[DUMP] " + n.className() + " text=" + JSON.stringify(t == null ? null : String(t)) +
            " desc=" + JSON.stringify(d == null ? null : String(d)) +
            " bounds=" + n.bounds() + " children=" + n.childCount() + " clickable=" + n.clickable() +
            (isOnScreen(n) ? "" : " (屏幕外)"));
    }
}

// ====== AutoTasks：toast 监听 ======
// toast 不在控件树里，只能通过无障碍事件捕获。AutoJs6 在 Android 主线程上回调监听函数，
// 所以脚本线程 sleep 轮询时也能收到；用线程安全的列表在两个线程间传递结果
var capturedToasts = new java.util.concurrent.CopyOnWriteArrayList();

function startToastWatch(pkg) {
    capturedToasts.clear();
    events.observeToast();
    events.onToast(function (t) {
        if (String(t.getPackageName()) == pkg) {
            capturedToasts.add(String(t.getText()));
        }
    });
}

// 等待第一条 toast，超时返回 null
function waitToast(timeout) {
    var deadline = Date.now() + timeout;
    while (capturedToasts.isEmpty() && Date.now() < deadline) {
        sleep(100);
    }
    return capturedToasts.isEmpty() ? null : String(capturedToasts.get(0));
}

// 停止监听。observeToast 会让脚本在执行完后保持运行，必须移除，否则脚本不会退出
function stopToastWatch() {
    events.removeAllListeners("toast");
    events.removeToastObserver();
}

// ====== 鹅厂运动：读取页面状态 ======

// 读取"今日步数"卡片中的当前步数和达标线，返回 { steps, target }，读不到返回 null
// 步数和达标线可能是一个控件（"8923 / 6666步"），也可能拆成多个控件，所以先拼接区域内的文字再用正则提取
function readSteps(pkg) {
    var anchor = findVisibleContaining(pkg, TEXT_STEPS_ANCHOR);
    if (!anchor) {
        return null;
    }
    var top = anchor.bounds().top;
    var btn = findStateButton(pkg);
    var bottom = btn ? btn.node.bounds().top : anchor.bounds().bottom + device.height * 0.1;
    var m = collectTextInBand(pkg, top, bottom).match(/(\d+)\s*\/\s*(\d+)\s*步/);
    return m ? { steps: parseInt(m[1], 10), target: parseInt(m[2], 10) } : null;
}

// 找到步数卡片下方的状态按钮，返回 { state, node, text }，找不到返回 null
// state：claimable 可领取 / claimed 已领取 / notEnough 步数不足
function findStateButton(pkg) {
    var candidates = [["claimable", TEXT_CLAIMABLE], ["claimed", TEXT_CLAIMED], ["notEnough", TEXT_NOT_ENOUGH]];
    for (var i = 0; i < candidates.length; i++) {
        var node = findVisibleContaining(pkg, candidates[i][1]);
        if (node) {
            return { state: candidates[i][0], node: node, text: nodeText(node) };
        }
    }
    return null;
}

// 等待步数同步（步数大于 0），超时返回最后一次读到的结果（可能为 null）
function waitStepsSynced(pkg, timeout) {
    var deadline = Date.now() + timeout;
    var info = readSteps(pkg);
    while ((!info || info.steps <= 0) && Date.now() < deadline) {
        sleep(500);
        info = readSteps(pkg);
    }
    return info;
}

// 点击领取后，等待成功弹窗并读出领取的 Q 米数量，然后关闭弹窗；返回数量字符串，失败返回 null
function readClaimedAmount(pkg) {
    var title = waitVisibleContaining(pkg, TEXT_POPUP_TITLE, MP_POPUP_TIMEOUT);
    debugDump("鹅厂运动领取弹窗", pkg);
    if (!title) {
        return null;
    }
    // 金额在标题正下方，区域下边界取关闭按钮上方，找不到关闭按钮时取标题下方 12% 屏幕高度
    var closeBtn = findVisibleContaining(pkg, TEXT_POPUP_CLOSE);
    var top = title.bounds().bottom;
    var bottom = Math.min(top + device.height * 0.12, closeBtn ? closeBtn.bounds().top : device.height);
    var m = collectTextInBand(pkg, top, bottom).match(/\d+(?:\.\d+)?/);
    if (closeBtn) {
        tap(closeBtn);
    }
    return m ? m[0] : null;
}

// 让微信拉出小程序面板，成功返回 true
// 微信不再被强制停止，打开时会停留在上次离开的界面，所以每次先判断当前状态再操作
function openMpDrawer(pkg) {
    var w = device.width;
    var h = device.height;
    for (var attempt = 0; attempt < 3; attempt++) {
        if (findVisibleByText(pkg, TEXT_MP_SEARCH)) {
            return true; // 小程序面板已展开
        }
        if (findVisibleByText(pkg, TEXT_CONTACTS_TAB)) {
            // 底部标签栏可见，说明在微信首页，下拉打开小程序面板
            log("执行下拉手势...");
            gesture(400, [w / 2, h * 0.5], [w / 2, h * 0.85]);
        } else {
            // 停在聊天、公众号等子页面，按返回键退回首页
            log("不在微信首页，按返回键");
            back();
        }
        sleep(1000);
        if (currentPackage() != pkg) {
            // 返回过头退出了微信，重新打开
            app.launch(pkg);
            waitForApp(pkg, LAUNCH_TIMEOUT);
            sleep(1000);
        }
    }
    return findVisibleByText(pkg, TEXT_MP_SEARCH) != null;
}

// 在当前界面查找小程序入口控件（排除输入框、屏幕外和顶部区域的控件）
function findTargetMpWidget(name) {
    var groups = [textContains(name).find(), descContains(name).find()];
    for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].length; i++) {
            var widget = groups[g][i];
            if (widget.className() != "android.widget.EditText" && isOnScreen(widget) && widget.bounds().centerY() > MP_MIN_CENTER_Y) {
                return widget;
            }
        }
    }
    return null;
}

// 记录阶段结果并弹出阶段 toast
function reportStage(line) {
    runStatus.push(line);
    showToast(line);
}

// ====== 前置检查 ======
// 锁屏时无法操作界面，交给 remind.js 重新发提醒通知后退出
if (!isDeviceUnlocked()) {
    log("手机已锁屏，重新发送提醒通知后退出");
    engines.execScriptFile(files.path("./" + REMIND_SCRIPT), {
        arguments: { message: "手机已锁屏，解锁后点击此通知开始执行今日打卡" },
    });
    exit();
}
// 正常执行时清除之前留下的提醒通知（例如用户没点通知、直接手动运行了脚本）
notice.cancel(REMINDER_NOTICE_ID);

// 确保无障碍服务已开启，未开启时会跳转设置页并等待
auto.waitFor();

// ====== 第一阶段：AutoTasks 手动刷步 ======
var autoTasksPkg = AUTOTASKS_PKG;
try {
    log("正在打开 AutoTasks...");
    app.launch(autoTasksPkg);
    // 先等 App 进入前台，再只在该 App 内查找控件，避免误找到 AutoJs6 等其他界面的控件
    if (!waitForApp(autoTasksPkg, LAUNCH_TIMEOUT)) {
        log("等待 AutoTasks 进入前台超时");
    }

    var manualBtn = waitVisibleByText(autoTasksPkg, TEXT_MANUAL_BTN, LAUNCH_TIMEOUT);
    if (!manualBtn) {
        debugDump("AutoTasks 首页（未找到手动按钮）", autoTasksPkg);
        reportStage("❌ 刷步：找不到「" + TEXT_MANUAL_BTN + "」按钮");
    } else {
        tap(manualBtn);
        var inputs = waitForInputs(autoTasksPkg, 1, DIALOG_TIMEOUT);
        debugDump("AutoTasks 手动刷步弹窗", autoTasksPkg);
        var startBtn = waitVisibleByText(autoTasksPkg, TEXT_START_BTN, DIALOG_TIMEOUT);
        if (inputs.length < 1) {
            reportStage("❌ 刷步：未找到步数输入框");
        } else if (!startBtn) {
            reportStage("❌ 刷步：找不到「" + TEXT_START_BTN + "」按钮");
        } else {
            var randomSteps = random(STEPS_MIN, STEPS_MAX);
            inputs[0].setText(String(randomSteps));
            sleep(300);
            log("本次随机生成步数：" + randomSteps + "，输入框当前内容：" + nodeText(inputs[0]));

            // 弹窗关闭后立即弹出结果 toast 且显示时间很短，所以要在点击之前开始监听
            startToastWatch(autoTasksPkg);
            try {
                tap(startBtn);
                var toastText = waitToast(TOAST_TIMEOUT);
            } finally {
                stopToastWatch();
            }
            if (toastText == null) {
                reportStage("⚠️ 刷步：未捕获到结果提示（" + randomSteps + " 步）");
            } else if (toastText.indexOf("成功") >= 0) {
                reportStage("✅ 刷步成功：" + randomSteps + " 步");
            } else {
                reportStage("❌ 刷步失败：" + toastText);
            }
        }
    }
} catch (e) {
    log(e);
    reportStage("❌ AutoTasks：执行异常 " + e);
}

// 任务完成，关闭 AutoTasks
closeApp(autoTasksPkg);
sleep(1000);

// ====== 第二阶段：唤起微信与寻找小程序 ======
var wechatPkg = WECHAT_PKG;
try {
    log("正在打开微信...");
    app.launch(wechatPkg);
    if (!waitForApp(wechatPkg, LAUNCH_TIMEOUT)) {
        log("等待微信进入前台超时");
    }
    sleep(1000); // 等待微信界面渲染完成

    var isMpOpened = false;
    var targetWidget = null;
    if (openMpDrawer(wechatPkg)) {
        log("扫描小程序：" + MP_NAME);
        targetWidget = findTargetMpWidget(MP_NAME);
    } else {
        log("未能拉出小程序面板");
    }

    if (targetWidget != null) {
        log("在常用列表中发现目标，直接点击！");
        clickCenter(targetWidget);
        isMpOpened = true;
    } else {
        log("常用列表未发现目标，启动搜索兜底...");
        var searchBtn = findVisibleByText(wechatPkg, TEXT_MP_SEARCH);
        if (searchBtn) {
            clickCenter(searchBtn);
            sleep(1000);
        }

        var wechatInput = className("android.widget.EditText").packageName(wechatPkg).findOne(2000);
        if (wechatInput) {
            wechatInput.setText(MP_NAME);
            sleep(1500);
        }

        targetWidget = findTargetMpWidget(MP_NAME);
        if (targetWidget != null) {
            log("通过搜索成功找到并点击！");
            clickCenter(targetWidget);
            isMpOpened = true;
        }
    }

    // 打开结果只记日志不弹 toast：后台 App 20 秒内最多显示 3 条 toast，要留给打卡结果和最终报告
    if (isMpOpened) {
        log("已打开" + MP_NAME + "，等待页面加载");
    } else {
        reportStage("❌ 鹅厂运动：未能打开小程序");
    }

    // ====== 第三阶段：领取 Q 米 ======
    if (isMpOpened) {
        if (!waitVisibleContaining(wechatPkg, TEXT_STEPS_ANCHOR, MP_LOAD_TIMEOUT)) {
            log("等待鹅厂运动页面加载超时");
        }

        // 打开后要过一会儿才会同步步数，先等待，仍为 0 时点一次"刷新"再等
        var stepsInfo = waitStepsSynced(wechatPkg, MP_SYNC_TIMEOUT);
        if (!stepsInfo || stepsInfo.steps <= 0) {
            var refreshBtn = findVisibleContaining(wechatPkg, TEXT_REFRESH);
            if (refreshBtn) {
                log("步数未同步，点击刷新");
                tap(refreshBtn);
                stepsInfo = waitStepsSynced(wechatPkg, MP_REFRESH_TIMEOUT);
            }
        }
        debugDump("鹅厂运动首页", wechatPkg);
        var stepsDesc = stepsInfo ? stepsInfo.steps + "/" + stepsInfo.target : "步数未知";
        log("鹅厂运动步数：" + stepsDesc);

        // 按状态按钮的文字判断当前状态
        var stateBtn = findStateButton(wechatPkg);
        if (!stateBtn) {
            reportStage("⚠️ 鹅厂运动：未识别到领取按钮（" + stepsDesc + "）");
        } else if (stateBtn.state == "claimed") {
            reportStage("ℹ️ 鹅厂运动：今日奖励已领取（" + stepsDesc + "）");
        } else if (stateBtn.state == "notEnough") {
            reportStage("❌ 鹅厂运动：步数未达标（" + stepsDesc + "）");
        } else {
            tap(stateBtn.node);
            var amount = readClaimedAmount(wechatPkg);
            if (amount != null) {
                reportStage("✅ 鹅厂运动：领取 " + amount + " Q米（" + stepsDesc + "）");
            } else {
                reportStage("⚠️ 鹅厂运动：已点击领取，但未读到领取结果（" + stepsDesc + "）");
            }
            sleep(1000);
        }
    }
} catch (e) {
    log(e);
    reportStage("❌ 鹅厂运动：执行异常 " + e);
}

// 小程序任务完成，只关闭小程序（保留微信），返回桌面
closeMiniProgram();

home();
sleep(1000);

// ====== 第四阶段：通知 + Toast 播报 ======
var reportText = runStatus.join("\n");
sendNotice(REPORT_TITLE, reportText);
showToast(REPORT_TITLE + "\n" + reportText, true);
