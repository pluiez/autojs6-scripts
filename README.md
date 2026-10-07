# autojs6-scripts

在 Android 手机上用 [AutoJs6](https://github.com/SuperMonster003/AutoJs6) 运行的自动化脚本合集。

## 运行环境

- [AutoJs6](https://github.com/SuperMonster003/AutoJs6/releases)（开发时使用 v6.7.0）
- 测试设备：OnePlus 13T（ColorOS），无 root
- 需要授予 AutoJs6 的权限：
  - **无障碍服务**：查找和点击界面控件，所有脚本都需要
  - **[Shizuku](https://shizuku.rikka.app/)**（可选）：执行 shell 命令，比如清理最近任务。脚本会在 Shizuku 不可用时退回到兜底方案
  - **通知**：用来发送执行结果
  - **后台弹出界面**：ColorOS、MIUI/HyperOS、OriginOS 等系统需要开启，否则后台弹出的 toast 可能显示不出来

## 使用方法

1. 把需要的脚本复制到手机上，用 AutoJs6 打开。
2. 先手动运行一次，在 AutoJs6 的日志里确认每一步都正常。
3. 在 AutoJs6 里给脚本设置定时任务，让它每天自动运行。

脚本顶部的"配置"区放着可以调整的参数，比如超时时间、包名、界面文字等。

## 工作流

### `auto_steps/`：步数修改与运动打卡

| 脚本 | 说明 |
|---|---|
| `auto_steps.js` | 在"步数能手"中提交随机步数，再打开微信小程序"鹅厂运动"打卡，最后清理最近任务，通过通知和 toast 播报结果 |

执行流程：

1. 用包名打开步数能手，填入 7000–15000 之间的随机步数，点"提交"。等结果弹窗出现后解析其中的 JSON，`status` 为 `success` 且步数一致才算成功。
2. 移除步数能手的最近任务卡片，并强制停止它（通过 Shizuku）。
3. 打开微信，先判断它当前停在哪个界面，再拉出小程序面板，找到"鹅厂运动"并打开。常用列表里没有时，改用搜索。
4. 在小程序页面找到"今日步数"，点击它下方的领奖位置。
5. 只移除鹅厂运动的最近任务卡片，微信保持运行。
6. 发一条通知，同时弹一条 toast 播报结果。

注意事项：

- 配置区的 `MP_MIN_CENTER_Y`、`REWARD_OFFSET_Y` 是在测试设备上测出来的像素值，换手机后需要重新测量。
- 界面文字配置（`TEXT_*`）同时列出了中文和英文写法，以适配系统语言切换。

## 文档

- [docs/pitfalls.md](docs/pitfalls.md)：开发中踩过的坑，包括原因、解决方法和依据（AutoJs6 / AOSP 源码）
- [CLAUDE.md](CLAUDE.md)：给 coding agent 看的仓库约定

## 免责声明

本仓库的脚本仅供学习和个人使用。自动化操作第三方 App 可能违反其用户协议，由此导致的账号风险请自行承担。
