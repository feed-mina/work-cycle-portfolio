@echo off
chcp 65001 >nul
setlocal

echo.
echo  desktop-banner exe 만들기
echo  ---------------------------------------------
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo  [!] Python 이 없습니다.
  echo      python.org 에서 설치하고, 설치 화면에서
  echo      "Add python.exe to PATH" 를 체크하세요.
  echo.
  pause
  exit /b 1
)

echo  [1/3] pyinstaller 확인 중...
python -m pip show pyinstaller >nul 2>nul
if errorlevel 1 (
  echo        설치합니다...
  python -m pip install pyinstaller || goto :fail
)

echo  [2/3] 빌드 중... (1~2분)
python -m PyInstaller --noconsole --onedir --name work-cycle-banner banner.pyw || goto :fail

echo  [3/3] 문구 파일 복사
copy /y banner.txt dist\work-cycle-banner\ >nul

echo.
echo  완료. 아래 파일을 더블클릭하세요:
echo    dist\work-cycle-banner\work-cycle-banner.exe
echo.
echo  자동 시작에 넣으려면:
echo    Win+R -^> shell:startup -^> 그 폴더에 위 exe 의 "바로가기"를 넣기
echo.
pause
exit /b 0

:fail
echo.
echo  [!] 빌드 실패. 위 메시지를 확인하세요.
pause
exit /b 1
