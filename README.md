# Media Thumbnail Explorer

Media Thumbnail Explorer is an Electron-based media browser for Windows
that lets you navigate folders in a tree and browse images and videos
with thumbnails.

It is designed to make large media folders easier to inspect without
repeatedly switching between Explorer windows by keeping the folder
tree, media list, and preview in a single interface.

------------------------------------------------------------------------

## Features

-   Automatically detects Windows drives and displays a folder tree
-   Shows expand controls only for folders that actually contain
    subfolders
-   Displays images and videos in a thumbnail-based media list
-   Automatically selects representative frames for video thumbnails
-   Shows an image preview when an image is selected
-   Opens images in a fullscreen viewer on double-click
-   Supports previous/next image navigation with `Left Arrow` /
    `Right Arrow` in the fullscreen viewer
-   Opens videos with the OS default application on double-click
-   Converts TIFF / HEIC / HEIF / JXL to PNG for display
-   Restores window size, position, and maximized state on the next
    launch
-   Restores the last opened folder on the next launch
-   Terminates running FFmpeg / FFprobe child processes when the
    application exits
-   Uses a custom application icon

------------------------------------------------------------------------

## Supported Formats

### Images

`jpg` / `jpeg` / `jfif` / `pjpeg` / `pjp` / `png` / `apng` / `gif` /
`bmp` / `webp` / `avif` / `svg` / `ico` / `tif` / `tiff` / `heic` /
`heif` / `jxl`

### Videos

`mp4` / `m4v` / `webm` / `mov` / `avi` / `mkv` / `wmv` / `mpeg` / `mpg`

------------------------------------------------------------------------

## Requirements

-   Windows
-   Node.js
-   npm
-   An environment capable of running Electron

FFmpeg and FFprobe are used to generate video thumbnails.

The application resolves the executables in the following order:

1.  `FFMPEG_PATH` / `FFPROBE_PATH` environment variables
2.  FFmpeg / FFprobe provided by npm dependencies
3.  `ffmpeg` / `ffprobe` available on `PATH`

------------------------------------------------------------------------

## Installation

Install the dependencies after cloning the repository:

``` bash
npm install
```

------------------------------------------------------------------------

## Running the Application

``` bash
npm start
```

------------------------------------------------------------------------

## Basic Usage

1.  Select a folder from the folder tree on the left.
2.  Images and videos in that folder appear in the media list with
    thumbnails.
3.  Select a file to show it in the preview pane.
4.  Double-click an image to open the fullscreen viewer.
5.  In the fullscreen viewer, use `Left Arrow` / `Right Arrow` to move
    between images and `Esc` to close it.
6.  Double-click a video to open it with the OS default application.

The last opened folder is saved and restored on the next launch,
including the expanded tree path, selected folder, and media list. The
previously selected individual file and preview content are not
currently restored.

------------------------------------------------------------------------

## Thumbnail Generation

Images are loaded through the application's custom `media-file:`
protocol.

For videos, FFprobe is used to determine duration and FFmpeg extracts
candidate frames from multiple positions. Short videos use a frame near
the middle, while longer videos evaluate several positions to select a
representative thumbnail.

Generated video thumbnails are cached in a temporary directory.

------------------------------------------------------------------------

## Directory Structure

``` text
media-thumbnail-explorer/
├─ assets/
│  └─ icon.png
├─ doc/
│  └─ 0.x/
│     └─ 0.x.x/
│        ├─ README.md
│        └─ screenshots/
├─ src/
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ index.html
│     ├─ app.js
│     └─ styles.css
├─ CHANGELOG.md
├─ README.md
├─ package.json
└─ package-lock.json
```

The `doc/` directory contains detailed development records for each
version. These records are intended to preserve not only successful
implementations but also failed attempts, encountered issues, their
causes, and the fixes that followed.

------------------------------------------------------------------------

## Development Status

Latest release:

``` text
v0.3.4
```

See [CHANGELOG.md](CHANGELOG.md) for the version history.

------------------------------------------------------------------------

## Development Policy

-   Keep implementation commits and test-result commits separate in Git
    history
-   Preserve failed implementations and failed tests instead of hiding
    them from history
-   Keep detailed version-specific development records under `doc/`
-   Never modify the user's media files
-   Avoid unnecessary dependencies on external services

------------------------------------------------------------------------

## License

The license is currently being prepared. Check the license document
included in the repository before public redistribution.
