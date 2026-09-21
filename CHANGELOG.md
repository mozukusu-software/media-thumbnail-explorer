# Media Thumbnail Explorer Changelog

---

# v0.3

## v0.3.1 - UNC Path Registration

### Added

- Added registration and direct navigation for Windows UNC paths
- Automatically registers a UNC share root when opened from the address bar
- Persists registered UNC share roots across application restarts

### Changed

- Preserved video preview volume and mute state while switching between videos during the same application session

### Verification

- Verified UNC registration, direct navigation, and persistence across restart
- Verified browsing images and videos from registered UNC shares
- Verified video volume and mute state are preserved when switching media

---

## v0.3.0 - Storage Provider Foundation

### Added

- Added a local storage provider abstraction for drive, directory, and media-file enumeration
- Added a storage boundary that future network-drive support can build on without changing the renderer-facing IPC contract

### Changed

- Moved existing local filesystem enumeration out of the Electron main-process orchestration code and into `LocalStorageProvider`
- Preserved the existing renderer, preload, IPC channel names, media URLs, and local browsing behavior

### Verification

- Verified local drive enumeration and multi-level folder-tree expansion
- Verified folder expand controls continue to reflect child-directory availability
- Verified image and video thumbnails
- Verified image preview, fullscreen viewing, keyboard navigation, and video opening
- Verified restoration of the last opened folder after restart while leaving the individual preview unrestored as designed

---

# v0.2

## v0.2.2 - Usability and Documentation

### Added

- Added `←` / `→` keyboard navigation to the fullscreen image viewer
- Added persistent window bounds and maximized state
- Added a custom application icon
- Added restoration of the last opened folder on startup
- Added root project documentation

### Changed

- Restores the last normal window bounds instead of reopening the application minimized
- Restores the folder tree, selected folder, and media list for the previously opened folder
- Falls back to the normal initial state when the remembered folder no longer exists or cannot be restored

### Fixed

- Terminates active FFmpeg / FFprobe child processes when the application exits
- Prevents child media-processing processes from remaining after normal application shutdown

### Verification

- Verified image viewer keyboard navigation
- Verified window size and maximized-state restoration
- Verified application exit without orphan Electron / FFmpeg / FFprobe processes
- Verified the custom application icon in the running application
- Verified restoration of a previously opened nested folder and its media list

---

## v0.2.1 - Folder Tree Accuracy

### Fixed

- Fixed folder-tree expand controls appearing on folders that do not actually contain subfolders
- Added bounded child-directory probing so folder expandability reflects the real directory structure
- Kept inaccessible folders expandable so normal access errors can still be surfaced when opened

---

## v0.2.0 - Media Browser Thumbnails

### Added

- Added thumbnails to the media-file list
- Added representative video thumbnails generated from sampled video frames
- Added video-duration probing with FFprobe
- Added temporary thumbnail caching
- Added folder icons and folder expand/collapse behavior

### Changed

- Reworked the media browser layout to make thumbnails the primary file-list visual
- Video thumbnail extraction now samples actual video frames instead of relying on attached cover artwork

### Fixed

- Fixed detached lazy-loaded image thumbnails that could remain unloaded indefinitely
- Fixed representative-frame selection and media-list thumbnail rendering issues found during the initial v0.2.0 implementation

---

# v0.1

## v0.1.1 - Image Preview Interaction

### Changed

- Changed image preview opening to a single-click interaction

### Fixed

- Fixed image preview interaction conflicts caused by the earlier double-click implementation
- Preserved video double-click behavior for opening videos in the OS default application

---

## v0.1.0 - Video Thumbnail Seeking

### Fixed

- Fixed video thumbnail seeking so requested timestamps are used for frame extraction
- Improved FFmpeg thumbnail extraction accuracy for video previews
- Excluded attached cover artwork from the selected video stream when extracting frames
