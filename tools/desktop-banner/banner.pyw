# 바탕화면 상단 고정 배너 — 업무 3원칙을 하루 종일 눈앞에 둔다.
#
# 실행:   이 파일을 더블클릭  (.pyw 라 검은 콘솔 창이 뜨지 않는다)
# 끄기:   왼쪽 ⋮ 구역에서 우클릭  또는  Esc
# 숨기기: 왼쪽 ⋮ 구역에서 휠 버튼 클릭 → 10초 뒤 다시 나타남
# 흐리기: 배너 위에 마우스를 올리면 투명해지고 클릭이 아래 창으로 통과함
#
# 문구는 같은 폴더의 banner.txt 를 고치면 된다 (없으면 아래 기본값).
# 움직임·깜빡임은 바로 아래 설정에서 끄고 켤 수 있다.
import ctypes
from ctypes import wintypes
import os
import shutil
import subprocess
import sys
import tkinter as tk
from typing import Optional
from urllib.parse import parse_qs, urlparse
import winreg

# ══ 설정 ═══════════════════════════════════════════════════
SCROLL = True                 # 글자가 오른쪽 → 왼쪽으로 흐른다
SCROLL_SPEED_PX = 2           # 한 번에 움직이는 픽셀. 클수록 빠르다
SCROLL_INTERVAL_MS = 80       # 다시 그리는 간격. 작을수록 부드럽고 CPU를 더 쓴다 (80 = 초당 12번)
SCROLL_GAP_PX = 120           # 문구가 한 바퀴 돌 때 사이 여백

BLINK = True                  # 글자가 깜빡인다
BLINK_INTERVAL_MS = 700       # 깜빡이는 주기
COLOR_ON = "#FFCC00"          # 밝을 때
COLOR_OFF = "#7A6200"         # 어두울 때. "black" 으로 바꾸면 완전히 사라졌다 나타난다

BANNER_HEIGHT = 45
FONT_SIZE = 12
TOPMOST_INTERVAL_MS = 30000   # 짧게 하면 전체화면 영상·게임을 방해할 수 있다
PEEK_MS = 10000               # 휠 클릭으로 숨기는 시간
NORMAL_ALPHA = 1.0            # 평소 투명도 (1.0 = 완전히 불투명)
HOVER_ALPHA = 0.10            # 마우스를 올렸을 때 투명도 (0.0 = 안 보임, 1.0 = 변화 없음)
HOVER_POLL_INTERVAL_MS = 40   # 클릭 통과 중에도 위치를 확인하는 간격
CONTROL_ZONE_PX = 28          # 왼쪽 ⋮ 조작 구역 폭 (여기서는 클릭이 배너에 전달됨)
# ═══════════════════════════════════════════════════════════

DEFAULT_TEXT = (
    "**업무 3원칙**     "
    "**고객 니즈 파악** — 이 화면을 누가, 무엇을 판단하려고 보는가를 만들기 전에 한 줄로 적는다.     "
    "**AI 과신 지양** — AI가 준 설계·수치·임계값은 원문 요구사항과 1:1로 대조한 뒤에 쓴다. 테스트 통과는 검증이 아니다.     "
    "**검증과 테스트 습관화** — 패키징보다 실제 브라우저 확인과 부품 하나씩 확인이 먼저. \"동작함\"이 아니라 \"원본과 대조해 확인함\"을 남긴다."
)

# ── 최초 1회 설치 + 사이트 버튼 연결 ─────────────────────────
# 다운로드 파일을 한 번 실행하면 사용자 폴더에 복사하고
# workcycle-banner:// 주소를 이 프로그램과 연결한다. 관리자 권한은 필요 없다.
APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "WorkCycleBanner")
INSTALLED_SCRIPT = os.path.join(APP_DIR, "banner.pyw")
INSTALLED_TEXT = os.path.join(APP_DIR, "banner.txt")
PROTOCOL = "workcycle-banner"
MAX_TEXT_LENGTH = 700

def normalized(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))

def pythonw_path() -> str:
    executable = os.path.abspath(sys.executable)
    if os.path.basename(executable).lower() == "python.exe":
        candidate = os.path.join(os.path.dirname(executable), "pythonw.exe")
        if os.path.exists(candidate):
            return candidate
    return executable

def save_installed_text(text: str) -> None:
    text = text.strip()[:MAX_TEXT_LENGTH]
    if not text:
        return
    os.makedirs(APP_DIR, exist_ok=True)
    with open(INSTALLED_TEXT, "w", encoding="utf-8") as f:
        f.write(text)

def text_from_protocol() -> Optional[str]:
    for arg in sys.argv[1:]:
        if not arg.lower().startswith(PROTOCOL + ":"):
            continue
        parsed = urlparse(arg)
        if parsed.netloc.lower() != "start":
            return None
        values = parse_qs(parsed.query, keep_blank_values=True)
        text = values.get("text", [""])[0].strip()
        return text[:MAX_TEXT_LENGTH] or None
    return None

def register_protocol() -> None:
    base = rf"Software\Classes\{PROTOCOL}"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, "URL:Work Cycle Banner Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    command = f'"{pythonw_path()}" "{INSTALLED_SCRIPT}" "%1"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, command)

def install_downloaded_copy() -> None:
    os.makedirs(APP_DIR, exist_ok=True)
    shutil.copy2(os.path.abspath(__file__), INSTALLED_SCRIPT)
    nearby_text = os.path.join(os.path.dirname(os.path.abspath(__file__)), "banner.txt")
    if os.path.exists(nearby_text) and not os.path.exists(INSTALLED_TEXT):
        shutil.copy2(nearby_text, INSTALLED_TEXT)
    register_protocol()
    ctypes.windll.user32.MessageBoxW(
        0,
        "설치와 버튼 연결이 완료됐습니다.\n\n이제 사이트에서 '저장하고 배너 켜기'를 누르면 바로 실행됩니다.",
        "Work Cycle 상단 고정 배너",
        0x40,
    )
    subprocess.Popen([pythonw_path(), INSTALLED_SCRIPT], close_fds=True)

CURRENT_SCRIPT = os.path.abspath(__file__)
IS_INSTALLED = normalized(CURRENT_SCRIPT) == normalized(INSTALLED_SCRIPT)
IS_DOWNLOAD = os.path.basename(CURRENT_SCRIPT).lower().startswith("work-cycle-desktop-banner")

# 사이트에서 새 문구와 함께 실행한 경우, 기존 배너도 읽을 수 있게 먼저 저장한다.
incoming_text = text_from_protocol()
if incoming_text:
    save_installed_text(incoming_text)

# public/downloads의 파일은 설치 프로그램을 겸한다. tools/banner.pyw는 개발용 휴대 실행이다.
if IS_DOWNLOAD and not IS_INSTALLED:
    try:
        install_downloaded_copy()
    except Exception as exc:
        ctypes.windll.user32.MessageBoxW(
            0,
            f"설치하지 못했습니다.\n\n{exc}",
            "Work Cycle 상단 고정 배너",
            0x10,
        )
    sys.exit(0)

# ── DPI 인식 ────────────────────────────────────────────────
# Tk 창을 만들기 전에 켜야 한다. 안 켜면 화면 배율(125%·150%)에서
# 폭 계산이 어긋나 배너가 화면 오른쪽 끝까지 닿지 않는다.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)      # Windows 8.1+
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()       # 그 이전
    except Exception:
        pass

# ── 중복 실행 막기 ──────────────────────────────────────────
# 두 번 켜면 같은 자리에 겹쳐 떠서, 우클릭해도 안 꺼지는 것처럼 보인다.
try:
    ctypes.windll.kernel32.CreateMutexW(None, False, "WorkCycleDesktopBanner")
    if ctypes.windll.kernel32.GetLastError() == 183:    # ERROR_ALREADY_EXISTS
        sys.exit(0)
except Exception:
    pass

def load_text() -> str:
    paths = [INSTALLED_TEXT]
    if not IS_INSTALLED:
        paths.insert(0, os.path.join(os.path.dirname(CURRENT_SCRIPT), "banner.txt"))
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read().strip()
            if text:
                return text[:MAX_TEXT_LENGTH]
        except OSError:
            pass
    return DEFAULT_TEXT

root = tk.Tk()
root.overrideredirect(True)
root.attributes("-topmost", True)
root.attributes("-alpha", NORMAL_ALPHA)

screen_width = root.winfo_screenwidth()
root.geometry(f"{screen_width}x{BANNER_HEIGHT}+0+0")

canvas = tk.Canvas(root, bg="black", highlightthickness=0)
canvas.pack(fill="both", expand=True)

FONT = ("Malgun Gothic", FONT_SIZE, "bold")
mid_y = BANNER_HEIGHT // 2
items = []
current_text = [""]

if SCROLL:
    first = canvas.create_text(0, mid_y, text="", anchor="w", font=FONT, fill=COLOR_ON)
    second = canvas.create_text(0, mid_y, text="", anchor="w", font=FONT, fill=COLOR_ON)
    items.extend([first, second])
    scroll_step = [SCROLL_GAP_PX]

    def apply_banner_text(text: str) -> None:
        current_text[0] = text
        for item in items:
            canvas.itemconfig(item, text=text, font=FONT)
        root.update_idletasks()
        box = canvas.bbox(first)
        scroll_step[0] = (box[2] - box[0]) + SCROLL_GAP_PX
        canvas.coords(first, 0, mid_y)
        canvas.coords(second, scroll_step[0], mid_y)

    def scroll() -> None:
        for item in items:
            canvas.move(item, -SCROLL_SPEED_PX, 0)
        for item in items:
            if canvas.bbox(item)[2] < 0:                # 왼쪽으로 완전히 빠졌으면
                other = items[1] if item is items[0] else items[0]
                canvas.coords(item, canvas.bbox(other)[0] + scroll_step[0], mid_y)
        root.after(SCROLL_INTERVAL_MS, scroll)

    scroll()
else:
    item = canvas.create_text(screen_width // 2, mid_y, text="", anchor="center",
                              font=FONT, fill=COLOR_ON)
    items.append(item)

    def apply_banner_text(text: str) -> None:
        current_text[0] = text
        size = FONT_SIZE
        canvas.itemconfig(item, text=text, font=("Malgun Gothic", size, "bold"))
        root.update_idletasks()
        while size > 7:
            box = canvas.bbox(item)
            if (box[2] - box[0]) <= screen_width - 20:
                break
            size -= 1
            canvas.itemconfig(item, font=("Malgun Gothic", size, "bold"))

apply_banner_text(load_text())

# 사이트에서 새 실행 요청이 오면 두 번째 프로세스가 banner.txt를 갱신한다.
# 실행 중인 첫 번째 배너는 파일을 주기적으로 읽어 즉시 새 문구로 바꾼다.
def poll_text_change() -> None:
    text = load_text()
    if text != current_text[0]:
        apply_banner_text(text)
    root.after(600, poll_text_change)

poll_text_change()

# 클릭 통과 중에도 배너를 종료하거나 잠깐 숨길 수 있도록 왼쪽 끝에 작은
# 조작 구역을 남긴다. 이 구역에서는 우클릭·휠 클릭이 배너에 전달된다.
canvas.create_rectangle(0, 0, CONTROL_ZONE_PX, BANNER_HEIGHT,
                        fill="black", outline="")
canvas.create_text(CONTROL_ZONE_PX // 2, mid_y, text="⋮", anchor="center",
                   font=("Malgun Gothic", 13, "bold"), fill=COLOR_OFF)

# ── 깜빡임 ──────────────────────────────────────────────────
# 완전히 껐다 켜는 대신 어두운 색으로 바꾼다. 글자가 사라지지 않아 읽던 중에도
# 끊기지 않고, 눈도 덜 피로하다. 완전한 점멸을 원하면 COLOR_OFF 를 "black" 으로.
if BLINK:
    blink_on = [True]

    def blink() -> None:
        blink_on[0] = not blink_on[0]
        color = COLOR_ON if blink_on[0] else COLOR_OFF
        for item in items:
            canvas.itemconfig(item, fill=color)
        root.after(BLINK_INTERVAL_MS, blink)

    blink()

# ── 끄는 방법을 둘로 ────────────────────────────────────────
# overrideredirect 창은 작업표시줄에 안 뜬다. 우클릭이 안 먹으면 작업관리자밖에
# 남지 않으므로 Esc 도 함께 열어둔다.
def quit_banner(_=None) -> None:
    root.destroy()

root.bind("<Button-3>", quit_banner)
root.bind("<Escape>", quit_banner)
root.focus_force()                      # Esc 가 먹으려면 포커스가 필요

# ── 마우스를 올리면 흐리게 + 클릭 통과 ──────────────────────
# alpha만 낮추면 뒤가 보일 뿐 입력은 여전히 배너가 가로챈다. hover 중에는
# WS_EX_TRANSPARENT를 켜서 클릭·드래그를 아래 창에 전달한다. 이 상태에서는
# Tk의 Leave 이벤트도 믿을 수 없으므로 Windows 전역 커서 위치를 주기적으로 본다.
user32 = ctypes.windll.user32
GA_ROOT = 2
GWL_EXSTYLE = -20
WS_EX_TRANSPARENT = 0x00000020
WS_EX_LAYERED = 0x00080000

user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetAncestor.restype = wintypes.HWND
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = ctypes.c_long
user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
user32.SetWindowLongW.restype = ctypes.c_long
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.restype = wintypes.BOOL

root.update_idletasks()
banner_hwnd = user32.GetAncestor(root.winfo_id(), GA_ROOT) or root.winfo_id()
interaction_mode = [None]
peek_active = [False]

def set_click_through(enabled: bool) -> None:
    style = user32.GetWindowLongW(banner_hwnd, GWL_EXSTYLE)
    style |= WS_EX_LAYERED
    if enabled:
        style |= WS_EX_TRANSPARENT
    else:
        style &= ~WS_EX_TRANSPARENT
    user32.SetWindowLongW(banner_hwnd, GWL_EXSTYLE, style)

def set_interaction_mode(mode: str) -> None:
    if interaction_mode[0] == mode:
        return
    if mode == "pass_through":
        root.attributes("-alpha", HOVER_ALPHA)
        set_click_through(True)
    else:
        # 클릭 통과부터 해제해야 불투명해지는 짧은 순간에도 조작이 가능하다.
        set_click_through(False)
        root.attributes("-alpha", NORMAL_ALPHA)
    interaction_mode[0] = mode

def poll_pointer() -> None:
    if not peek_active[0]:
        point = wintypes.POINT()
        rect = wintypes.RECT()
        has_point = user32.GetCursorPos(ctypes.byref(point))
        has_rect = user32.GetWindowRect(banner_hwnd, ctypes.byref(rect))
        if (has_point and has_rect and
                rect.left <= point.x < rect.right and rect.top <= point.y < rect.bottom):
            if point.x < rect.left + CONTROL_ZONE_PX:
                set_interaction_mode("controls")
            else:
                set_interaction_mode("pass_through")
        else:
            set_interaction_mode("normal")
    root.after(HOVER_POLL_INTERVAL_MS, poll_pointer)

poll_pointer()

# ── 잠깐 숨기기 ─────────────────────────────────────────────
# 배너가 가린 부분(창 제목줄·브라우저 탭)을 봐야 할 때 끄지 않고 잠시 치운다.
def peek(_=None) -> None:
    peek_active[0] = True
    set_interaction_mode("normal")
    root.withdraw()

    def show_again() -> None:
        root.deiconify()
        peek_active[0] = False

    root.after(PEEK_MS, show_again)

root.bind("<Button-2>", peek)

# ── 맨 위 유지 ──────────────────────────────────────────────
# 전체화면 앱이 뜨면 topmost 를 뺏기는 경우가 있어 주기적으로 되돌린다.
def keep_on_top() -> None:
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    root.after(TOPMOST_INTERVAL_MS, keep_on_top)

keep_on_top()

root.mainloop()
