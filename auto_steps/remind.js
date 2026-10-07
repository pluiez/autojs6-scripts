// ==========================================
// 打卡提醒：响铃并发一条"点击执行"通知，点击后运行 auto_steps.js
// 运行环境：AutoJs6
// 用法：在 AutoJs6 中给本脚本设置定时任务（如每天 22:00）。
//       本脚本必须和 auto_steps.js 放在同一目录下。
// 参数：被其他脚本通过 engines.execScriptFile() 调用时，可以用 arguments.message 指定通知内容
// ==========================================

// ====== 配置 ======
var TARGET_SCRIPT = "auto_steps.js";              // 点击通知后运行的脚本，相对本脚本所在目录
var NOTICE_TITLE = "【今日打卡提醒】";
var DEFAULT_MESSAGE = "到点了，点击此通知开始执行今日打卡";
var REMINDER_NOTICE_ID = 22000;                   // 通知固定 ID，重复触发时覆盖旧通知而不是叠加；auto_steps.js 中有同名常量，需保持一致
var REMINDER_CHANNEL_ID = "auto_steps_reminder";  // 通知渠道，重要性为 high，会响铃并弹出横幅

// 用 Android 系统接口创建通知渠道。AutoJs6 v6.7.0 没有把 notice.channel.create 暴露给脚本（文档里有，实际调用会报错）
// 渠道创建后，重要性等设置以系统中的渠道设置为准，改代码不会生效，需要到系统通知设置里调整
var channel = new android.app.NotificationChannel(REMINDER_CHANNEL_ID, "打卡提醒",
    android.app.NotificationManager.IMPORTANCE_HIGH);
channel.setDescription("到点提醒，点击通知开始执行打卡");
channel.enableVibration(true);
context.getSystemService(android.content.Context.NOTIFICATION_SERVICE).createNotificationChannel(channel);

var argv = engines.myEngine().execArgv;
var message = (argv && argv.message) || DEFAULT_MESSAGE;
var options = { channelId: REMINDER_CHANNEL_ID, isSilent: false, notificationId: REMINDER_NOTICE_ID };

var targetPath = files.path("./" + TARGET_SCRIPT);
if (files.exists(targetPath)) {
    // 点击通知后由 AutoJs6 的 RunIntentActivity 按 path 运行目标脚本；锁屏时点击，系统会先要求解锁
    var intent = new android.content.Intent();
    intent.setClassName(context.getPackageName(), "org.autojs.autojs.external.open.RunIntentActivity");
    intent.putExtra("path", targetPath);
    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
    options.intent = intent;
    options.autoCancel = true;
} else {
    message += "\n（找不到 " + TARGET_SCRIPT + "，请在 AutoJs6 中手动运行）";
}

log("发送打卡提醒通知：" + message);
notice(NOTICE_TITLE, message, options);
