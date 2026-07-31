# Device Firmware

The ESP32 firmware that runs on the ECG patch device lives in a separate repo:

**→ [thepatch-firmware](#)** *(update this link once the repo is created)*

It's kept separate from this app repo because it's a different stack entirely (C, built with ESP-IDF, flashed onto hardware) rather than something deployed like this web app/backend.

## How it connects to this backend

The device connects to `the-patch-server` (`server.cjs`) over WebSocket, sending ECG channel readings in real time. The backend groups incoming samples by device and time window, and persists completed chunks for later processing — see the backend's own docs for details on that side.

## OTA updates

The firmware includes an over-the-air (OTA) update mechanism: the server can push a new `.bin` to a connected device over the same WebSocket connection, which the device then downloads and flashes itself. This has been validated end-to-end on test hardware — full details, exact fixes, and the test log are in `OTA_TEST_CHANGES.md` in the firmware repo.
