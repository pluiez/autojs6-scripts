// ==========================================
// 终极完美版：步数能手 + WeChat鹅厂运动全自动打卡
// (实时 Toast 提示 + 状态记录 + 自动杀后台 + 桌面防屏蔽播报)
// ==========================================

// 定义全局变量，用于记录任务最终的执行状态
var runStatus = "【今日打卡报告】\n";

// 封装关闭当前App的函数，方便随时调用
function closeCurrentApp() {
    log("▶ 准备关闭当前App...");
    toastLog("▶ 准备关闭当前App...");
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
    //home(); // 返回桌面
}

// ====== 第一阶段：步数能手任务 ======
try {
    app.launchApp("步数能手"); 
    toastLog("正在打开步数能手App...");
    sleep(1000); 

    var randomSteps = random(7000, 15000);
    toastLog("本次随机生成步数：" + randomSteps);

    var inputFields = className("android.widget.EditText").find();
    if (inputFields.length >= 3) {
        inputFields[2].setText(randomSteps.toString());
        sleep(500);
        
        var submitBtn = text("提交").findOne(2000);
        if (submitBtn) {
            //submitBtn.click();
            toastLog("步数提交成功！");
            runStatus += "✅ 步数修改：" + randomSteps + " 步\n";
        } else {
            toastLog("警告：未找到提交按钮");
            runStatus += "❌ 步数修改：找不到提交按钮\n";
        }
    } else {
        toastLog("警告：未找到输入框");
        runStatus += "❌ 步数修改：未找到输入框\n";
    }
    sleep(1000);
} catch(e) {
    runStatus += "❌ 步数能手：执行异常\n";
}


// 任务完成，调用函数清理步数能手，并回到桌面
closeCurrentApp();
sleep(1000);

// ====== 第二阶段：唤起微信与寻找小程序 ======
try {
    app.launchApp("WeChat");
    toastLog("正在打开微信...");
    sleep(1500); 

    var w = device.width;
    var h = device.height;

    toastLog("执行下拉手势...");
    gesture(400, [w/2, h*0.5], [w/2, h*0.85]);
    sleep(1000); 

    var mpName = "鹅厂运动";
    toastLog("扫描小程序：" + mpName);

    function findTargetMpWidget(name) {
        var textRes = textContains(name).find();
        var descRes = descContains(name).find();
        
        for (var i = 0; i < textRes.length; i++) {
            var widget = textRes[i];
            if (widget.className() != "android.widget.EditText" && widget.bounds() != null && widget.bounds().centerY() > 300) {
                return widget; 
            }
        }
        for (var i = 0; i < descRes.length; i++) {
            var widget = descRes[i];
            if (widget.className() != "android.widget.EditText" && widget.bounds() != null && widget.bounds().centerY() > 300) {
                return widget;
            }
        }
        return null;
    }

    var targetWidget = findTargetMpWidget(mpName);
    var isMpOpened = false;

    if (targetWidget != null) {
        toastLog("在常用列表中发现目标，直接点击！");
        click(targetWidget.bounds().centerX(), targetWidget.bounds().centerY());
        isMpOpened = true;
    } else {
        toastLog("常用列表未发现目标，启动搜索兜底...");
        var searchBtn = text("搜索小程序").findOne(3000) || desc("搜索小程序").findOne(1000);
        if (searchBtn && searchBtn.bounds() != null) {
            click(searchBtn.bounds().centerX(), searchBtn.bounds().centerY());
            sleep(1000); 
        }

        var wechatInput = className("android.widget.EditText").findOne(2000);
        if (wechatInput) {
            wechatInput.setText(mpName);
            sleep(1500); 
        }
        
        targetWidget = findTargetMpWidget(mpName);
        if (targetWidget != null) {
            toastLog("通过搜索成功找到并点击！");
            click(targetWidget.bounds().centerX(), targetWidget.bounds().centerY());
            isMpOpened = true;
        }
    }


    // ====== 第三阶段：盲狙打卡 ======
    if (isMpOpened) {
        toastLog("等待打卡页面渲染...");
        // 留足网络加载时间，确保图片和文字全部出来
        sleep(4000); 

        var anchor = textContains("今日步数").findOne(3000) || descContains("今日步数").findOne(2000);

        if (anchor && anchor.bounds() != null) {
            var clickX = device.width / 2;
            var clickY = anchor.bounds().bottom + 208; 
            
            click(clickX, clickY);
            runStatus += "✅ 鹅厂运动：奖励领取成功";
            sleep(1500);
        } else {
            runStatus += "❌ 鹅厂运动：未找到打卡锚点";
        }
    } else {
        runStatus += "❌ 鹅厂运动：未能打开小程序";
    }
} catch(e) {
    runStatus += "❌ 鹅厂运动：执行异常";
}

// 小程序任务完成，调用函数杀掉当前的微信进程，返回桌面
closeCurrentApp();

home();

sleep(3000);

// ====== 第四阶段：桌面防屏蔽播报 ======
// 此时已经回到桌面，完全脱离了微信的屏蔽限制
// 直接弹出一个包含所有执行结果的大 Toast 气泡
toastLog(runStatus);
