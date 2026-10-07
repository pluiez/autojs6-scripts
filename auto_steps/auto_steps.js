// ==========================================
// 终极完美版：步数能手 + WeChat鹅厂运动全自动打卡
// (阶段 Toast 提示 + 状态记录 + Shizuku 清理最近任务 + 通知播报)
// 运行环境：AutoJs6（只用经典 Auto.js API，可直接迁移到 AutoX v7 的 Rhino 引擎）
// 前置条件：开启无障碍服务；授权 Shizuku（不可用时自动退回到多任务手势清理）
// ==========================================

// 确保无障碍服务已开启，未开启时会跳转设置页并等待
auto.waitFor();

// ====== 配置 ======
// 用包名启动 App，不受系统语言影响（App 名称会随语言变化，如 微信 / WeChat）
var STEPS_PKG = "com.step.bsjl";
var WECHAT_PKG = "com.tencent.mm";
var MP_NAME = "鹅厂运动";
var MP_ACTIVITY = WECHAT_PKG + "/.plugin.appbrand.ui.AppBrandUI"; // 微信小程序界面的组件名前缀（AppBrandUI、AppBrandUI1 ...）
var STEPS_INPUT_INDEX = 2;       // 步数输入框是页面上第几个 EditText（从 0 开始）
var LAUNCH_TIMEOUT = 10000;      // 等待 App 打开并显示界面的最长时间（毫秒）
var SUBMIT_TIMEOUT = 15000;      // 提交后等待结果弹窗的最长时间（毫秒）
var MP_MIN_CENTER_Y = 300;       // 过滤顶部搜索栏等区域的像素阈值，换机需重测
var REWARD_BTN_TEXT = null;      // 领奖按钮文字（如 "领取"），填写后优先按文字点击
var REWARD_OFFSET_Y = 208;       // 未填按钮文字时，"今日步数" 下方的像素偏移，换机需重测
var REPORT_TITLE = "【今日打卡报告】";

// 界面文字：系统语言会在中英文间切换，每项列出所有可能的写法，App 改翻译时在这里补充
var TEXT_SUBMIT = ["提交", "Submit"];                       // 步数能手的提交按钮
var TEXT_CONFIRM = ["确定", "OK"];                          // 步数能手结果弹窗的确认按钮
var TEXT_CONTACTS_TAB = ["通讯录", "Contacts"];              // 微信首页底部标签，用于判断是否在首页
var TEXT_MP_SEARCH = ["搜索小程序", "Search Mini Programs"]; // 小程序面板顶部的搜索栏

// 记录各阶段的执行结果，最后统一播报
var runStatus = [];

// ====== 平台相关代码（迁移到其他 Auto.js 系平台时只需检查这里） ======

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

// 等待提交结果弹窗，解析其中的 JSON 判断是否成功，然后点击 "确定" 关闭弹窗
function waitSubmitResult(pkg, expectedSteps) {
    var node = textContains("\"status\"").packageName(pkg).findOne(SUBMIT_TIMEOUT);
    if (!node) {
        return { ok: false, msg: "未等到结果弹窗" };
    }
    var raw = String(node.text());
    var result;
    try {
        var data = JSON.parse(raw);
        result = {
            ok: data.status === "success" && Number(data.step) === expectedSteps,
            msg: data.message || data.status
        };
    } catch (e) {
        // 弹窗内容不是标准 JSON 时，退回到关键字判断
        result = { ok: raw.indexOf("success") >= 0, msg: raw };
    }
    var confirmBtn = waitVisibleByText(pkg, TEXT_CONFIRM, 2000);
    if (confirmBtn && !confirmBtn.click()) {
        clickCenter(confirmBtn);
    }
    return result;
}

// 判断控件中心是否在屏幕范围内（被收起或滚出屏幕的控件仍在控件树里，但坐标在屏幕外）
function isOnScreen(widget) {
    var b = widget.bounds();
    return b != null && b.centerX() > 0 && b.centerX() < device.width && b.centerY() > 0 && b.centerY() < device.height;
}

// 在指定 App 内查找第一个位于屏幕范围内、文字或描述等于 texts 中任一项的控件，找不到返回 null
function findVisibleByText(pkg, texts) {
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

// ====== 第一阶段：步数能手任务 ======
var stepsPkg = STEPS_PKG;
try {
    log("正在打开步数能手App...");
    app.launch(stepsPkg);
    // 先等 App 进入前台，再只在该 App 内查找控件，避免误找到 AutoJs6 等其他界面的控件
    if (!waitForApp(stepsPkg, LAUNCH_TIMEOUT)) {
        log("等待步数能手进入前台超时");
    }

    var randomSteps = random(7000, 15000);
    log("本次随机生成步数：" + randomSteps);

    var inputFields = waitForInputs(stepsPkg, STEPS_INPUT_INDEX + 1, LAUNCH_TIMEOUT);
    if (inputFields.length > STEPS_INPUT_INDEX) {
        inputFields[STEPS_INPUT_INDEX].setText(randomSteps.toString());
        sleep(500);

        var submitBtn = waitVisibleByText(stepsPkg, TEXT_SUBMIT, 2000);
        if (submitBtn) {
            submitBtn.click();
            var submitResult = waitSubmitResult(stepsPkg, randomSteps);
            if (submitResult.ok) {
                reportStage("✅ 步数修改：" + randomSteps + " 步");
            } else {
                reportStage("❌ 步数修改：" + submitResult.msg);
            }
        } else {
            reportStage("❌ 步数修改：找不到提交按钮");
        }
    } else {
        reportStage("❌ 步数修改：未找到输入框");
    }
} catch (e) {
    log(e);
    reportStage("❌ 步数能手：执行异常 " + e);
}

// 任务完成，关闭步数能手
closeApp(stepsPkg);
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

    // ====== 第三阶段：打卡 ======
    if (isMpOpened) {
        // 留足网络加载时间，确保图片和文字全部出来
        sleep(4000);

        // 优先按按钮文字点击，找不到再按锚点偏移盲点
        var rewardBtn = null;
        if (REWARD_BTN_TEXT) {
            rewardBtn = textContains(REWARD_BTN_TEXT).findOne(3000) || descContains(REWARD_BTN_TEXT).findOne(1000);
        }

        if (rewardBtn && rewardBtn.bounds() != null) {
            clickCenter(rewardBtn);
            reportStage("✅ 鹅厂运动：已点击「" + REWARD_BTN_TEXT + "」");
            sleep(1500);
        } else {
            var anchor = textContains("今日步数").findOne(3000) || descContains("今日步数").findOne(2000);
            if (anchor && anchor.bounds() != null) {
                click(device.width / 2, anchor.bounds().bottom + REWARD_OFFSET_Y);
                reportStage("✅ 鹅厂运动：已按锚点偏移点击");
                sleep(1500);
            } else {
                reportStage("❌ 鹅厂运动：未找到打卡锚点");
            }
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
