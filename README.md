# Media Thumbnail Explorer

Windows上のフォルダをExplorer風のツリーで選び、画像と動画を一覧・プレビューするElectronアプリです。動画は指定間隔ごとのサムネイルを最大320×240で生成します。

## 主な機能

- Windowsドライブ／フォルダの遅延読み込みツリー
- 選択フォルダ内の画像・動画一覧
- 画像の全体プレビュー
- 画像をダブルクリックすると全画面表示（右上の×またはEscで閉じる）
- 動画プレイヤーと間隔別サムネイル一覧
- 動画をダブルクリックするとWindowsの既定アプリで再生
- 間隔: 10秒、20秒、30秒、1分、10分、30分
- 長尺動画の生成途中キャンセル
- ダークテーマ

## 必要環境

- Windows 10 / 11（64bit推奨）
- Node.js 20以上
- npm

## 起動方法

プロジェクトのフォルダでPowerShellまたはコマンドプロンプトを開き、次を実行します。

```powershell
npm install
npm start
```

## Windowsインストーラーの作成

```powershell
npm run dist
```

完了後、`dist` フォルダにNSIS形式のセットアップexeが作成されます。

## 対応形式

- 画像: JPG / JPEG / JFIF / PJPEG / PJP / PNG / APNG / GIF / BMP / WebP / AVIF / SVG / ICO / TIFF / HEIC / HEIF / JPEG XL
- 動画: MP4 / M4V / WebM / MOV / AVI / MKV / WMV / MPEG / MPG

動画は拡張子が一覧対象でも、内部コーデックをElectron（Chromium）がデコードできない場合は再生・サムネイル生成できません。特に一部のAVI、MKV、WMVでは発生します。この場合はMP4（H.264/AAC）等への変換が必要です。

TIFF、HEIC/HEIF、JPEG XLは内部でPNGへ変換して表示します。画像の実データや圧縮方式によっては変換ライブラリが対応しておらず、表示できない場合があります。

## セキュリティ設計

レンダラーではNode.jsを無効にし、`contextIsolation` とサンドボックスを有効化しています。ローカルメディアは専用プロトコル経由で読み込みます。
