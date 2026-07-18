# Areteus The Patch Device Web Interface

## Overview
The Areteus platform allows real-time monitoring of multi-channel ECG data from wearable chest patches.

**Core Capabilities:**
- Real-time WebSocket streaming of 10-channel ECG data
- User authentication (JWT) and device registration (MAC-based)
- Live multi-channel visualization with ECG-style grids
- 60 Hz notch filtering (client-side)
- Basic heart rate (BPM) detection
- Real-time audio playback of heart sounds
- Over-the-Air (OTA) firmware updates
- Multi-user support with device ownership

**Hybrid architecture of Two Development Tracks:**
- **Axel’s Stack**: Node.js + Express + WebSocket + SQLite — strong on real-time performance, OTA, and self-hosting.
- **Rebeca’s Stack**: Firebase/Firestore + mobile-optimized frontend + Jennifer’s cloud AI.
