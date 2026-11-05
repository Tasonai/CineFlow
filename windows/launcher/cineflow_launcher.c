#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <wchar.h>

#define CINEFLOW_PORT 8765
#define CINEFLOW_URL  L"http://127.0.0.1:8765"

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

static void stop_app_processes(const wchar_t *app_dir) {
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
            HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pe.th32ProcessID);
            if (!hProc) {
                continue;
            }
            wchar_t img_path[MAX_PATH * 2];
            DWORD img_len = MAX_PATH * 2;
            if (QueryFullProcessImageNameW(hProc, 0, img_path, &img_len)) {
                if (_wcsnicmp(img_path, prefix, prefix_len) == 0) {
                    TerminateProcess(hProc, 0);
                    WaitForSingleObject(hProc, 1500);
                }
            }
            CloseHandle(hProc);
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
    _snwprintf(log_path, MAX_PATH * 2 - 1, L"%s\\cineflow.log", data_dir);
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

static void open_cineflow_window(const wchar_t *app_dir) {
    wchar_t browser_exe[MAX_PATH * 2];
    if (find_chromium_browser(browser_exe, MAX_PATH * 2)) {
        int win_w = 1280, win_h = 780, win_x = 60, win_y = 30;
        compute_adaptive_window_bounds(&win_w, &win_h, &win_x, &win_y);
        wchar_t profile_root[MAX_PATH * 2];
        wchar_t profile_dir[MAX_PATH * 2];
        wchar_t local_app[MAX_PATH];
        if (GetEnvironmentVariableW(L"LOCALAPPDATA", local_app, MAX_PATH) > 0) {
            _snwprintf(profile_root, MAX_PATH * 2 - 1, L"%s\\CineFlow", local_app);
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
            CINEFLOW_URL,
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

        wchar_t simple_args[MAX_PATH * 4];
        _snwprintf(
            simple_args,
            MAX_PATH * 4 - 1,
            L"--app=%s --user-data-dir=\"%s\" --window-size=%d,%d --window-position=%d,%d --no-first-run --no-default-browser-check",
            CINEFLOW_URL,
            profile_dir,
            win_w,
            win_h,
            win_x,
            win_y
        );
        simple_args[MAX_PATH * 4 - 1] = L'\0';
        if ((INT_PTR)ShellExecuteW(NULL, L"open", browser_exe, simple_args, app_dir, SW_SHOWNORMAL) > 32) {
            return;
        }
    }
    if ((INT_PTR)ShellExecuteW(NULL, L"open", L"msedge.exe", L"--app=" CINEFLOW_URL, NULL, SW_SHOWNORMAL) > 32) {
        return;
    }
    ShellExecuteW(NULL, L"open", CINEFLOW_URL, NULL, NULL, SW_SHOWNORMAL);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    (void)hInstance;
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

    int background_only = (
        (lpCmdLine && wcsstr(lpCmdLine, L"--background") != NULL) ||
        (full_cmd && wcsstr(full_cmd, L"--background") != NULL)
    ) ? 1 : 0;

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    prepend_bin_to_path(app_dir);

    if (!is_server_port_open(CINEFLOW_PORT)) {
        HANDLE hStartMutex = CreateMutexW(NULL, FALSE, L"Local\\AtomaCineFlowServerStartMutex");
        if (hStartMutex) {
            WaitForSingleObject(hStartMutex, 8000);
        }
        if (!is_server_port_open(CINEFLOW_PORT)) {
            if (start_backend_hidden(app_dir)) {
                for (int i = 0; i < 400; i++) {
                    if (is_server_port_open(CINEFLOW_PORT)) {
                        break;
                    }
                    Sleep(15);
                }
            } else if (!background_only) {
                MessageBoxW(
                    NULL,
                    L"Не удалось запустить локальный сервер CineFlow.\nПроверьте целостность файлов установки или переустановите CineFlow 2.7.1.\n\nFailed to start the local CineFlow server.\nPlease verify the installation files or reinstall CineFlow 2.7.1.",
                    L"CineFlow 2.7.1 — Atoma",
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

    if (!background_only) {
        open_cineflow_window(app_dir);
    }

    WSACleanup();
    return 0;
}
