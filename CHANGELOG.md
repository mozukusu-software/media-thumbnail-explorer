# Media Thumbnail Explorer Changelog

------------------------------------------------------------------------

# v0.5

## v0.5.0 - File Tagging and Filtering

### Added

-   Added persistent file tags backed by SQLite metadata stored in the
    application user-data directory.
-   Added tag creation and case-insensitive duplicate prevention.
-   Added right-click tag editing for single and multiple selected files,
    including comma-separated new tags and tri-state existing-tag controls.
-   Added permanent tag filtering below the folder tree with tag search and
    AND / OR matching modes.
-   Added tag information to media-list rows and the selected-file preview.
-   Added draggable splitters for the folder/tag height and the main workspace
    pane widths, with the selected ratios persisted locally.

### Changed

-   Updated project version metadata to 0.5.0.
-   Tag metadata is maintained separately from the media files; assigning or
    removing tags does not modify the user's media files.
-   Files moved or renamed outside Media Thumbnail Explorer are not tracked in
    v0.5.0 and are treated as different paths.

### Verification

-   Verified SQLite schema creation, tag persistence, case-insensitive
    uniqueness, assignment, removal, cascade deletion, and bulk updates.
-   Verified multi-selection, tri-state tag editing, tag badges and summaries,
    AND / OR filtering, and draggable splitters.
-   Verified the existing UNC, FFmpeg error handling, preview cancellation, and
    media-processing job-control regressions remain covered.
-   Verified the v0.5.0 UI with release screenshots for the tag overview,
    multi-selection tag editor, and AND filtering.

------------------------------------------------------------------------

# v0.4

## v0.4.1 - Documentation and Release Gate

### Fixed

-   Added the version-specific v0.4.0 development record that was
    missing from the published v0.4.0 release.

### Added

-   Added a mechanical Release Gate for release-time consistency checks.
-   Added the v0.4.1 version-specific development record.

### Changed

-   Updated project version metadata to 0.4.1.
-   Kept the published v0.4.0 release and tag unchanged; v0.4.1 is a
    separate maintenance release.
-   No application feature or UI behavior changes are included in this
    release.

### Verification

-   Verified package.json and package-lock.json version consistency.
-   Verified CHANGELOG releases have corresponding version-specific
    development records.
-   Verified local images referenced by version documentation exist.
-   Verified Apache-2.0 / LICENSE consistency.
-   Verified Git worktree and `git diff --check`.
-   Verified the existing automated tests through the Release Gate.

------------------------------------------------------------------------

## v0.4.0 - External FFmpeg and Release Preparation

### Changed

-   Removed bundled FFmpeg / FFprobe npm dependencies
-   Uses `FFMPEG_PATH` / `FFPROBE_PATH` when configured, otherwise
    resolves `ffmpeg` / `ffprobe` from `PATH`
-   Keeps the application usable when FFmpeg / FFprobe are unavailable;
    video-thumbnail generation is disabled in that case
-   Updated Electron to 44.4.3 and sharp to 0.35.4
-   Changed official releases to source-only distribution; prebuilt
    executables and NSIS installers are not distributed by the project
-   Retained `npm run dist` for developers who want to create local
    Windows packages

### Fixed

-   Included application icon assets in packaged builds and configured
    the Windows package icon explicitly

### Verification

-   Verified development startup with `npm start` without FFmpeg /
    FFprobe installed
-   Verified normal image browsing and video playback without FFmpeg /
    FFprobe installed
-   Verified graceful failure of video-thumbnail generation when FFmpeg
    / FFprobe are unavailable
-   Verified `npm run dist` and the unpacked Windows application with
    Electron 44.4.3 and sharp 0.35.4
-   Verified the custom application icon in the packaged application
-   Verified `npm audit` reports 0 vulnerabilities after dependency
    updates

------------------------------------------------------------------------

# v0.3

## v0.3.4 - Video Audio Preference Persistence

### Changed

-   Persisted video preview volume across application restarts
-   Persisted video preview mute state across application restarts

### Verification

-   Verified volume changes persist across media switches
-   Verified volume and mute state are restored after restarting the
    application

------------------------------------------------------------------------

## v0.3.2 - Network Resilience and Video Seeking

### Added

-   Added a DevTools keyboard shortcut for development and
    troubleshooting

### Fixed

-   Improved error handling for unavailable or disconnected UNC shares
-   Prevented duplicate error dialogs for unavailable network shares
-   Restored video seeking by using direct file URLs for local video
    playback
-   Closed the image viewer when leaving fullscreen mode

### Verification

-   Verified UNC disconnect and recovery handling
-   Verified local video playback and seeking
-   Verified image-viewer behavior when fullscreen mode exits

------------------------------------------------------------------------

## v0.3.1 - UNC Path Registration

### Added

-   Added registration and direct navigation for Windows UNC paths
-   Automatically registers a UNC share root when opened from the
    address bar
-   Persists registered UNC share roots across application restarts

### Changed

-   Preserved video preview volume and mute state while switching
    between videos during the same application session

### Verification

-   Verified UNC registration, direct navigation, and persistence across
    restart
-   Verified browsing images and videos from registered UNC shares
-   Verified video volume and mute state are preserved when switching
    media

------------------------------------------------------------------------

## v0.3.0 - Storage Provider Foundation

### Added

-   Added a local storage provider abstraction for drive, directory, and
    media-file enumeration
-   Added a storage boundary that future network-drive support can build
    on without changing the renderer-facing IPC contract

### Changed

-   Moved existing local filesystem enumeration out of the Electron
    main-process orchestration code and into `LocalStorageProvider`
-   Preserved the existing renderer, preload, IPC channel names, media
    URLs, and local browsing behavior

### Verification

-   Verified local drive enumeration and multi-level folder-tree
    expansion
-   Verified folder expand controls continue to reflect child-directory
    availability
-   Verified image and video thumbnails
-   Verified image preview, fullscreen viewing, keyboard navigation, and
    video opening
-   Verified restoration of the last opened folder after restart while
    leaving the individual preview unrestored as designed

------------------------------------------------------------------------

# v0.2

## v0.2.2 - Usability and Documentation

### Added

-   Added `←` / `→` keyboard navigation to the fullscreen image viewer
-   Added persistent window bounds and maximized state
-   Added a custom application icon
-   Added restoration of the last opened folder on startup
-   Added root project documentation

### Changed

-   Restores the last normal window bounds instead of reopening the
    application minimized
-   Restores the folder tree, selected folder, and media list for the
    previously opened folder
-   Falls back to the normal initial state when the remembered folder no
    longer exists or cannot be restored

### Fixed

-   Terminates active FFmpeg / FFprobe child processes when the
    application exits
-   Prevents child media-processing processes from remaining after
    normal application shutdown

### Verification

-   Verified image viewer keyboard navigation
-   Verified window size and maximized-state restoration
-   Verified application exit without orphan Electron / FFmpeg / FFprobe
    processes
-   Verified the custom application icon in the running application
-   Verified restoration of a previously opened nested folder and its
    media list

------------------------------------------------------------------------

## v0.2.1 - Folder Tree Accuracy

### Fixed

-   Fixed folder-tree expand controls appearing on folders that do not
    actually contain subfolders
-   Added bounded child-directory probing so folder expandability
    reflects the real directory structure
-   Kept inaccessible folders expandable so normal access errors can
    still be surfaced when opened

------------------------------------------------------------------------

## v0.2.0 - Media Browser Thumbnails

### Added

-   Added thumbnails to the media-file list
-   Added representative video thumbnails generated from sampled video
    frames
-   Added video-duration probing with FFprobe
-   Added temporary thumbnail caching
-   Added folder icons and folder expand/collapse behavior

### Changed

-   Reworked the media browser layout to make thumbnails the primary
    file-list visual
-   Video thumbnail extraction now samples actual video frames instead
    of relying on attached cover artwork

### Fixed

-   Fixed detached lazy-loaded image thumbnails that could remain
    unloaded indefinitely
-   Fixed representative-frame selection and media-list thumbnail
    rendering issues found during the initial v0.2.0 implementation

------------------------------------------------------------------------

# v0.1

## v0.1.1 - Image Preview Interaction

### Changed

-   Changed image preview opening to a single-click interaction

### Fixed

-   Fixed image preview interaction conflicts caused by the earlier
    double-click implementation
-   Preserved video double-click behavior for opening videos in the OS
    default application

------------------------------------------------------------------------

## v0.1.0 - Video Thumbnail Seeking

### Fixed

-   Fixed video thumbnail seeking so requested timestamps are used for
    frame extraction
-   Improved FFmpeg thumbnail extraction accuracy for video previews
-   Excluded attached cover artwork from the selected video stream when
    extracting frames
