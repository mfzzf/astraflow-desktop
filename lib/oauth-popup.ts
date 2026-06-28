function writePopupShell(popup: Window) {
  try {
    popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AstraFlow Login</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f6f2;
        color: #1b1b18;
        font-family: Inter, Roboto, system-ui, sans-serif;
      }
      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 24px;
        text-align: center;
      }
      .spinner {
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        border: 2px solid rgba(27, 27, 24, 0.14);
        border-top-color: #1b1b18;
        animation: spin 0.8s linear infinite;
      }
      p {
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
        color: rgba(27, 27, 24, 0.72);
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <p>Preparing your UCloud authorization page...</p>
    </main>
  </body>
</html>`)
    popup.document.close()
  } catch {
    // Ignore popup document write failures and fall back to direct navigation.
  }
}

export function openOAuthPopupShell() {
  const popup = window.open("about:blank", "_blank", "width=540,height=720")

  if (popup) {
    writePopupShell(popup)
  }

  return popup
}

export function navigateOAuthPopup(popup: Window | null, url: string) {
  if (popup && !popup.closed) {
    popup.location.replace(url)
    return
  }

  window.open(url, "_blank", "noopener,noreferrer")
}
