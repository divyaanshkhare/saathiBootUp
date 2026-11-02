# SAATHI — Screen-aware digital navigation assistant

A hackathon-ready prototype for helping people navigate unfamiliar apps and websites. It has two modes:

1. **Live screen guidance** — share an app/browser window or upload a screenshot. With an OpenAI API key configured on the server, SAATHI analyzes the screenshot and explains the next safe action in plain English, Hindi or Bengali.
2. **Guided practice demo** — an interactive mock train-ticket journey that works without an API key. It demonstrates step-by-step guidance, highlighted controls, validation, and a fake final confirmation. It does not book a real ticket or charge money.

## Requirements

- Node.js 18.17 or newer (Node 20 LTS recommended).
- An OpenAI API key for live AI screen understanding. The practice demo works without one.
- A modern browser. Screen sharing works on `localhost` or HTTPS and requires the user to explicitly choose a window, tab or screen.

## Run locally

```bash
cd saathi-prototype
```

Set your API key as an environment variable. **Do not put it in `public/app.js` or commit it to Git.**

macOS / Linux:

```bash
export OPENAI_API_KEY="your_api_key_here"
export OPENAI_MODEL="gpt-5.4-mini"   # optional
npm start
```

Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
$env:OPENAI_MODEL="gpt-5.4-mini"   # optional
npm start
```

Open **http://localhost:3000**.

No `npm install` is needed; the server uses Node's built-in HTTP module and `fetch`.

## How to use

1. Click **Share a screen** and choose the app window, browser tab or entire screen you want help with. Alternatively, upload a screenshot.
2. Describe your goal, for example: “Help me book a train ticket” or “What does this button do?”.
3. Choose English, Hindi or Bengali.
4. Click **Guide me** or **Explain this screen**. After following the advice, use the follow-up box and share a fresh screen frame/screenshot so SAATHI can adapt to the new page.
5. To test without a key, select **Try a guided train-ticket demo**.

## What this prototype can and cannot do

- It can capture a user-selected screen/window/tab, analyze a screenshot via a vision model, and produce contextual next-step guidance.
- It does not silently inspect other apps. Browser screen capture is permission-based and may be stopped by the user or browser.
- A normal website cannot freely click or control arbitrary desktop/mobile apps because of browser security boundaries. This prototype guides the user; the user performs the clicks.
- The ticket workflow is a simulation with invented sample data. It does not connect to IRCTC or issue tickets.
- Do not upload screenshots containing passwords, OTPs, UPI PINs, full card details, or other sensitive information. The backend forwards the screenshot to the configured AI provider for analysis.
- The model can misread a screen. Users should verify money, recipient, dates and irreversible actions on the official app/site before proceeding.

## Project structure

```text
saathi-prototype/
├── server.js            # Static server + secure server-side AI proxy
├── package.json
├── .env.example         # Environment variable template
├── README.md
└── public/
    ├── index.html       # App interface
    ├── styles.css       # Responsive styling
    └── app.js           # Screen capture, demo flow and UI behavior
```

## API route

`POST /api/analyze`

Example JSON body:

```json
{
  "goal": "Help me understand this page",
  "language": "Hindi",
  "imageDataUrl": "data:image/jpeg;base64,...",
  "extraContext": "I clicked Continue and this page appeared"
}
```

The server keeps the API key private and calls the OpenAI Responses API. The default model is `gpt-5.4-mini`; set `OPENAI_MODEL` to another vision-capable Responses API model available to your account if needed.
