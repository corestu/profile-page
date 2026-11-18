# profile-page

摸鱼大王的个人主页：一张竖向棱纹的毛玻璃卡片，叠在极光视频上，棱纹会折射背后的画面。

- 线上地址：<https://moyu.plus/>
- 仓库地址：<https://github.com/corestu/profile-page>

纯静态单页，没有构建步骤，改完 HTML/CSS/JS 直接打包上传。静态资源在 CDN，源站只放 4 个文件。

## 效果构成

| 层 | 实现 |
|---|---|
| 背景视频 | 13 秒循环的极光视频，`<video muted loop playsinline>`，不接管播放控件 |
| 棱纹折射 | 原生 WebGL 片元着色器，把视频帧当纹理，按 27px 一条的竖向棱纹做透镜形变与多次软化采样 |
| 毛玻璃卡片 | CSS `backdrop-filter: blur() saturate() brightness()`，白色半透明底，正文深蓝 |
| 下半屏柔化 | 着色器内按高度渐变，底部 12 点黄金角圆盘采样，越靠下越只剩大概颜色 |

实现上有几处取舍：

- 棱纹按固定物理宽度（27 CSS px）绘制，不是「每屏 71 条」。1920 宽屏幕仍是 71 条，手机上条数变少而不是变密。
- 没有暗色遮罩，背景保持原始亮度，可读性靠卡片的白色底与文字对比度。
- 视频帧率与渲染解耦：只有 `video.currentTime` 变化时才重新上传纹理，页面不可见或滚出视口时视频和渲染一起暂停。
- 降级链：无 WebGL 时用视频加 CSS 棱纹，无 JS 时是静态径向渐变，`prefers-reduced-motion` 下停在首帧。

## 目录结构

```
profile-page/
├── index.html              页面本体（head 内含完整 SEO / JSON-LD）
├── favicon.ico             源站根目录，浏览器会自动请求 /favicon.ico
├── robots.txt              源站根目录
├── sitemap.xml             源站根目录，打包时自动刷新 lastmod
├── package-site.bat        打包脚本，产出服务器包与 CDN 包
├── assets/                 全部静态素材，整目录上传 CDN
│   ├── style.css           样式
│   ├── bg.js               WebGL 渲染器（无依赖）
│   ├── aurora.mp4          极光背景视频
│   ├── avatar.webp         头像（透明底）
│   ├── icon-32.png         浏览器图标
│   ├── icon-192.png        浏览器图标 / 添加到主屏
│   └── apple-touch-icon.png iOS 主屏图标
├── dist/                   部署用产物，已 gitignore
└── pack/                   打包产物，已 gitignore
```

## 本地预览

必须用 HTTP 打开，双击文件不行：视频帧要作为 WebGL 纹理上传，`file://` 下这一步通常会被浏览器拒绝，页面掉到降级分支。

```bash
python -m http.server 8080
# 打开 http://localhost:8080/
```

`index.html` 引用的是 CDN 上的 `style.css` 和 `bg.js`。要在本地改样式看效果，得把这两处 `<link>`、`<script>` 临时指向 `./assets/`。

## 打包

```bat
package-site.bat
```

依赖 `brotli` 和 `gzip`。脚本先查 PATH，找不到再回落到 Git 自带的 `mingw64\bin` 与 `usr\bin`。产物输出到 `pack\`，也可以把别的目录作为第一个参数传进去：

| 产物 | 内容 | 体积 |
|---|---|---|
| `profile-page.zip` | `index.html`、`favicon.ico`、`robots.txt`、`sitemap.xml`，原样不压缩 | ~22 KB |
| `profile-page-cdn.zip` | `assets\` 全目录 + `style.css`/`bg.js` 的 `.br`、`.gz` | ~582 KB |

打包过程做了这几件事：

- 服务器包不预压缩。HTML 只有几 KB，交给 Nginx 运行时 `gzip on` 就够了。
- CDN 包为文本文件生成 `.br`（`-q 11`）和 `.gz`（`-9 -n`），供 `brotli_static`、`gzip_static` 直接命中。mp4、webp、png、ico 本身就是压缩格式，再压只会变大，跳过。
- 版本号每次打包重算。`index.html` 里每个 CDN 地址都带 `?v=<sha256 前 8 位>`，脚本对 `assets\` 下 7 个素材和根目录 `favicon.ico` 逐个算 SHA-256，改写 HTML 后再封包。改完 CSS 跑一次脚本就行，不会出现 CSS 更新了、页面还引用旧缓存的情况。
- `sitemap.xml` 的 `lastmod` 每次刷新成当天。

## 部署

源站（Nginx 或任意静态托管）只需要 4 个文件，都放在站点根目录：

```
index.html  favicon.ico  robots.txt  sitemap.xml
```

```bash
unzip profile-page.zip -d /var/www/profile/
```

CDN 这边把 `profile-page-cdn.zip` 解压出的 `assets/` 整目录上传，保持层级，访问路径形如 `https://cdn.example.com/static/home/assets/style.css`。传完需要把 `index.html` 里 7 处引用改成对应的前缀。

CDN 侧有两个条件必须满足，否则页面会静默降级：

1. `aurora.mp4` 响应头带 `Access-Control-Allow-Origin`（视频帧要上传成 WebGL 纹理，跨域不走 CORS 会抛 `SecurityError`）
2. 查询串参与缓存键，否则 `?v=` 失效。若 CDN 开启「忽略查询参数」，需关掉该选项，或每次改版后手动刷缓存

Nginx 最小配置：

```nginx
server {
    listen 80;
    server_name moyu.plus;
    root /var/www/profile;
    index index.html;

    location / { try_files $uri $uri/ =404; }
    location ~* \.(css|js|html)$ {
        gzip_static on;
        brotli_static on;   # 需编译 ngx_brotli
        expires 7d;
    }
}
```

## SEO

`index.html` 的 head 里有 `title`、`description`、`keywords`、`canonical`（指向 `https://moyu.plus/`）、Open Graph 与 Twitter Card 各标签、`theme-color`，以及 `WebSite` 和 `Person` 两个节点的 JSON-LD `@graph`。

`robots.txt` 放开全站并声明 sitemap，`sitemap.xml` 只有一条 URL。如果页面最终不在 `moyu.plus` 根路径，**必须同步改掉 canonical 与 og:url**，否则搜索引擎会认为真正的页面在别处。

## 响应式

- ≥ 641px：居中卡片，圆角、描边、阴影，最大宽度 520px
- ≤ 640px：卡片铺满整屏，去掉圆角和阴影，`min-height: 100dvh`，四边留 `env(safe-area-inset-*)` 安全区，页脚用 `margin-top: auto` 贴底
- `<meta name="viewport">` 带 `viewport-fit=cover`，避免 iOS 刘海屏出现色差条

## 素材来源

- 极光背景视频取自 [im.qq.com](https://im.qq.com/index/) 首页，版权归腾讯，**仅限个人非商业使用**。商用前换成自有授权素材，`assets/aurora.mp4` 和 `bg.js` 里的纹理源要一起替换。
- 棱纹折射的形变思路来自 LeiBox「Blue Fluted Glass」文档，着色器是独立重写的。
