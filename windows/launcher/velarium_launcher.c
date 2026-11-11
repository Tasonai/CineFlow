#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <objbase.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <wchar.h>
#include <stdlib.h>

#define VELARIUM_PORT 8765
#define VELARIUM_URL  L"http://127.0.0.1:8765"
#define VELARIUM_WND_CLASS L"VelariumDesktopWindow"
#define VELARIUM_STREAM_WND_CLASS L"VelariumStreamWindow"
#define VELARIUM_DEFAULT_TITLE L"Velarium \x2014 \x0415\x0434\x0438\x043d\x044b\x0439 \x043a\x0438\x043d\x043e\x0442\x0435\x0430\x0442\x0440"
#define IDR_WEBVIEW2_LOADER 201

/* ============================================================================
 * Minimal Self-Contained Microsoft Edge WebView2 COM C Definitions
 * Matches official WebView2.h ABI vtable layout for x64 Windows.
 * ============================================================================ */

typedef struct EventRegistrationToken {
    __int64 value;
} EventRegistrationToken;

typedef struct COREWEBVIEW2_COLOR {
    BYTE A;
    BYTE R;
    BYTE G;
    BYTE B;
} COREWEBVIEW2_COLOR;

typedef enum COREWEBVIEW2_KEY_EVENT_KIND {
    COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN = 0,
    COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP = 1,
    COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN = 2,
    COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_UP = 3
} COREWEBVIEW2_KEY_EVENT_KIND;

typedef interface ICoreWebView2Environment ICoreWebView2Environment;
typedef interface ICoreWebView2Controller ICoreWebView2Controller;
typedef interface ICoreWebView2Controller2 ICoreWebView2Controller2;
typedef interface ICoreWebView2 ICoreWebView2;
typedef interface ICoreWebView2Settings ICoreWebView2Settings;
typedef interface ICoreWebView2AcceleratorKeyPressedEventArgs ICoreWebView2AcceleratorKeyPressedEventArgs;
typedef interface ICoreWebView2NewWindowRequestedEventArgs ICoreWebView2NewWindowRequestedEventArgs;
typedef interface ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler;
typedef interface ICoreWebView2CreateCoreWebView2ControllerCompletedHandler ICoreWebView2CreateCoreWebView2ControllerCompletedHandler;
typedef interface ICoreWebView2AcceleratorKeyPressedEventHandler ICoreWebView2AcceleratorKeyPressedEventHandler;
typedef interface ICoreWebView2ContainsFullScreenElementChangedEventHandler ICoreWebView2ContainsFullScreenElementChangedEventHandler;
typedef interface ICoreWebView2DocumentTitleChangedEventHandler ICoreWebView2DocumentTitleChangedEventHandler;
typedef interface ICoreWebView2NewWindowRequestedEventHandler ICoreWebView2NewWindowRequestedEventHandler;
typedef interface ICoreWebView2WindowCloseRequestedEventHandler ICoreWebView2WindowCloseRequestedEventHandler;

static const IID IID_IUnknown_Local = {
    0x00000000, 0x0000, 0x0000, { 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46 }
};

static const IID IID_ICoreWebView2Controller2_Local = {
    0xc979903e, 0xd4ca, 0x4228, { 0x92, 0xeb, 0x47, 0xee, 0x3f, 0xa9, 0x6e, 0xab }
};

typedef struct ICoreWebView2AcceleratorKeyPressedEventArgsVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2AcceleratorKeyPressedEventArgs *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2AcceleratorKeyPressedEventArgs *This);
    HRESULT (STDMETHODCALLTYPE *get_KeyEventKind)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, COREWEBVIEW2_KEY_EVENT_KIND *keyEventKind);
    HRESULT (STDMETHODCALLTYPE *get_VirtualKey)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, UINT *virtualKey);
    HRESULT (STDMETHODCALLTYPE *get_KeyEventLParam)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, INT *lParam);
    void   *get_PhysicalKeyStatus;
    HRESULT (STDMETHODCALLTYPE *get_Handled)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, BOOL *handled);
    HRESULT (STDMETHODCALLTYPE *put_Handled)(ICoreWebView2AcceleratorKeyPressedEventArgs *This, BOOL handled);
} ICoreWebView2AcceleratorKeyPressedEventArgsVtbl;

struct ICoreWebView2AcceleratorKeyPressedEventArgs {
    const ICoreWebView2AcceleratorKeyPressedEventArgsVtbl *lpVtbl;
};

typedef struct ICoreWebView2NewWindowRequestedEventArgsVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2NewWindowRequestedEventArgs *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2NewWindowRequestedEventArgs *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2NewWindowRequestedEventArgs *This);
    HRESULT (STDMETHODCALLTYPE *get_Uri)(ICoreWebView2NewWindowRequestedEventArgs *This, LPWSTR *uri);
    HRESULT (STDMETHODCALLTYPE *put_NewWindow)(ICoreWebView2NewWindowRequestedEventArgs *This, ICoreWebView2 *newWindow);
    HRESULT (STDMETHODCALLTYPE *get_NewWindow)(ICoreWebView2NewWindowRequestedEventArgs *This, ICoreWebView2 **newWindow);
    HRESULT (STDMETHODCALLTYPE *put_Handled)(ICoreWebView2NewWindowRequestedEventArgs *This, BOOL handled);
    HRESULT (STDMETHODCALLTYPE *get_Handled)(ICoreWebView2NewWindowRequestedEventArgs *This, BOOL *handled);
    HRESULT (STDMETHODCALLTYPE *get_IsUserInitiated)(ICoreWebView2NewWindowRequestedEventArgs *This, BOOL *isUserInitiated);
    void   *GetDeferral;
    void   *get_WindowFeatures;
} ICoreWebView2NewWindowRequestedEventArgsVtbl;

struct ICoreWebView2NewWindowRequestedEventArgs {
    const ICoreWebView2NewWindowRequestedEventArgsVtbl *lpVtbl;
};

typedef struct ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT errorCode, ICoreWebView2Environment *result);
} ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl;

struct ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
    const ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT errorCode, ICoreWebView2Controller *result);
} ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl;

struct ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
    const ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2AcceleratorKeyPressedEventHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2AcceleratorKeyPressedEventHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2AcceleratorKeyPressedEventHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2AcceleratorKeyPressedEventHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2AcceleratorKeyPressedEventHandler *This, ICoreWebView2Controller *sender, ICoreWebView2AcceleratorKeyPressedEventArgs *args);
} ICoreWebView2AcceleratorKeyPressedEventHandlerVtbl;

struct ICoreWebView2AcceleratorKeyPressedEventHandler {
    const ICoreWebView2AcceleratorKeyPressedEventHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2ContainsFullScreenElementChangedEventHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *This, ICoreWebView2 *sender, IUnknown *args);
} ICoreWebView2ContainsFullScreenElementChangedEventHandlerVtbl;

struct ICoreWebView2ContainsFullScreenElementChangedEventHandler {
    const ICoreWebView2ContainsFullScreenElementChangedEventHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2DocumentTitleChangedEventHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2DocumentTitleChangedEventHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2DocumentTitleChangedEventHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2DocumentTitleChangedEventHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2DocumentTitleChangedEventHandler *This, ICoreWebView2 *sender, IUnknown *args);
} ICoreWebView2DocumentTitleChangedEventHandlerVtbl;

struct ICoreWebView2DocumentTitleChangedEventHandler {
    const ICoreWebView2DocumentTitleChangedEventHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2NewWindowRequestedEventHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2NewWindowRequestedEventHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2NewWindowRequestedEventHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2NewWindowRequestedEventHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2NewWindowRequestedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args);
} ICoreWebView2NewWindowRequestedEventHandlerVtbl;

struct ICoreWebView2NewWindowRequestedEventHandler {
    const ICoreWebView2NewWindowRequestedEventHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2WindowCloseRequestedEventHandlerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2WindowCloseRequestedEventHandler *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2WindowCloseRequestedEventHandler *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2WindowCloseRequestedEventHandler *This);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ICoreWebView2WindowCloseRequestedEventHandler *This, ICoreWebView2 *sender, IUnknown *args);
} ICoreWebView2WindowCloseRequestedEventHandlerVtbl;

struct ICoreWebView2WindowCloseRequestedEventHandler {
    const ICoreWebView2WindowCloseRequestedEventHandlerVtbl *lpVtbl;
};

typedef struct ICoreWebView2EnvironmentVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Environment *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Environment *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Environment *This);
    HRESULT (STDMETHODCALLTYPE *CreateCoreWebView2Controller)(ICoreWebView2Environment *This, HWND parentWindow, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *handler);
    void   *CreateWebResourceResponse;
    void   *get_BrowserVersionString;
    void   *add_NewBrowserVersionAvailable;
    void   *remove_NewBrowserVersionAvailable;
} ICoreWebView2EnvironmentVtbl;

struct ICoreWebView2Environment {
    const ICoreWebView2EnvironmentVtbl *lpVtbl;
};

typedef struct ICoreWebView2ControllerVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Controller *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Controller *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Controller *This);
    HRESULT (STDMETHODCALLTYPE *get_IsVisible)(ICoreWebView2Controller *This, BOOL *isVisible);
    HRESULT (STDMETHODCALLTYPE *put_IsVisible)(ICoreWebView2Controller *This, BOOL isVisible);
    HRESULT (STDMETHODCALLTYPE *get_Bounds)(ICoreWebView2Controller *This, RECT *bounds);
    HRESULT (STDMETHODCALLTYPE *put_Bounds)(ICoreWebView2Controller *This, RECT bounds);
    void   *get_ZoomFactor;
    void   *put_ZoomFactor;
    void   *add_ZoomFactorChanged;
    void   *remove_ZoomFactorChanged;
    void   *SetBoundsAndZoomFactor;
    void   *MoveFocus;
    void   *add_MoveFocusRequested;
    void   *remove_MoveFocusRequested;
    void   *add_GotFocus;
    void   *remove_GotFocus;
    void   *add_LostFocus;
    void   *remove_LostFocus;
    HRESULT (STDMETHODCALLTYPE *add_AcceleratorKeyPressed)(ICoreWebView2Controller *This, ICoreWebView2AcceleratorKeyPressedEventHandler *eventHandler, EventRegistrationToken *token);
    HRESULT (STDMETHODCALLTYPE *remove_AcceleratorKeyPressed)(ICoreWebView2Controller *This, EventRegistrationToken token);
    void   *get_ParentWindow;
    void   *put_ParentWindow;
    HRESULT (STDMETHODCALLTYPE *NotifyParentWindowPositionChanged)(ICoreWebView2Controller *This);
    HRESULT (STDMETHODCALLTYPE *Close)(ICoreWebView2Controller *This);
    HRESULT (STDMETHODCALLTYPE *get_CoreWebView2)(ICoreWebView2Controller *This, ICoreWebView2 **coreWebView2);
} ICoreWebView2ControllerVtbl;

struct ICoreWebView2Controller {
    const ICoreWebView2ControllerVtbl *lpVtbl;
};

typedef struct ICoreWebView2Controller2Vtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Controller2 *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Controller2 *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Controller2 *This);
    void   *get_IsVisible;
    void   *put_IsVisible;
    void   *get_Bounds;
    void   *put_Bounds;
    void   *get_ZoomFactor;
    void   *put_ZoomFactor;
    void   *add_ZoomFactorChanged;
    void   *remove_ZoomFactorChanged;
    void   *SetBoundsAndZoomFactor;
    void   *MoveFocus;
    void   *add_MoveFocusRequested;
    void   *remove_MoveFocusRequested;
    void   *add_GotFocus;
    void   *remove_GotFocus;
    void   *add_LostFocus;
    void   *remove_LostFocus;
    void   *add_AcceleratorKeyPressed;
    void   *remove_AcceleratorKeyPressed;
    void   *get_ParentWindow;
    void   *put_ParentWindow;
    void   *NotifyParentWindowPositionChanged;
    void   *Close;
    void   *get_CoreWebView2;
    HRESULT (STDMETHODCALLTYPE *get_DefaultBackgroundColor)(ICoreWebView2Controller2 *This, COREWEBVIEW2_COLOR *backgroundColor);
    HRESULT (STDMETHODCALLTYPE *put_DefaultBackgroundColor)(ICoreWebView2Controller2 *This, COREWEBVIEW2_COLOR backgroundColor);
} ICoreWebView2Controller2Vtbl;

struct ICoreWebView2Controller2 {
    const ICoreWebView2Controller2Vtbl *lpVtbl;
};

typedef struct ICoreWebView2SettingsVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Settings *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Settings *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Settings *This);
    HRESULT (STDMETHODCALLTYPE *get_IsScriptEnabled)(ICoreWebView2Settings *This, BOOL *isScriptEnabled);
    HRESULT (STDMETHODCALLTYPE *put_IsScriptEnabled)(ICoreWebView2Settings *This, BOOL isScriptEnabled);
    HRESULT (STDMETHODCALLTYPE *get_IsWebMessageEnabled)(ICoreWebView2Settings *This, BOOL *isWebMessageEnabled);
    HRESULT (STDMETHODCALLTYPE *put_IsWebMessageEnabled)(ICoreWebView2Settings *This, BOOL isWebMessageEnabled);
    HRESULT (STDMETHODCALLTYPE *get_AreDefaultScriptDialogsEnabled)(ICoreWebView2Settings *This, BOOL *areDefaultScriptDialogsEnabled);
    HRESULT (STDMETHODCALLTYPE *put_AreDefaultScriptDialogsEnabled)(ICoreWebView2Settings *This, BOOL areDefaultScriptDialogsEnabled);
    HRESULT (STDMETHODCALLTYPE *get_IsStatusBarEnabled)(ICoreWebView2Settings *This, BOOL *isStatusBarEnabled);
    HRESULT (STDMETHODCALLTYPE *put_IsStatusBarEnabled)(ICoreWebView2Settings *This, BOOL isStatusBarEnabled);
    HRESULT (STDMETHODCALLTYPE *get_AreDevToolsEnabled)(ICoreWebView2Settings *This, BOOL *areDevToolsEnabled);
    HRESULT (STDMETHODCALLTYPE *put_AreDevToolsEnabled)(ICoreWebView2Settings *This, BOOL areDevToolsEnabled);
    HRESULT (STDMETHODCALLTYPE *get_AreDefaultContextMenusEnabled)(ICoreWebView2Settings *This, BOOL *enabled);
    HRESULT (STDMETHODCALLTYPE *put_AreDefaultContextMenusEnabled)(ICoreWebView2Settings *This, BOOL enabled);
    HRESULT (STDMETHODCALLTYPE *get_AreHostObjectsAllowed)(ICoreWebView2Settings *This, BOOL *allowed);
    HRESULT (STDMETHODCALLTYPE *put_AreHostObjectsAllowed)(ICoreWebView2Settings *This, BOOL allowed);
    HRESULT (STDMETHODCALLTYPE *get_IsZoomControlEnabled)(ICoreWebView2Settings *This, BOOL *enabled);
    HRESULT (STDMETHODCALLTYPE *put_IsZoomControlEnabled)(ICoreWebView2Settings *This, BOOL enabled);
    HRESULT (STDMETHODCALLTYPE *get_IsBuiltInErrorPageEnabled)(ICoreWebView2Settings *This, BOOL *enabled);
    HRESULT (STDMETHODCALLTYPE *put_IsBuiltInErrorPageEnabled)(ICoreWebView2Settings *This, BOOL enabled);
} ICoreWebView2SettingsVtbl;

struct ICoreWebView2Settings {
    const ICoreWebView2SettingsVtbl *lpVtbl;
};

typedef struct ICoreWebView2Vtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2 *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2 *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2 *This);
    HRESULT (STDMETHODCALLTYPE *get_Settings)(ICoreWebView2 *This, ICoreWebView2Settings **settings);
    HRESULT (STDMETHODCALLTYPE *get_Source)(ICoreWebView2 *This, LPWSTR *uri);
    HRESULT (STDMETHODCALLTYPE *Navigate)(ICoreWebView2 *This, LPCWSTR uri);
    void   *NavigateToString;
    void   *add_NavigationStarting;
    void   *remove_NavigationStarting;
    void   *add_ContentLoading;
    void   *remove_ContentLoading;
    void   *add_SourceChanged;
    void   *remove_SourceChanged;
    void   *add_HistoryChanged;
    void   *remove_HistoryChanged;
    void   *add_NavigationCompleted;
    void   *remove_NavigationCompleted;
    void   *add_FrameNavigationStarting;
    void   *remove_FrameNavigationStarting;
    void   *add_FrameNavigationCompleted;
    void   *remove_FrameNavigationCompleted;
    void   *add_ScriptDialogOpening;
    void   *remove_ScriptDialogOpening;
    void   *add_PermissionRequested;
    void   *remove_PermissionRequested;
    void   *add_ProcessFailed;
    void   *remove_ProcessFailed;
    void   *AddScriptToExecuteOnDocumentCreated;
    void   *RemoveScriptToExecuteOnDocumentCreated;
    HRESULT (STDMETHODCALLTYPE *ExecuteScript)(ICoreWebView2 *This, LPCWSTR javaScript, void *handler);
    void   *CapturePreview;
    void   *Reload;
    void   *PostWebMessageAsJson;
    void   *PostWebMessageAsString;
    void   *add_WebMessageReceived;
    void   *remove_WebMessageReceived;
    void   *CallDevToolsProtocolMethod;
    void   *get_BrowserProcessId;
    void   *get_CanGoBack;
    void   *get_CanGoForward;
    void   *GoBack;
    void   *GoForward;
    void   *GetDevToolsProtocolEventReceiver;
    void   *Stop;
    HRESULT (STDMETHODCALLTYPE *add_NewWindowRequested)(ICoreWebView2 *This, ICoreWebView2NewWindowRequestedEventHandler *eventHandler, EventRegistrationToken *token);
    HRESULT (STDMETHODCALLTYPE *remove_NewWindowRequested)(ICoreWebView2 *This, EventRegistrationToken token);
    HRESULT (STDMETHODCALLTYPE *add_DocumentTitleChanged)(ICoreWebView2 *This, ICoreWebView2DocumentTitleChangedEventHandler *eventHandler, EventRegistrationToken *token);
    HRESULT (STDMETHODCALLTYPE *remove_DocumentTitleChanged)(ICoreWebView2 *This, EventRegistrationToken token);
    HRESULT (STDMETHODCALLTYPE *get_DocumentTitle)(ICoreWebView2 *This, LPWSTR *title);
    void   *AddHostObjectToScript;
    void   *RemoveHostObjectFromScript;
    void   *OpenDevToolsWindow;
    HRESULT (STDMETHODCALLTYPE *add_ContainsFullScreenElementChanged)(ICoreWebView2 *This, ICoreWebView2ContainsFullScreenElementChangedEventHandler *eventHandler, EventRegistrationToken *token);
    HRESULT (STDMETHODCALLTYPE *remove_ContainsFullScreenElementChanged)(ICoreWebView2 *This, EventRegistrationToken token);
    HRESULT (STDMETHODCALLTYPE *get_ContainsFullScreenElement)(ICoreWebView2 *This, BOOL *containsFullScreenElement);
    void   *add_WebResourceRequested;
    void   *remove_WebResourceRequested;
    void   *AddWebResourceRequestedFilter;
    void   *RemoveWebResourceRequestedFilter;
    HRESULT (STDMETHODCALLTYPE *add_WindowCloseRequested)(ICoreWebView2 *This, ICoreWebView2WindowCloseRequestedEventHandler *eventHandler, EventRegistrationToken *token);
    HRESULT (STDMETHODCALLTYPE *remove_WindowCloseRequested)(ICoreWebView2 *This, EventRegistrationToken token);
} ICoreWebView2Vtbl;

struct ICoreWebView2 {
    const ICoreWebView2Vtbl *lpVtbl;
};

typedef HRESULT (STDAPICALLTYPE *PFN_CreateCoreWebView2EnvironmentWithOptions)(
    PCWSTR browserExecutableFolder,
    PCWSTR userDataFolder,
    void *environmentOptions,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *environmentCreatedHandler
);

/* ============================================================================
 * File & Process Helpers
 * ============================================================================ */

static int file_exists_w(const wchar_t *path) {
    DWORD attr = GetFileAttributesW(path);
    return (attr != INVALID_FILE_ATTRIBUTES) && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static void get_app_directory(wchar_t *out_dir, size_t cap) {
    DWORD len = GetModuleFileNameW(NULL, out_dir, (DWORD)cap);
    if (len == 0 || len >= cap) {
        out_dir[0] = L'.';
        out_dir[1] = L'\0';
        return;
    }
    wchar_t *slash = wcsrchr(out_dir, L'\\');
    if (slash) {
        *slash = L'\0';
    }
}

static void prepend_bin_to_path(const wchar_t *app_dir) {
    wchar_t bin_dir[MAX_PATH * 2];
    _snwprintf(bin_dir, MAX_PATH * 2 - 1, L"%s\\backend\\bin", app_dir);
    bin_dir[MAX_PATH * 2 - 1] = L'\0';

    DWORD cur_len = GetEnvironmentVariableW(L"PATH", NULL, 0);
    size_t total = wcslen(bin_dir) + 2 + (size_t)cur_len + 4;
    wchar_t *buf = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, total * sizeof(wchar_t));
    if (!buf) {
        return;
    }
    wcscpy(buf, bin_dir);
    if (cur_len > 0) {
        wcscat(buf, L";");
        GetEnvironmentVariableW(L"PATH", buf + wcslen(buf), cur_len + 1);
    }
    SetEnvironmentVariableW(L"PATH", buf);
    HeapFree(GetProcessHeap(), 0, buf);
}

static int is_server_port_open(unsigned short port) {
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        return 0;
    }
    u_long nonblock = 1;
    ioctlsocket(sock, FIONBIO, &nonblock);

    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    int rc = connect(sock, (struct sockaddr *)&addr, sizeof(addr));
    int alive = 0;
    if (rc == 0) {
        alive = 1;
    } else if (WSAGetLastError() == WSAEWOULDBLOCK) {
        fd_set wfds;
        FD_ZERO(&wfds);
        FD_SET(sock, &wfds);
        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 80000;
        if (select(0, NULL, &wfds, NULL, &tv) > 0) {
            int so_err = 0;
            int optlen = sizeof(so_err);
            if (getsockopt(sock, SOL_SOCKET, SO_ERROR, (char *)&so_err, &optlen) == 0 && so_err == 0) {
                alive = 1;
            }
        }
    }
    closesocket(sock);
    return alive;
}

static BOOL CALLBACK close_legacy_velarium_windows_cb(HWND hwnd, LPARAM lParam) {
    int close_native = (int)lParam;
    wchar_t cls[128];
    cls[0] = L'\0';
    GetClassNameW(hwnd, cls, 127);

    if (close_native && (wcscmp(cls, VELARIUM_WND_CLASS) == 0 || wcscmp(cls, VELARIUM_STREAM_WND_CLASS) == 0)) {
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
        return TRUE;
    }
    if (wcsncmp(cls, L"Chrome_WidgetWin_", 17) == 0) {
        wchar_t title[256];
        title[0] = L'\0';
        if (GetWindowTextW(hwnd, title, 255) > 0) {
            if (wcsstr(title, L"Velarium \x2014 \x0415\x0434\x0438\x043d\x044b\x0439 \x043a\x0438\x043d\x043e\x0442\x0435\x0430\x0442\x0440") != NULL ||
                wcsstr(title, L"Velarium \x2014 Unified Cinema") != NULL) {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
        }
    }
    return TRUE;
}

static void stop_app_processes(const wchar_t *app_dir) {
    EnumWindows(close_legacy_velarium_windows_cb, 1);

    /* Wait up to ~800ms for native WebView2 windows to process WM_CLOSE -> WM_DESTROY -> g_controller->Close() */
    for (int w = 0; w < 20; w++) {
        if (!FindWindowW(VELARIUM_WND_CLASS, NULL) && !FindWindowW(VELARIUM_STREAM_WND_CLASS, NULL)) {
            break;
        }
        Sleep(40);
    }

    wchar_t prefix[MAX_PATH * 2];
    _snwprintf(prefix, MAX_PATH * 2 - 1, L"%s\\", app_dir);
    prefix[MAX_PATH * 2 - 1] = L'\0';
    size_t prefix_len = wcslen(prefix);
    if (prefix_len < 4) {
        return;
    }

    DWORD self_pid = GetCurrentProcessId();
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) {
        return;
    }

    PROCESSENTRY32W pe;
    ZeroMemory(&pe, sizeof(pe));
    pe.dwSize = sizeof(pe);

    if (Process32FirstW(snap, &pe)) {
        do {
            if (pe.th32ProcessID == 0 || pe.th32ProcessID == self_pid) {
                continue;
            }
            HANDLE hQuery = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
            if (!hQuery) {
                continue;
            }
            wchar_t img_path[MAX_PATH * 2];
            DWORD img_len = MAX_PATH * 2;
            int matched = 0;
            if (QueryFullProcessImageNameW(hQuery, 0, img_path, &img_len)) {
                if (_wcsnicmp(img_path, prefix, prefix_len) == 0) {
                    matched = 1;
                }
            }
            CloseHandle(hQuery);
            if (matched) {
                HANDLE hTerm = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pe.th32ProcessID);
                if (hTerm) {
                    TerminateProcess(hTerm, 0);
                    WaitForSingleObject(hTerm, 1500);
                    CloseHandle(hTerm);
                }
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
}

static int start_backend_hidden(const wchar_t *app_dir) {
    wchar_t data_dir[MAX_PATH * 2];
    _snwprintf(data_dir, MAX_PATH * 2 - 1, L"%s\\data", app_dir);
    data_dir[MAX_PATH * 2 - 1] = L'\0';
    CreateDirectoryW(data_dir, NULL);

    wchar_t server_py[MAX_PATH * 2];
    _snwprintf(server_py, MAX_PATH * 2 - 1, L"%s\\server.py", app_dir);
    server_py[MAX_PATH * 2 - 1] = L'\0';
    if (!file_exists_w(server_py)) {
        return 0;
    }

    wchar_t py_exe[MAX_PATH * 2];
    _snwprintf(py_exe, MAX_PATH * 2 - 1, L"%s\\runtime\\pythonw.exe", app_dir);
    py_exe[MAX_PATH * 2 - 1] = L'\0';
    if (!file_exists_w(py_exe)) {
        _snwprintf(py_exe, MAX_PATH * 2 - 1, L"%s\\runtime\\python.exe", app_dir);
        py_exe[MAX_PATH * 2 - 1] = L'\0';
        if (!file_exists_w(py_exe)) {
            wcscpy(py_exe, L"pythonw.exe");
        }
    }

    SECURITY_ATTRIBUTES sa;
    ZeroMemory(&sa, sizeof(sa));
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    wchar_t log_path[MAX_PATH * 2];
    _snwprintf(log_path, MAX_PATH * 2 - 1, L"%s\\velarium.log", data_dir);
    log_path[MAX_PATH * 2 - 1] = L'\0';
    HANDLE hLog = CreateFileW(
        log_path,
        FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        &sa,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );

    SetEnvironmentVariableW(L"PYTHONUTF8", L"1");
    SetEnvironmentVariableW(L"PYTHONIOENCODING", L"utf-8");

    wchar_t cmd_line[MAX_PATH * 5];
    _snwprintf(cmd_line, MAX_PATH * 5 - 1, L"\"%s\" -X utf8 \"%s\" --launchd", py_exe, server_py);
    cmd_line[MAX_PATH * 5 - 1] = L'\0';

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    if (hLog != INVALID_HANDLE_VALUE) {
        si.dwFlags |= STARTF_USESTDHANDLES;
        si.hStdOutput = hLog;
        si.hStdError = hLog;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    }

    BOOL ok = CreateProcessW(
        NULL,
        cmd_line,
        NULL,
        NULL,
        (hLog != INVALID_HANDLE_VALUE) ? TRUE : FALSE,
        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
        NULL,
        app_dir,
        &si,
        &pi
    );

    if (hLog != INVALID_HANDLE_VALUE) {
        CloseHandle(hLog);
    }
    if (!ok) {
        return 0;
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 1;
}

static int query_app_path_reg(HKEY root, const wchar_t *exe_name, wchar_t *out_path, DWORD out_cap) {
    wchar_t subkey[256];
    _snwprintf(subkey, 255, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\%s", exe_name);
    subkey[255] = L'\0';
    HKEY hKey = NULL;
    if (RegOpenKeyExW(root, subkey, 0, KEY_READ, &hKey) != ERROR_SUCCESS) {
        return 0;
    }
    DWORD bytes = out_cap * sizeof(wchar_t);
    DWORD type = 0;
    LONG rc = RegQueryValueExW(hKey, NULL, NULL, &type, (LPBYTE)out_path, &bytes);
    RegCloseKey(hKey);
    if (rc == ERROR_SUCCESS && (type == REG_SZ || type == REG_EXPAND_SZ) && file_exists_w(out_path)) {
        return 1;
    }
    return 0;
}

static int find_chromium_browser(wchar_t *out_exe, DWORD cap) {
    if (query_app_path_reg(HKEY_LOCAL_MACHINE, L"msedge.exe", out_exe, cap) ||
        query_app_path_reg(HKEY_CURRENT_USER, L"msedge.exe", out_exe, cap)) {
        return 1;
    }

    const wchar_t *env_vars[] = { L"ProgramFiles(x86)", L"ProgramFiles", L"LOCALAPPDATA" };
    const wchar_t *rel_paths[] = {
        L"Microsoft\\Edge\\Application\\msedge.exe",
        L"Google\\Chrome\\Application\\chrome.exe",
        L"BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        L"Vivaldi\\Application\\vivaldi.exe"
    };
    for (int r = 0; r < 4; r++) {
        for (int e = 0; e < 3; e++) {
            wchar_t base[MAX_PATH];
            if (GetEnvironmentVariableW(env_vars[e], base, MAX_PATH) > 0) {
                _snwprintf(out_exe, cap - 1, L"%s\\%s", base, rel_paths[r]);
                out_exe[cap - 1] = L'\0';
                if (file_exists_w(out_exe)) {
                    return 1;
                }
            }
        }
    }

    const wchar_t *reg_exes[] = { L"chrome.exe", L"brave.exe", L"vivaldi.exe" };
    for (int k = 0; k < 3; k++) {
        if (query_app_path_reg(HKEY_LOCAL_MACHINE, reg_exes[k], out_exe, cap) ||
            query_app_path_reg(HKEY_CURRENT_USER, reg_exes[k], out_exe, cap)) {
            return 1;
        }
    }
    return 0;
}

static void compute_adaptive_window_bounds(int *out_w, int *out_h, int *out_x, int *out_y) {
    RECT work_rc;
    ZeroMemory(&work_rc, sizeof(work_rc));
    if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &work_rc, 0)) {
        work_rc.left = 0;
        work_rc.top = 0;
        work_rc.right = GetSystemMetrics(SM_CXSCREEN);
        work_rc.bottom = GetSystemMetrics(SM_CYSCREEN);
    }
    int work_w = (int)(work_rc.right - work_rc.left);
    int work_h = (int)(work_rc.bottom - work_rc.top);
    if (work_w < 800) work_w = 1280;
    if (work_h < 600) work_h = 760;

    int win_w = work_w - 56;
    if (win_w > 1400) win_w = 1400;
    if (win_w < 960 && work_w >= 980) win_w = 960;
    if (win_w > work_w) win_w = work_w;

    int win_h = work_h - 44;
    if (win_h > 860) win_h = 860;
    if (win_h < 640 && work_h >= 660) win_h = 640;
    if (win_h > work_h) win_h = work_h;

    *out_w = win_w;
    *out_h = win_h;
    *out_x = (int)work_rc.left + (work_w - win_w) / 2;
    *out_y = (int)work_rc.top + (work_h - win_h) / 2;
}

/* ============================================================================
 * Native Win32 + Microsoft Edge WebView2 Host Window
 * Provides a single standard Win32 titlebar (100% compatible with Windhawk
 * Caption Buttons Customizer and Windows 10/11 Dark Mode) with zero browser
 * chrome or duplicate --app titlebars.
 * ============================================================================ */

static HWND g_main_hwnd = NULL;
static HWND g_webview_host_hwnd = NULL;
static ICoreWebView2Controller *g_controller = NULL;
static ICoreWebView2 *g_webview = NULL;
static int g_webview_init_failed = 0;
static int g_is_fullscreen = 0;
static int g_is_stream_window = 0;
static WPARAM g_nc_pressed_ht = 0;
static LONG_PTR g_saved_style = 0;
static LONG_PTR g_saved_ex_style = 0;
static WINDOWPLACEMENT g_saved_placement = { sizeof(WINDOWPLACEMENT) };
static wchar_t g_target_url[2048] = VELARIUM_URL;

typedef BOOL (WINAPI *PFN_DwmDefWindowProc)(HWND, UINT, WPARAM, LPARAM, LRESULT *);
static PFN_DwmDefWindowProc g_pDwmDefWindowProc = NULL;
static int g_dwm_proc_resolved = 0;

static BOOL call_dwm_def_window_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, LRESULT *plResult) {
    if (!g_dwm_proc_resolved) {
        g_dwm_proc_resolved = 1;
        HMODULE hDwm = GetModuleHandleW(L"dwmapi.dll");
        if (!hDwm) {
            hDwm = LoadLibraryW(L"dwmapi.dll");
        }
        if (hDwm) {
            g_pDwmDefWindowProc = (PFN_DwmDefWindowProc)GetProcAddress(hDwm, "DwmDefWindowProc");
        }
    }
    if (g_pDwmDefWindowProc) {
        return g_pDwmDefWindowProc(hwnd, msg, wParam, lParam, plResult);
    }
    return FALSE;
}

static void apply_dark_titlebar(HWND hwnd) {
    HMODULE hDwm = LoadLibraryW(L"dwmapi.dll");
    if (!hDwm) {
        return;
    }
    typedef HRESULT (WINAPI *PFN_DwmSetWindowAttribute)(HWND, DWORD, LPCVOID, DWORD);
    PFN_DwmSetWindowAttribute pDwmSetWindowAttribute =
        (PFN_DwmSetWindowAttribute)GetProcAddress(hDwm, "DwmSetWindowAttribute");
    if (pDwmSetWindowAttribute) {
        BOOL dark = TRUE;
        /* DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (and 19 for older Win10 builds) */
        pDwmSetWindowAttribute(hwnd, 20, &dark, sizeof(dark));
        pDwmSetWindowAttribute(hwnd, 19, &dark, sizeof(dark));
        /* DWMWA_CAPTION_COLOR = 35 -> #0a0a0c (COLORREF 0x00BBGGRR = 0x000C0A0A) */
        COLORREF caption_color = RGB(10, 10, 12);
        pDwmSetWindowAttribute(hwnd, 35, &caption_color, sizeof(caption_color));
    }
    FreeLibrary(hDwm);
}

static void sync_webview_bounds(HWND hwnd) {
    if (!hwnd) {
        return;
    }
    RECT rc;
    if (GetClientRect(hwnd, &rc)) {
        if (g_webview_host_hwnd && IsWindow(g_webview_host_hwnd)) {
            MoveWindow(g_webview_host_hwnd, 0, 0, rc.right - rc.left, rc.bottom - rc.top, TRUE);
        }
        if (g_controller) {
            RECT host_rc = { 0, 0, rc.right - rc.left, rc.bottom - rc.top };
            g_controller->lpVtbl->put_Bounds(g_controller, host_rc);
        }
    }
}

static void set_native_fullscreen(HWND hwnd, int enable) {
    if (!hwnd || g_is_fullscreen == enable) {
        return;
    }
    if (enable) {
        g_saved_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        g_saved_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        g_saved_placement.length = sizeof(WINDOWPLACEMENT);
        GetWindowPlacement(hwnd, &g_saved_placement);

        HMONITOR hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi;
        ZeroMemory(&mi, sizeof(mi));
        mi.cbSize = sizeof(mi);
        if (GetMonitorInfoW(hMon, &mi)) {
            SetWindowLongPtrW(hwnd, GWL_STYLE, (g_saved_style & ~WS_OVERLAPPEDWINDOW) | WS_POPUP | WS_VISIBLE);
            SetWindowPos(
                hwnd,
                HWND_TOP,
                mi.rcMonitor.left,
                mi.rcMonitor.top,
                mi.rcMonitor.right - mi.rcMonitor.left,
                mi.rcMonitor.bottom - mi.rcMonitor.top,
                SWP_NOOWNERZORDER | SWP_FRAMECHANGED
            );
            g_is_fullscreen = 1;
        }
    } else {
        SetWindowLongPtrW(hwnd, GWL_STYLE, g_saved_style | WS_VISIBLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, g_saved_ex_style);
        if (g_saved_placement.length == sizeof(WINDOWPLACEMENT)) {
            SetWindowPlacement(hwnd, &g_saved_placement);
        }
        SetWindowPos(
            hwnd,
            NULL,
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED
        );
        g_is_fullscreen = 0;
    }
    sync_webview_bounds(hwnd);
}

/* COM Event Handlers (Static Singletons) */

static HRESULT STDMETHODCALLTYPE Unknown_QueryInterface_Stub(void *This, REFIID riid, void **ppvObject) {
    if (!ppvObject) {
        return E_POINTER;
    }
    if (riid && IsEqualIID(riid, &IID_IUnknown)) {
        *ppvObject = This;
        return S_OK;
    }
    *ppvObject = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE Unknown_AddRef_Stub(void *This) {
    (void)This;
    return 1;
}

static ULONG STDMETHODCALLTYPE Unknown_Release_Stub(void *This) {
    (void)This;
    return 1;
}

static HRESULT STDMETHODCALLTYPE AcceleratorKeyPressed_Invoke(
    ICoreWebView2AcceleratorKeyPressedEventHandler *This,
    ICoreWebView2Controller *sender,
    ICoreWebView2AcceleratorKeyPressedEventArgs *args
) {
    (void)This;
    (void)sender;
    if (!args || !g_main_hwnd) {
        return S_OK;
    }
    COREWEBVIEW2_KEY_EVENT_KIND kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
    UINT vkey = 0;
    if (FAILED(args->lpVtbl->get_KeyEventKind(args, &kind)) ||
        FAILED(args->lpVtbl->get_VirtualKey(args, &vkey))) {
        return S_OK;
    }
    if (kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) {
        if (vkey == VK_F11) {
            args->lpVtbl->put_Handled(args, TRUE);
            if (g_is_fullscreen) {
                if (g_webview) {
                    BOOL dom_fs = FALSE;
                    if (SUCCEEDED(g_webview->lpVtbl->get_ContainsFullScreenElement(g_webview, &dom_fs)) && dom_fs) {
                        g_webview->lpVtbl->ExecuteScript(
                            g_webview,
                            L"if(document.fullscreenElement){document.exitFullscreen().catch(function(){});}",
                            NULL
                        );
                    }
                }
                set_native_fullscreen(g_main_hwnd, 0);
            } else {
                set_native_fullscreen(g_main_hwnd, 1);
            }
            return S_OK;
        }
        if (vkey == VK_ESCAPE && g_is_fullscreen) {
            BOOL dom_fs = FALSE;
            if (g_webview) {
                g_webview->lpVtbl->get_ContainsFullScreenElement(g_webview, &dom_fs);
            }
            if (!dom_fs) {
                args->lpVtbl->put_Handled(args, TRUE);
                set_native_fullscreen(g_main_hwnd, 0);
            }
        }
    }
    return S_OK;
}

static const ICoreWebView2AcceleratorKeyPressedEventHandlerVtbl g_accel_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2AcceleratorKeyPressedEventHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2AcceleratorKeyPressedEventHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2AcceleratorKeyPressedEventHandler *))Unknown_Release_Stub,
    AcceleratorKeyPressed_Invoke
};
static ICoreWebView2AcceleratorKeyPressedEventHandler g_accel_handler = { &g_accel_vtbl };

static HRESULT STDMETHODCALLTYPE NewWindowRequested_Invoke(
    ICoreWebView2NewWindowRequestedEventHandler *This,
    ICoreWebView2 *sender,
    ICoreWebView2NewWindowRequestedEventArgs *args
) {
    (void)This;
    if (!args) {
        return S_OK;
    }
    LPWSTR uri = NULL;
    if (SUCCEEDED(args->lpVtbl->get_Uri(args, &uri)) && uri) {
        if (wcsncmp(uri, L"https://", 8) == 0 || wcsncmp(uri, L"http://", 7) == 0) {
            args->lpVtbl->put_Handled(args, TRUE);
            if (g_is_stream_window && sender) {
                sender->lpVtbl->Navigate(sender, uri);
            } else {
                ShellExecuteW(NULL, L"open", uri, NULL, NULL, SW_SHOWNORMAL);
            }
        }
        CoTaskMemFree(uri);
    }
    return S_OK;
}

static const ICoreWebView2NewWindowRequestedEventHandlerVtbl g_new_window_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2NewWindowRequestedEventHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2NewWindowRequestedEventHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2NewWindowRequestedEventHandler *))Unknown_Release_Stub,
    NewWindowRequested_Invoke
};
static ICoreWebView2NewWindowRequestedEventHandler g_new_window_handler = { &g_new_window_vtbl };

static HRESULT STDMETHODCALLTYPE FullScreenChanged_Invoke(
    ICoreWebView2ContainsFullScreenElementChangedEventHandler *This,
    ICoreWebView2 *sender,
    IUnknown *args
) {
    (void)This;
    (void)args;
    if (sender && g_main_hwnd) {
        BOOL fs = FALSE;
        if (SUCCEEDED(sender->lpVtbl->get_ContainsFullScreenElement(sender, &fs))) {
            set_native_fullscreen(g_main_hwnd, fs ? 1 : 0);
        }
    }
    return S_OK;
}

static const ICoreWebView2ContainsFullScreenElementChangedEventHandlerVtbl g_fullscreen_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2ContainsFullScreenElementChangedEventHandler *))Unknown_Release_Stub,
    FullScreenChanged_Invoke
};
static ICoreWebView2ContainsFullScreenElementChangedEventHandler g_fullscreen_handler = { &g_fullscreen_vtbl };

static HRESULT STDMETHODCALLTYPE TitleChanged_Invoke(
    ICoreWebView2DocumentTitleChangedEventHandler *This,
    ICoreWebView2 *sender,
    IUnknown *args
) {
    (void)This;
    (void)args;
    if (sender && g_main_hwnd) {
        LPWSTR title = NULL;
        if (SUCCEEDED(sender->lpVtbl->get_DocumentTitle(sender, &title)) && title) {
            if (title[0] != L'\0') {
                SetWindowTextW(g_main_hwnd, title);
            }
            CoTaskMemFree(title);
        }
    }
    return S_OK;
}

static const ICoreWebView2DocumentTitleChangedEventHandlerVtbl g_title_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2DocumentTitleChangedEventHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2DocumentTitleChangedEventHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2DocumentTitleChangedEventHandler *))Unknown_Release_Stub,
    TitleChanged_Invoke
};
static ICoreWebView2DocumentTitleChangedEventHandler g_title_handler = { &g_title_vtbl };

static HRESULT STDMETHODCALLTYPE WindowCloseRequested_Invoke(
    ICoreWebView2WindowCloseRequestedEventHandler *This,
    ICoreWebView2 *sender,
    IUnknown *args
) {
    (void)This;
    (void)sender;
    (void)args;
    if (g_main_hwnd) {
        PostMessageW(g_main_hwnd, WM_CLOSE, 0, 0);
    }
    return S_OK;
}

static const ICoreWebView2WindowCloseRequestedEventHandlerVtbl g_close_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2WindowCloseRequestedEventHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2WindowCloseRequestedEventHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2WindowCloseRequestedEventHandler *))Unknown_Release_Stub,
    WindowCloseRequested_Invoke
};
static ICoreWebView2WindowCloseRequestedEventHandler g_close_handler = { &g_close_vtbl };

static HRESULT STDMETHODCALLTYPE ControllerCompleted_Invoke(
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This,
    HRESULT errorCode,
    ICoreWebView2Controller *controller
) {
    (void)This;
    if (FAILED(errorCode) || !controller || !g_main_hwnd) {
        g_webview_init_failed = 1;
        if (g_main_hwnd) {
            PostMessageW(g_main_hwnd, WM_CLOSE, 0, 0);
        }
        return S_OK;
    }

    g_controller = controller;
    g_controller->lpVtbl->AddRef(g_controller);

    /* Set matte-dark #0a0a0c background on ICoreWebView2Controller2 so resize/startup never flashes white */
    ICoreWebView2Controller2 *ctrl2 = NULL;
    if (SUCCEEDED(g_controller->lpVtbl->QueryInterface(g_controller, &IID_ICoreWebView2Controller2_Local, (void **)&ctrl2)) && ctrl2) {
        COREWEBVIEW2_COLOR dark_bg = { 255, 10, 10, 12 };
        ctrl2->lpVtbl->put_DefaultBackgroundColor(ctrl2, dark_bg);
        ctrl2->lpVtbl->Release(ctrl2);
    }

    EventRegistrationToken tok_accel = { 0 };
    g_controller->lpVtbl->add_AcceleratorKeyPressed(g_controller, &g_accel_handler, &tok_accel);

    if (SUCCEEDED(g_controller->lpVtbl->get_CoreWebView2(g_controller, &g_webview)) && g_webview) {
        ICoreWebView2Settings *settings = NULL;
        if (SUCCEEDED(g_webview->lpVtbl->get_Settings(g_webview, &settings)) && settings) {
            settings->lpVtbl->put_IsScriptEnabled(settings, TRUE);
            settings->lpVtbl->put_IsWebMessageEnabled(settings, g_is_stream_window ? FALSE : TRUE);
            settings->lpVtbl->put_AreHostObjectsAllowed(settings, FALSE);
            settings->lpVtbl->put_AreDefaultScriptDialogsEnabled(settings, TRUE);
            settings->lpVtbl->put_IsStatusBarEnabled(settings, FALSE);
            settings->lpVtbl->Release(settings);
        }

        EventRegistrationToken tok_fs = { 0 };
        EventRegistrationToken tok_title = { 0 };
        EventRegistrationToken tok_newwin = { 0 };
        EventRegistrationToken tok_close = { 0 };
        g_webview->lpVtbl->add_ContainsFullScreenElementChanged(g_webview, &g_fullscreen_handler, &tok_fs);
        g_webview->lpVtbl->add_DocumentTitleChanged(g_webview, &g_title_handler, &tok_title);
        g_webview->lpVtbl->add_NewWindowRequested(g_webview, &g_new_window_handler, &tok_newwin);
        g_webview->lpVtbl->add_WindowCloseRequested(g_webview, &g_close_handler, &tok_close);

        sync_webview_bounds(g_main_hwnd);
        g_controller->lpVtbl->put_IsVisible(g_controller, TRUE);
        g_webview->lpVtbl->Navigate(g_webview, g_target_url);
    } else {
        g_webview_init_failed = 1;
        PostMessageW(g_main_hwnd, WM_CLOSE, 0, 0);
    }
    return S_OK;
}

static const ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl g_controller_completed_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *))Unknown_Release_Stub,
    ControllerCompleted_Invoke
};
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandler g_controller_completed_handler = { &g_controller_completed_vtbl };

static HRESULT STDMETHODCALLTYPE EnvironmentCompleted_Invoke(
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This,
    HRESULT errorCode,
    ICoreWebView2Environment *env
) {
    (void)This;
    if (FAILED(errorCode) || !env || !g_main_hwnd) {
        g_webview_init_failed = 1;
        if (g_main_hwnd) {
            PostMessageW(g_main_hwnd, WM_CLOSE, 0, 0);
        }
        return S_OK;
    }
    HWND host_hwnd = (g_webview_host_hwnd && IsWindow(g_webview_host_hwnd)) ? g_webview_host_hwnd : g_main_hwnd;
    HRESULT hr = env->lpVtbl->CreateCoreWebView2Controller(env, host_hwnd, &g_controller_completed_handler);
    if (FAILED(hr) && host_hwnd != g_main_hwnd) {
        hr = env->lpVtbl->CreateCoreWebView2Controller(env, g_main_hwnd, &g_controller_completed_handler);
    }
    if (FAILED(hr)) {
        g_webview_init_failed = 1;
        PostMessageW(g_main_hwnd, WM_CLOSE, 0, 0);
    }
    return S_OK;
}

static const ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl g_env_completed_vtbl = {
    (HRESULT (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *, REFIID, void **))Unknown_QueryInterface_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *))Unknown_AddRef_Stub,
    (ULONG (STDMETHODCALLTYPE *)(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *))Unknown_Release_Stub,
    EnvironmentCompleted_Invoke
};
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler g_env_completed_handler = { &g_env_completed_vtbl };

static int extract_embedded_resource_dll(const wchar_t *dest_path) {
    HRSRC hRes = FindResourceW(NULL, MAKEINTRESOURCEW(IDR_WEBVIEW2_LOADER), RT_RCDATA);
    if (!hRes) {
        return 0;
    }
    HGLOBAL hData = LoadResource(NULL, hRes);
    if (!hData) {
        return 0;
    }
    DWORD sz = SizeofResource(NULL, hRes);
    const void *ptr = LockResource(hData);
    if (!ptr || sz < 1024) {
        return 0;
    }
    HANDLE hFile = CreateFileW(dest_path, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        return 0;
    }
    DWORD written = 0;
    BOOL ok = WriteFile(hFile, ptr, sz, &written, NULL);
    CloseHandle(hFile);
    return (ok && written == sz) ? 1 : 0;
}

static HMODULE load_webview2_loader_dll(const wchar_t *app_dir) {
    wchar_t dll_path[MAX_PATH * 2];
    _snwprintf(dll_path, MAX_PATH * 2 - 1, L"%s\\WebView2Loader.dll", app_dir);
    dll_path[MAX_PATH * 2 - 1] = L'\0';

    if (!file_exists_w(dll_path)) {
        extract_embedded_resource_dll(dll_path);
    }
    HMODULE hMod = LoadLibraryW(dll_path);
    if (hMod) {
        return hMod;
    }

    wchar_t local_app[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", local_app, MAX_PATH) > 0) {
        wchar_t user_root[MAX_PATH * 2];
        _snwprintf(user_root, MAX_PATH * 2 - 1, L"%s\\Velarium", local_app);
        user_root[MAX_PATH * 2 - 1] = L'\0';
        CreateDirectoryW(user_root, NULL);
        _snwprintf(dll_path, MAX_PATH * 2 - 1, L"%s\\WebView2Loader.dll", user_root);
        dll_path[MAX_PATH * 2 - 1] = L'\0';
        if (!file_exists_w(dll_path)) {
            extract_embedded_resource_dll(dll_path);
        }
        hMod = LoadLibraryW(dll_path);
        if (hMod) {
            return hMod;
        }
    }
    return LoadLibraryW(L"WebView2Loader.dll");
}

static LRESULT CALLBACK VelariumWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    LRESULT dwm_result = 0;
    if (call_dwm_def_window_proc(hwnd, msg, wParam, lParam, &dwm_result)) {
        return dwm_result;
    }

    switch (msg) {
        case WM_NCLBUTTONDOWN:
            if (wParam == HTMINBUTTON || wParam == HTMAXBUTTON || wParam == HTCLOSE) {
                g_nc_pressed_ht = wParam;
            } else {
                g_nc_pressed_ht = 0;
            }
            break;

        case WM_NCLBUTTONUP:
            if (wParam == HTMINBUTTON || wParam == HTMAXBUTTON || wParam == HTCLOSE) {
                g_nc_pressed_ht = 0;
                if (wParam == HTMINBUTTON) {
                    PostMessageW(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, lParam);
                    return 0;
                }
                if (wParam == HTMAXBUTTON) {
                    PostMessageW(hwnd, WM_SYSCOMMAND, IsZoomed(hwnd) ? SC_RESTORE : SC_MAXIMIZE, lParam);
                    return 0;
                }
                if (wParam == HTCLOSE) {
                    PostMessageW(hwnd, WM_SYSCOMMAND, SC_CLOSE, lParam);
                    return 0;
                }
            }
            g_nc_pressed_ht = 0;
            break;

        case WM_SIZE:
            sync_webview_bounds(hwnd);
            return 0;

        case WM_MOVE:
        case WM_MOVING:
            if (g_controller) {
                g_controller->lpVtbl->NotifyParentWindowPositionChanged(g_controller);
            }
            break;

        case WM_DPICHANGED: {
            const RECT *suggested = (const RECT *)lParam;
            if (suggested && !g_is_fullscreen) {
                SetWindowPos(
                    hwnd,
                    NULL,
                    suggested->left,
                    suggested->top,
                    suggested->right - suggested->left,
                    suggested->bottom - suggested->top,
                    SWP_NOZORDER | SWP_NOACTIVATE
                );
            }
            sync_webview_bounds(hwnd);
            return 0;
        }

        case WM_GETMINMAXINFO: {
            MINMAXINFO *mmi = (MINMAXINFO *)lParam;
            if (mmi) {
                mmi->ptMinTrackSize.x = 640;
                mmi->ptMinTrackSize.y = 420;
            }
            return 0;
        }

        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
            if (wParam == VK_F11) {
                set_native_fullscreen(hwnd, g_is_fullscreen ? 0 : 1);
                return 0;
            }
            break;

        case WM_ACTIVATE:
            if (LOWORD(wParam) != WA_INACTIVE && g_controller) {
                g_controller->lpVtbl->put_IsVisible(g_controller, TRUE);
            }
            break;

        case WM_DESTROY:
            if (g_controller) {
                g_controller->lpVtbl->Close(g_controller);
                if (g_webview) {
                    g_webview->lpVtbl->Release(g_webview);
                    g_webview = NULL;
                }
                g_controller->lpVtbl->Release(g_controller);
                g_controller = NULL;
            } else if (g_webview) {
                g_webview->lpVtbl->Release(g_webview);
                g_webview = NULL;
            }
            g_webview_host_hwnd = NULL;
            g_main_hwnd = NULL;
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static int run_native_webview2_window(
    HINSTANCE hInstance,
    const wchar_t *app_dir,
    const wchar_t *url,
    const wchar_t *wnd_class_name,
    int custom_bounds,
    int in_x,
    int in_y,
    int in_w,
    int in_h
) {
    HMODULE hLoader = load_webview2_loader_dll(app_dir);
    if (!hLoader) {
        return 0;
    }
    PFN_CreateCoreWebView2EnvironmentWithOptions pCreateEnv =
        (PFN_CreateCoreWebView2EnvironmentWithOptions)GetProcAddress(hLoader, "CreateCoreWebView2EnvironmentWithOptions");
    if (!pCreateEnv) {
        FreeLibrary(hLoader);
        return 0;
    }

    HRESULT hrCo = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    (void)hrCo;

    SetEnvironmentVariableW(
        L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        L"--enable-gpu-rasterization --enable-oop-rasterization --ignore-gpu-blocklist "
        L"--enable-features=CanvasOopRasterization,D3D11VideoDecoder,DirectComposition "
        L"--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "
        L"--disable-features=CalculateNativeWinOcclusion,Translate --no-first-run --no-default-browser-check "
        L"--proxy-bypass-list=<-loopback> --disable-extensions --disable-component-update --disable-sync "
        L"--disable-default-apps --disable-domain-reliability --disk-cache-size=268435456 "
        L"--autoplay-policy=no-user-gesture-required"
    );

    wcsncpy(g_target_url, url ? url : VELARIUM_URL, 2047);
    g_target_url[2047] = L'\0';
    g_webview_init_failed = 0;
    g_is_stream_window = (wcscmp(wnd_class_name, VELARIUM_STREAM_WND_CLASS) == 0) ? 1 : 0;

    int win_w = 1280, win_h = 780, win_x = 60, win_y = 30;
    if (custom_bounds && in_w >= 320 && in_h >= 240) {
        win_x = in_x;
        win_y = in_y;
        win_w = in_w;
        win_h = in_h;
    } else {
        compute_adaptive_window_bounds(&win_w, &win_h, &win_x, &win_y);
    }

    HBRUSH hDarkBrush = CreateSolidBrush(RGB(10, 10, 12));
    HICON hAppIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(1));

    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = VelariumWndProc;
    wc.hInstance = hInstance;
    wc.hIcon = hAppIcon;
    wc.hIconSm = hAppIcon;
    wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
    wc.hbrBackground = hDarkBrush;
    wc.lpszClassName = wnd_class_name;
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(
        0,
        wnd_class_name,
        VELARIUM_DEFAULT_TITLE,
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        win_x,
        win_y,
        win_w,
        win_h,
        NULL,
        NULL,
        hInstance,
        NULL
    );
    if (!hwnd) {
        UnregisterClassW(wnd_class_name, hInstance);
        DeleteObject(hDarkBrush);
        CoUninitialize();
        FreeLibrary(hLoader);
        return 0;
    }

    g_main_hwnd = hwnd;
    RECT init_rc = { 0, 0, win_w, win_h };
    GetClientRect(hwnd, &init_rc);
    g_webview_host_hwnd = CreateWindowExW(
        0,
        L"STATIC",
        L"",
        WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        0,
        0,
        init_rc.right - init_rc.left,
        init_rc.bottom - init_rc.top,
        hwnd,
        NULL,
        hInstance,
        NULL
    );
    apply_dark_titlebar(hwnd);
    ShowWindow(hwnd, SW_SHOWNORMAL);
    UpdateWindow(hwnd);

    const wchar_t *profile_sub = g_is_stream_window ? L"StreamEmbedProfile" : L"WebView2Profile";
    wchar_t profile_root[MAX_PATH * 2];
    wchar_t profile_dir[MAX_PATH * 2];
    wchar_t local_app[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", local_app, MAX_PATH) > 0) {
        _snwprintf(profile_root, MAX_PATH * 2 - 1, L"%s\\Velarium", local_app);
        profile_root[MAX_PATH * 2 - 1] = L'\0';
        CreateDirectoryW(profile_root, NULL);
        _snwprintf(profile_dir, MAX_PATH * 2 - 1, L"%s\\%s", profile_root, profile_sub);
        profile_dir[MAX_PATH * 2 - 1] = L'\0';
        CreateDirectoryW(profile_dir, NULL);
    } else {
        _snwprintf(profile_dir, MAX_PATH * 2 - 1, L"%s\\data\\%s", app_dir, profile_sub);
        profile_dir[MAX_PATH * 2 - 1] = L'\0';
        CreateDirectoryW(profile_dir, NULL);
    }

    HRESULT hr = pCreateEnv(NULL, profile_dir, NULL, &g_env_completed_handler);
    if (FAILED(hr)) {
        DestroyWindow(hwnd);
        UnregisterClassW(wnd_class_name, hInstance);
        DeleteObject(hDarkBrush);
        CoUninitialize();
        FreeLibrary(hLoader);
        return 0;
    }

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    UnregisterClassW(wnd_class_name, hInstance);
    DeleteObject(hDarkBrush);
    CoUninitialize();
    FreeLibrary(hLoader);

    return g_webview_init_failed ? 0 : 1;
}

static int is_safe_browser_url_w(const wchar_t *u) {
    if (!u || !u[0]) {
        return 0;
    }
    if (_wcsnicmp(u, L"https://", 8) != 0 && _wcsnicmp(u, L"http://", 7) != 0) {
        return 0;
    }
    for (const wchar_t *p = u; *p; ++p) {
        if (*p <= 0x20 || *p == L'"') {
            return 0;
        }
    }
    return 1;
}

static void open_velarium_window_fallback(const wchar_t *app_dir, const wchar_t *target_url) {
    const wchar_t *url = (target_url && is_safe_browser_url_w(target_url)) ? target_url : VELARIUM_URL;
    wchar_t browser_exe[MAX_PATH * 2];
    if (find_chromium_browser(browser_exe, MAX_PATH * 2)) {
        int win_w = 1280, win_h = 780, win_x = 60, win_y = 30;
        compute_adaptive_window_bounds(&win_w, &win_h, &win_x, &win_y);
        wchar_t profile_root[MAX_PATH * 2];
        wchar_t profile_dir[MAX_PATH * 2];
        wchar_t local_app[MAX_PATH];
        if (GetEnvironmentVariableW(L"LOCALAPPDATA", local_app, MAX_PATH) > 0) {
            _snwprintf(profile_root, MAX_PATH * 2 - 1, L"%s\\Velarium", local_app);
            profile_root[MAX_PATH * 2 - 1] = L'\0';
            CreateDirectoryW(profile_root, NULL);
            _snwprintf(profile_dir, MAX_PATH * 2 - 1, L"%s\\AppWindowProfile", profile_root);
            profile_dir[MAX_PATH * 2 - 1] = L'\0';
            CreateDirectoryW(profile_dir, NULL);
        } else {
            _snwprintf(profile_dir, MAX_PATH * 2 - 1, L"%s\\data\\AppWindowProfile", app_dir);
            profile_dir[MAX_PATH * 2 - 1] = L'\0';
            CreateDirectoryW(profile_dir, NULL);
        }
        wchar_t cmd[MAX_PATH * 6];
        _snwprintf(
            cmd,
            MAX_PATH * 6 - 1,
            L"\"%s\" --app=%s --user-data-dir=\"%s\" --window-size=%d,%d --window-position=%d,%d "
            L"--enable-gpu-rasterization --enable-oop-rasterization --ignore-gpu-blocklist "
            L"--enable-features=CanvasOopRasterization,D3D11VideoDecoder,DirectComposition "
            L"--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "
            L"--disable-features=CalculateNativeWinOcclusion,Translate --no-first-run --no-default-browser-check "
            L"--proxy-bypass-list=<-loopback> --disable-extensions --disable-component-update --disable-sync "
            L"--disable-default-apps --disable-domain-reliability --disk-cache-size=268435456 "
            L"--autoplay-policy=no-user-gesture-required",
            browser_exe,
            url,
            profile_dir,
            win_w,
            win_h,
            win_x,
            win_y
        );
        cmd[MAX_PATH * 6 - 1] = L'\0';

        STARTUPINFOW si;
        PROCESS_INFORMATION pi;
        ZeroMemory(&si, sizeof(si));
        ZeroMemory(&pi, sizeof(pi));
        si.cb = sizeof(si);
        if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, app_dir, &si, &pi)) {
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            return;
        }
    }
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    (void)hPrevInstance;
    (void)nCmdShow;

    wchar_t app_dir[MAX_PATH * 2];
    get_app_directory(app_dir, MAX_PATH * 2);
    SetCurrentDirectoryW(app_dir);

    const wchar_t *full_cmd = GetCommandLineW();
    if ((lpCmdLine && wcsstr(lpCmdLine, L"--stop") != NULL) ||
        (full_cmd && wcsstr(full_cmd, L"--stop") != NULL)) {
        stop_app_processes(app_dir);
        return 0;
    }

    /* Dedicated native WebView2 window mode for embedded official streaming services (--stream-window) */
    if ((lpCmdLine && wcsstr(lpCmdLine, L"--stream-window") != NULL) ||
        (full_cmd && wcsstr(full_cmd, L"--stream-window") != NULL)) {
        int argc = 0;
        LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        const wchar_t *stream_url = NULL;
        int sx = 140, sy = 120, sw = 1120, sh = 630;
        int has_bounds = 0;
        if (argv) {
            for (int i = 1; i < argc; i++) {
                if (wcscmp(argv[i], L"--stream-window") == 0 && i + 1 < argc) {
                    stream_url = argv[i + 1];
                    if (i + 5 < argc) {
                        sx = _wtoi(argv[i + 2]);
                        sy = _wtoi(argv[i + 3]);
                        sw = _wtoi(argv[i + 4]);
                        sh = _wtoi(argv[i + 5]);
                        has_bounds = 1;
                    }
                    break;
                }
            }
        }
        if (stream_url && _wcsnicmp(stream_url, L"https://", 8) == 0 && is_safe_browser_url_w(stream_url)) {
            if (!run_native_webview2_window(hInstance, app_dir, stream_url, VELARIUM_STREAM_WND_CLASS, has_bounds, sx, sy, sw, sh)) {
                open_velarium_window_fallback(app_dir, stream_url);
            }
        }
        if (argv) {
            LocalFree(argv);
        }
        return 0;
    }

    int background_only = (
        (lpCmdLine && wcsstr(lpCmdLine, L"--background") != NULL) ||
        (full_cmd && wcsstr(full_cmd, L"--background") != NULL)
    ) ? 1 : 0;

    if (!background_only) {
        /* Close any legacy Chromium --app window left over from older versions */
        EnumWindows(close_legacy_velarium_windows_cb, 0);

        /* Activate existing native Velarium window if already running */
        HWND existing = FindWindowW(VELARIUM_WND_CLASS, NULL);
        if (existing && IsWindow(existing)) {
            if (IsIconic(existing)) {
                ShowWindow(existing, SW_RESTORE);
            } else {
                ShowWindow(existing, SW_SHOW);
            }
            SetForegroundWindow(existing);
            return 0;
        }
    }

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    prepend_bin_to_path(app_dir);

    if (!is_server_port_open(VELARIUM_PORT)) {
        HANDLE hStartMutex = CreateMutexW(NULL, FALSE, L"Local\\AtomaVelariumServerStartMutex");
        if (hStartMutex) {
            WaitForSingleObject(hStartMutex, 8000);
        }
        if (!is_server_port_open(VELARIUM_PORT)) {
            if (start_backend_hidden(app_dir)) {
                for (int i = 0; i < 400; i++) {
                    if (is_server_port_open(VELARIUM_PORT)) {
                        break;
                    }
                    Sleep(15);
                }
            } else if (!background_only) {
                MessageBoxW(
                    NULL,
                    L"\x041d\x0435 \x0443\x0434\x0430\x043b\x043e\x0441\x044c \x0437\x0430\x043f\x0443\x0441\x0442\x0438\x0442\x044c \x043b\x043e\x043a\x0430\x043b\x044c\x043d\x044b\x0439 \x0441\x0435\x0440\x0432\x0435\x0440 Velarium.\n\x041f\x0440\x043e\x0432\x0435\x0440\x044c\x0442\x0435 \x0446\x0435\x043b\x043e\x0441\x0442\x043d\x043e\x0441\x0442\x044c \x0444\x0430\x0439\x043b\x043e\x0432 \x0443\x0441\x0442\x0430\x043d\x043e\x0432\x043a\x0438 \x0438\x043b\x0438 \x043f\x0435\x0440\x0435\x0443\x0441\x0442\x0430\x043d\x043e\x0432\x0438\x0442\x0435 Velarium 2.7.13.\n\nFailed to start the local Velarium server.\nPlease verify the installation files or reinstall Velarium 2.7.13.",
                    L"Velarium 2.7.13 \x2014 Atoma",
                    MB_ICONERROR | MB_OK
                );
                if (hStartMutex) {
                    ReleaseMutex(hStartMutex);
                    CloseHandle(hStartMutex);
                }
                WSACleanup();
                return 1;
            }
        }
        if (hStartMutex) {
            ReleaseMutex(hStartMutex);
            CloseHandle(hStartMutex);
        }
    }

    WSACleanup();

    if (!background_only) {
        if (!run_native_webview2_window(hInstance, app_dir, VELARIUM_URL, VELARIUM_WND_CLASS, 0, 0, 0, 0, 0)) {
            open_velarium_window_fallback(app_dir, VELARIUM_URL);
        }
    }

    return 0;
}
