# WhereToI Web App

still updating ..... but please use and we are happy to have your review, issue & suggestion!
https://wheretoi-webapp.onrender.com/

WhereToI is a student design project about one small but stressful question: when you need a toilet now, where can you actually go?

WhereToI 是一个学生设计项目，关注一个很小但很真实的紧急问题：当你现在就需要上厕所时，哪里是真的可以去的？

We are testing a live prototype for people moving through busy campus, station, shopping, and public street contexts. The current version helps people compare nearby toilets before walking there, especially when access, cleanliness, cost, opening status, or facilities are uncertain.

我们正在测试一个线上原型，面向在校园、车站、商圈和高人流公共路线中移动的人。当前版本的重点是帮助用户在走过去之前，先判断附近厕所是否真的可用，尤其是开放状态、是否免费、是否干净、设施是否合适等信息不确定的时候。

## Try The Prototype / 试用原型

Open the live app here / 打开线上原型：

https://wheretoi-webapp.onrender.com/

You can currently try / 目前可以尝试：

- finding toilets from the Map view / 在 Map view 中查找附近厕所
- comparing toilet details before choosing where to go / 在决定去哪之前比较厕所详情
- filtering by practical needs where data is available / 在有数据的情况下按实际需求筛选
- checking cleanliness ratings and recent feedback / 查看清洁度评分和近期反馈
- leaving a cleanliness rating or written feedback / 留下清洁度评分或文字反馈
- testing Account, comment history, and public profile behaviour / 测试 Account、comment history 和 public profile 相关行为

The data is still incomplete and may be wrong. Please treat this as a prototype for testing and suggestions, not as a guaranteed public toilet database.

目前数据仍不完整，也可能有错误。请把它当作一个用于测试和收集建议的原型，而不是保证准确的公共厕所数据库。

## Please Open Issues / 请通过 Issue 提建议

We are actively looking for suggestions through GitHub Issues / 我们正在通过 GitHub Issues 收集建议：

https://github.com/HardenZhao123/WhereToI/issues

Please open an issue if you have suggestions about / 如果你对以下方面有建议，欢迎提交 issue：

- a confusing interaction or wording / 交互或文案让人困惑
- toilet information that looks wrong or missing / 厕所信息看起来错误或缺失
- accessibility, privacy, safety, or inclusion concerns / 无障碍、隐私、安全或包容性方面的担忧
- a feature that would help you decide faster in a real urgent situation / 能帮助你在真实紧急情况下更快决策的功能建议
- anything that would stop you from trusting the app / 任何会让你不信任这个 app 的地方

Helpful issues usually include / 一个有帮助的 issue 通常包括：

- what you were trying to do / 你当时想完成什么
- what happened / 实际发生了什么
- what you expected instead / 你原本期待发生什么
- your device and browser, if relevant / 如果相关，请写明设备和浏览器
- a screenshot, if you are comfortable sharing one / 如果方便，可以附截图

## Suggestions We Need Most / 最需要的建议

We are especially interested in suggestions about whether WhereToI helps you make a fast, confident toilet-access decision.

我们最关心的是关于这一点的建议：WhereToI 是否真的能帮助你快速、有信心地做出 toilet-access decision。

Useful questions to answer in an issue / 你可以在 issue 里回答这些问题：

- Could you tell which toilet you would walk to first? / 你能判断自己会先走去哪一个厕所吗？
- What information made a toilet feel trustworthy or untrustworthy? / 哪些信息让一个厕所显得可信或不可信？
- What important detail was missing? / 你觉得缺少了什么重要信息？
- Did filters, ratings, comments, or profiles help? / filters、ratings、comments 或 profiles 有帮助吗？
- Did anything feel unsafe, invasive, embarrassing, or too much effort? / 有没有任何地方让你觉得不安全、侵犯隐私、尴尬或太麻烦？
- Would this be useful in a busy place when you urgently need a toilet? / 如果你在很忙的地方急着找厕所，它会有用吗？

## Project Status / 项目状态

This is an active Designing for Real People project, currently in iterative prototype testing. The main focus is not to build a perfect map, but to learn what real people need before they spend time, money, or energy walking to a toilet that may not be usable.

这是一个正在进行中的 Designing for Real People 项目，目前处于迭代原型测试阶段。我们的重点不是做一个完美地图，而是理解真实用户在浪费时间、金钱或精力走去一个可能不可用的厕所之前，最需要知道什么。

Current design priorities / 当前设计重点：

- urgent use without forcing login first / 紧急使用时不强制先登录
- practical access details instead of generic map pins / 不只显示 map pins，而是提供实际可用性信息
- cleanliness and feedback that feel trustworthy / 让清洁度和用户反馈更可信
- inclusive facility details where available / 尽可能呈现包容性设施信息
- privacy-aware comment, Account, and profile behaviour / comment、Account 和 profile behaviour 需要考虑隐私

## Data Credits / 数据说明

This project uses a toilet dataset downloaded directly from the public domain in CSV format.

**License:** This data is provided under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.

## For Developers / 开发者

Requirements / 环境要求：

- Node.js `>=22.5.0 <27`
- npm

Run locally / 本地运行：

```bash
npm install
npm run dev
```

Then open / 然后打开：

```text
http://localhost:4173
```

### Optional PaddleOCR / 可选 PaddleOCR

PaddleOCR is only needed when you want admin review to extract text from user
toilet photos. Install the Python OCR packages separately from npm:

只有当你希望管理员审核用户上传厕所照片时自动提取文字，才需要安装 PaddleOCR。
Python OCR 包需要和 npm 依赖分开安装：

```bash
python3 -m pip install -r requirements-ocr.txt
WHERETOI_OCR_PROVIDER=paddle npm run dev
```

Render runs Python package installation inside its managed environment, so do
not use `pip install --user` there. For the production web service, use this
build command:

Render 会在它管理的 Python 环境里安装 Python 包，所以不要在 Render 上使用
`pip install --user`。生产环境 Web Service 使用这个 build command：

```bash
npm ci && python3 -m pip install -r requirements-ocr.txt && npm run build
```

Set these Render environment variables:

在 Render 里设置这些环境变量：

```text
PYTHON_VERSION=3.10.14
WHERETOI_OCR_PROVIDER=paddle
WHERETOI_PADDLEOCR_PYTHON=python3
WHERETOI_PADDLEOCR_TIMEOUT_MS=180000
WHERETOI_PADDLEOCR_MAX_IMAGE_DIMENSION=960
```

### Android APK / 安卓 APK

Build an installable development APK / 构建可安装的开发测试 APK：

```bash
npm run android:apk
```

The APK is written to `artifacts/WhereToI-<version>-debug.apk`, with
`artifacts/WhereToI-debug.apk` kept as a latest-build alias. It supports Android 8.0
and newer, loads the HTTPS production site, preserves login cookies, requests
location permission when needed, and opens external directions in a suitable
Android app.

APK 输出位置为 `artifacts/WhereToI-debug.apk`。它支持 Android 8.0 及以上版本，
会加载 HTTPS 线上网站、保留登录 Cookie、在需要时申请定位权限，并使用安卓应用打开
外部导航链接。手机侧载时需要允许浏览器或文件管理器“安装未知应用”。

This debug APK is suitable for direct testing, not public distribution. A
public release must be rebuilt with a private release keystore that is backed
up securely. The APK requires an internet connection for live toilet data,
map tiles, account actions, and directions.

这个 debug APK 适合直接测试，不适合公开发布。正式版必须使用妥善备份的私有 release
keystore 重新签名。实时厕所数据、地图、账户操作和导航仍然需要网络连接。

### Install the PWA on Android

The production site is configured as an installable Progressive Web App. After
deploying the latest build over HTTPS, open the site in Chrome on Android and
choose **Install app** from the browser menu. WhereToI then opens in its own
standalone window and appears in the Android app launcher.

The production build generates a versioned offline app shell automatically.
Live map tiles, toilet data, directions, and account actions still require a
network connection.

Publishing the same app through Google Play is a separate signing step: wrap
the deployed PWA in a Trusted Web Activity, configure Digital Asset Links for
the production domain, and upload the signed Android App Bundle through Play
Console.

Useful checks / 常用检查：

```bash
npm run check
npm test
npm run build
npm run android:apk
npm run check:e2e
```

The built-in `demo/demo123` account is disabled by default. For isolated local
or test data only, opt in with `WHERETOI_ENABLE_DEMO_ACCOUNT=true`. Production
must set `WHERETOI_REQUIRE_DATABASE_URL=true`, keep
`WHERETOI_ALLOW_DB_FALLBACK=false`, and keep the demo account disabled.

### iOS WKWebView / Capacitor Shell

The iOS app is a Capacitor wrapper that packages the static web app into
`ios/App/App/public` and runs it in `WKWebView`. In the native shell, API calls
target the production origin `https://wheretoi-webapp.onrender.com`, so the app
can use the live toilet data, account actions, comments, and feedback endpoints.

Requirements / 环境要求：

- macOS with Xcode installed
- Apple Developer account for device builds, TestFlight, or App Store upload
- Node.js and npm as above

Useful commands / 常用命令：

```bash
npm run ios:sync
npm run ios:open
npm run ios:run
```

`npm run ios:sync` rebuilds the static web app and copies it into the iOS
project. `npm run ios:open` opens the generated Xcode workspace/project so you
can configure signing, devices, TestFlight, and App Store archive settings.

The server allows credentialed requests from the default Capacitor origins
`capacitor://localhost` and `ionic://localhost`. To override or extend this in a
deployment, set `WHERETOI_CORS_ORIGINS` to a comma-separated list of allowed
origins.

This repository is maintained by the project team. We are not accepting external PRs right now; please use GitHub Issues for suggestions only.

这个仓库由项目团队维护。目前不接受外部 PR；请只通过 GitHub Issues 提建议。
