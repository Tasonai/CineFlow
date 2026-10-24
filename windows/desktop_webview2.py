import socket
import threading
import time
import webbrowser

from server import run_server


def wait_for_port(port: int, timeout: float = 5.0):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def main():
    port = 8765
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()
    wait_for_port(port)

    url = f"http://127.0.0.1:{port}"
    try:
        import webview  # pywebview uses Microsoft Edge WebView2 on Windows 10/11

        window = webview.create_window(
            title="CineFlow — Единый Онлайн-Кинотеатр (Poland PL)",
            url=url,
            width=1440,
            height=900,
            background_color="#07080d",
            text_select=False,
        )
        webview.start(gui="edgechromium")
    except ImportError:
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
