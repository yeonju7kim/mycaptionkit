# My CaptionKit

**English** | [한국어](README.kr.md)

A local CaptionKit controller for live church translation. It automatically follows CaptionKit's Speaker Language and Live status, while ProPresenter can keep using the same Display URL.

## Screens

- `http://127.0.0.1:4173/control` — operator controls and two output previews
- `http://127.0.0.1:4173/display/full` — black full-screen output for a projector
- `http://127.0.0.1:4173/display/subtitle` — transparent captions over slides in ProPresenter

Full Screen and Subtitle each have independent controls for line count (1–10), font size, line spacing, and width. Position, background, and other detailed options are available per display in Settings.

When CaptionKit is not Live or no real caption has arrived yet, the Control previews repeat sample sentences to make styling easy. Sample text never appears on the actual Display URLs and is replaced automatically when real captions arrive.

## Requirements

### Required

1. **[Node.js LTS](https://nodejs.org/en/download)** — Node.js 18 or newer is required; the latest LTS release is recommended.
2. **[Google Chrome](https://www.google.com/chrome/)** — used for CaptionKit operation and microphone permissions.
3. **[CaptionKit account](https://captionkit.com/)** — CaptionKit runs in the browser and requires no separate installation. Sign in at the [CaptionKit Dashboard](https://app.captionkit.com/).
4. **Microphone** — a USB microphone or audio-interface input connected to the computer.

### Optional

- **[ProPresenter](https://renewedvision.com/propresenter/download)** — required only when placing transparent captions over slides.
- **[Git for Windows](https://git-scm.com/downloads/win)** — required only for `git clone`. You do not need Git when using the ZIP download below.

You do not need to run `npm install`. This project has no external Node.js package dependencies.

## Download and run

The easiest method is:

1. Select **[Download project ZIP](https://github.com/yeonju7kim/mycaptionkit/archive/refs/heads/main.zip)**.
2. Extract the downloaded ZIP file.
3. Double-click `start-captionkit.cmd` inside the project folder.
4. If it does not already exist, an **AI Translator** desktop shortcut is created with the app icon.
5. `http://127.0.0.1:4173/control` opens automatically in your browser.

Using Git instead:

```powershell
git clone https://github.com/yeonju7kim/mycaptionkit.git
cd mycaptionkit
.\start-captionkit.cmd
```

If the server is already running, launching `start-captionkit.cmd` again opens the existing Control page without starting a second server. To stop it, press `Ctrl+C` in the My CaptionKit terminal.

After the first run, double-click the **AI Translator** desktop shortcut to start. If you move the project folder, delete the old shortcut and run `start-captionkit.cmd` again to create one pointing to the new location.

## Initial setup

1. Sign in to the [CaptionKit Dashboard](https://app.captionkit.com/).
2. Create an API key under **Account settings → API Keys**.
3. Open **⚙ Settings** in the top-right corner of My CaptionKit Control.
4. Enter the API key and CaptionKit handle, then save. The handle is the last part of the CaptionKit URL. For example, the handle in `https://app.captionkit.com/kcic-ytpx2u` is `kcic-ytpx2u`.
5. Enable the required translation-language outputs in the CaptionKit dashboard.
6. Select **Open CaptionKit** at the top of Control to open the dashboard for the saved handle.

The default handle is currently `kcic-ytpx2u`. The default English code is `en-US`, and the Korean code is `ko`. These codes must match the translation outputs enabled in CaptionKit.

To run from a terminal:

```powershell
node server.js --open
```

## Prepare the microphone

**Settings → Microphone → Test microphone** checks for seven seconds whether the selected microphone is receiving audio on this computer. This permission applies only to the local address (`127.0.0.1`).

CaptionKit receives the audio used for the actual captions. Select **Open CaptionKit** to open the dashboard for the handle saved in Settings, then:

1. Select **Open audio permissions** in CaptionKit and allow Chrome to use the microphone.
2. Choose the microphone from the input list on the right and use **Test Inputs** to verify the level.
3. Find **Caption Controls** on the right. Select **Broadcast** first if Caption Controls is hidden.
4. Choose **Speaker Language**.
5. Press the **⚡ button** to start AI translation. The local Displays connect automatically.

Browser security prevents the local Control page from granting microphone permission to `app.captionkit.com` or passing its local microphone permission to CaptionKit.

## Connect to ProPresenter

1. Create a caption Prop in ProPresenter.
2. Add a Web Fill layer.
3. Enter this URL:

```text
http://127.0.0.1:4173/display/subtitle
```

4. Size the Web Fill to the full output, usually `1920 × 1080`.
5. Keep this Prop unchanged. Make later adjustments from Control.

To inspect the output directly, open the debug URL below in a browser. Use the normal Display URL above—not the debug URL—in ProPresenter.

```text
http://127.0.0.1:4173/display/subtitle?debug=1
```

## During a service

1. Select **Open CaptionKit** at the top of Control.
2. Find **Caption Controls** on the right. Select **Broadcast** first if Caption Controls is hidden.
3. Choose **Speaker Language**.
4. Press the **⚡ button** to start AI translation.
5. This app continuously checks the Live status and connects automatically. Korean speakers produce English captions, and English speakers produce Korean captions.

### Change Speaker Language

1. Select **Open CaptionKit**.
2. Find **Caption Controls** on the right. Select **Broadcast** if it is hidden.
3. Stop the current translation.
4. Change **Speaker Language**.
5. Press the **⚡ button** to start again.

Both outputs place each completed sentence on a new line. The legacy `/display` URL continues to behave like Subtitle.

CaptionKit translations can appear about one or two seconds after the original speech.

## Configuration and security

The API key and display settings are stored in `.captionkit.local.json` after the first save. This file and `.env` are excluded from Git. The API key is never included in the browser Display page or CaptionKit display URL.

To manage the API key through an environment variable, copy `.env.example` to `.env` and set:

```dotenv
CAPTIONKIT_API_KEY=your_api_key
```

By default, the server listens only on `127.0.0.1`, so it is accessible only from the same computer.

### Use Control from a phone or another computer

Add the following to `.env`, then restart the server:

```dotenv
HOST=0.0.0.0
PORT=4173
CONTROL_PIN=change-this-pin
```

Enter the same PIN in Control Settings. On another device, use the My CaptionKit computer's local IP address:

```text
http://192.168.x.x:4173/control
```

Windows Firewall permission may be required. Do not expose this port directly to the public internet.

## Troubleshooting

- If captions do not start, open **Caption Controls** on the right side of CaptionKit, choose Speaker Language, and press the **⚡ button**.
- For a `401` error, check the API key or Control PIN.
- If translations are empty, confirm that the required output language is enabled in the CaptionKit dashboard.
- If the ProPresenter output is blank, confirm that `start-captionkit.cmd` is running and open `/display/subtitle?debug=1` in a browser.
- CaptionKit's status API can take a moment to reflect a newly started or stopped session.

## Development check

```powershell
node --test
```

No external runtime packages are used.
