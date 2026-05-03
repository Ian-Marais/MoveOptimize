# MoveOptimize

MoveOptimize is a local-first Roselt.js single-page app for photographing moving boxes, grouping them into categories, and finding packed items faster after a move.

## Features

- Responsive organizer for phones, tablets, laptops, and desktop displays.
- Thin blue insertion lines under boxes and category labels for adding new boxes or categories in place.
- Category visibility toggle that stays available while scrolling.
- Editable categories with collapse controls and a deletion overlay for moving or deleting contained boxes.
- Box cards with a carton placeholder, camera capture, gallery selection, and photo clearing controls.
- Multi-select box highlighting with floating delete and cancel actions.
- Long-press drag support for moving selected boxes and reordering categories with confirmation before changes are committed.
- IndexedDB persistence for categories, boxes, ordering, collapsed states, and image blobs.
- PWA manifest and service worker for install-ready, offline-friendly app shell behavior.

## Setup

```bash
npm install
npm run vendor
npm start
```

The dev server runs on `http://127.0.0.1:5173` by default.

## Storage

All organizer data is stored locally in the browser with IndexedDB. Photos are saved as local image blobs, so no account, network service, or cloud backend is required for the first version.

## Packaging Notes

This project is prepared as a static SPA/PWA so it can later be wrapped with mobile and desktop packaging tools such as Capacitor, Tauri, or Electron. Native Android, iOS, macOS, Windows, and Linux packaging scaffolds are intentionally not included yet.

## Tech Stack

- Roselt.js
- HTML
- CSS
- JavaScript
- Bootstrap Icons
