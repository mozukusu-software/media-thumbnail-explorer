# Media Thumbnail Explorer Changelog

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
